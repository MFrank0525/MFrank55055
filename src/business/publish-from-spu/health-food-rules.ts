import { resolveFeishuPriceInventoryRows } from "./price-inventory-rules.js";
import type { PublishFromSpuMetadata } from "./types.js";

export const HEALTH_FOOD_FIXED_FIELD_VALUES = {
  foodSafetyQualification: "国产预包装食品",
  shelfLife: "2",
  storage: "常温"
} as const;

export const HEALTH_FOOD_EXCLUDED_FIELD_LABELS = ["营养成分表", "口味分类", "图文区域", "主图视频"] as const;
export const HEALTH_FOOD_QUALIFICATION_IMAGE_SLOT_LABELS = ["商品外包装图", "详情图", "包装标签图"] as const;
export const HEALTH_FOOD_SPEC_TEMPLATE_ALIASES = ["买二送一", "买2送1", "2送1"] as const;

export interface HealthFoodRuleDecision {
  action: "ready" | "block";
  issue: string;
}

export interface HealthFoodFixedFieldSelections {
  foodSafetyQualification?: string;
  shelfLife?: string;
  storage?: string;
}

export interface HealthFoodQualificationImageSlot {
  label: string;
  selectedImageCount: number;
}

export interface HealthFoodSpecificationInput {
  groupName: string;
  currentValue: string;
  readbackValue: string;
}

export interface HealthFoodPriceInventoryRow {
  price: number;
  stock: number;
}

export interface HealthFoodPublishRuleInput {
  metadata: PublishFromSpuMetadata;
  fixedFieldSelections: HealthFoodFixedFieldSelections;
  healthFunctionOptions: string[];
  selectedHealthFunction: string;
  visibleOptionalFieldLabels: string[];
  qualificationImageCount: number;
  qualificationImageSlots: HealthFoodQualificationImageSlot[];
  selectedSpecTemplate: string;
  specificationInputs: HealthFoodSpecificationInput[];
  priceInventoryRows: HealthFoodPriceInventoryRow[];
}

const REQUIRED_HEALTH_FOOD_METADATA_FIELDS = [
  "productCategory",
  "manufacturerName",
  "manufacturerAddress",
  "netContent",
  "productStandardCode",
  "ingredients",
  "healthFunction",
  "specification",
  "productPriceText"
] as const;

function normalizeRuleText(value: string | undefined): string {
  return (value || "").replace(/\s+/g, "").trim();
}

function block(issue: string): HealthFoodRuleDecision {
  return { action: "block", issue };
}

function findMissingHealthFoodMetadataFields(metadata: PublishFromSpuMetadata): string[] {
  return REQUIRED_HEALTH_FOOD_METADATA_FIELDS.filter((field) => !normalizeRuleText(String(metadata[field] ?? "")));
}

function findMismatchedFixedFields(input: HealthFoodFixedFieldSelections): string[] {
  return Object.entries(HEALTH_FOOD_FIXED_FIELD_VALUES)
    .map(([key, expected]) => {
      const actual = input[key as keyof HealthFoodFixedFieldSelections] || "";
      return actual === expected ? "" : `${key} expected=${expected} actual=${actual || "<empty>"}`;
    })
    .filter(Boolean);
}

function selectedSpecTemplateMatchesAlias(selectedSpecTemplate: string): boolean {
  const selected = normalizeRuleText(selectedSpecTemplate);
  return HEALTH_FOOD_SPEC_TEMPLATE_ALIASES.some((alias) => selected.includes(normalizeRuleText(alias)));
}

export function resolveHealthFoodSpecificationReplacement(input: {
  metadata: Pick<PublishFromSpuMetadata, "specification">;
  currentValue: string;
}): { previousValue: string; replacementValue: string } {
  const replacementValue = input.metadata.specification?.trim() || "";
  if (!replacementValue) {
    throw new Error("Missing required health-food metadata fields: specification");
  }
  return {
    previousValue: input.currentValue,
    replacementValue
  };
}

function evaluateHealthFunctionExactMatch(input: HealthFoodPublishRuleInput): HealthFoodRuleDecision | undefined {
  const expected = input.metadata.healthFunction || "";
  const normalizedExpected = normalizeRuleText(expected);
  const normalizedSelected = normalizeRuleText(input.selectedHealthFunction);
  const optionMatched = input.healthFunctionOptions.some((option) => normalizeRuleText(option) === normalizedExpected);
  if (!normalizedExpected || normalizedSelected !== normalizedExpected || !optionMatched) {
    return block(`Health-food function option must exact match Feishu value: ${expected || "<empty>"}`);
  }
  return undefined;
}

function evaluateExcludedOptionalFields(input: HealthFoodPublishRuleInput): HealthFoodRuleDecision | undefined {
  const visibleExcluded = input.visibleOptionalFieldLabels.filter((label) =>
    HEALTH_FOOD_EXCLUDED_FIELD_LABELS.some((excluded) => normalizeRuleText(label) === normalizeRuleText(excluded))
  );
  if (visibleExcluded.length) {
    return block(`Health-food publish page still exposes excluded fields: ${visibleExcluded.join(", ")}`);
  }
  return undefined;
}

function evaluateQualificationImageSlots(input: HealthFoodPublishRuleInput): HealthFoodRuleDecision | undefined {
  if (input.qualificationImageCount <= 0) {
    return block("No Feishu qualification images are available for health-food required image slots.");
  }
  const missing = HEALTH_FOOD_QUALIFICATION_IMAGE_SLOT_LABELS.filter((label) => {
    const slot = input.qualificationImageSlots.find((candidate) => normalizeRuleText(candidate.label) === normalizeRuleText(label));
    return !slot || slot.selectedImageCount <= 0;
  });
  if (missing.length) {
    return block(`Health-food qualification image slots missing images: ${missing.join(", ")}`);
  }
  return undefined;
}

function evaluateSpecTemplateAndInputs(input: HealthFoodPublishRuleInput): HealthFoodRuleDecision | undefined {
  if (!selectedSpecTemplateMatchesAlias(input.selectedSpecTemplate)) {
    return block(`Health-food spec template did not match controlled aliases: ${HEALTH_FOOD_SPEC_TEMPLATE_ALIASES.join("/")}`);
  }
  if (input.specificationInputs.length !== 1) {
    return block(
      `Health-food 商品规格 must expose exactly one populated value input in group 规格: actual=${input.specificationInputs.length}`
    );
  }
  const specificationInput = input.specificationInputs[0];
  if (normalizeRuleText(specificationInput.groupName) !== "规格") {
    return block(
      `Health-food full specification input must belong to exact group 规格: actual=${specificationInput.groupName || "<empty>"}`
    );
  }
  if (normalizeRuleText(specificationInput.readbackValue) !== normalizeRuleText(input.metadata.specification)) {
    return block(
      `Health-food full specification readback must exactly match Feishu specification: expected=${
        input.metadata.specification || "<empty>"
      } actual=${specificationInput.readbackValue || "<empty>"}`
    );
  }
  return undefined;
}

function evaluatePriceInventoryRows(input: HealthFoodPublishRuleInput): HealthFoodRuleDecision | undefined {
  let expectedRows: HealthFoodPriceInventoryRow[];
  try {
    expectedRows = resolveFeishuPriceInventoryRows(input.metadata.productPriceText || "");
  } catch (error) {
    return block(error instanceof Error ? error.message : String(error));
  }
  if (input.priceInventoryRows.length !== expectedRows.length) {
    return block(`Health-food price/inventory row count mismatch: expected=${expectedRows.length} actual=${input.priceInventoryRows.length}`);
  }
  const mismatchIndex = input.priceInventoryRows.findIndex((row, index) => {
    const expected = expectedRows[index];
    return row.price !== expected.price || row.stock !== expected.stock;
  });
  if (mismatchIndex >= 0) {
    const row = input.priceInventoryRows[mismatchIndex];
    const expected = expectedRows[mismatchIndex];
    return block(
      `Health-food price/inventory row mismatch: row ${mismatchIndex + 1} expected price=${expected.price}, stock=${expected.stock} actual price=${row.price}, stock=${row.stock}`
    );
  }
  return undefined;
}

export function evaluateHealthFoodPublishRules(input: HealthFoodPublishRuleInput): HealthFoodRuleDecision {
  const missingMetadataFields = findMissingHealthFoodMetadataFields(input.metadata);
  if (missingMetadataFields.length) {
    return block(`Missing required health-food metadata fields: ${missingMetadataFields.join(", ")}`);
  }
  if (input.metadata.productCategory !== "保健食品") {
    return block(`Health-food product category must exact match 保健食品: ${input.metadata.productCategory || "<empty>"}`);
  }

  const mismatchedFixedFields = findMismatchedFixedFields(input.fixedFieldSelections);
  if (mismatchedFixedFields.length) {
    return block(`Health-food fixed field mismatch: ${mismatchedFixedFields[0]}`);
  }

  return (
    evaluateHealthFunctionExactMatch(input) ||
    evaluateExcludedOptionalFields(input) ||
    evaluateQualificationImageSlots(input) ||
    evaluateSpecTemplateAndInputs(input) ||
    evaluatePriceInventoryRows(input) || { action: "ready", issue: "" }
  );
}
