import type { PublishFromSpuMetadata } from "./types.js";

export const REQUIRED_HEALTH_FOOD_METADATA_FIELDS = [
  "manufacturerName",
  "manufacturerAddress",
  "netContent",
  "productStandardCode",
  "ingredients",
  "healthFunction",
  "specification",
  "shelfLife",
  "storageCondition"
] as const;

export function findMissingHealthFoodMetadataFields(metadata: PublishFromSpuMetadata): string[] {
  return REQUIRED_HEALTH_FOOD_METADATA_FIELDS.filter((field) => {
    if (field === "shelfLife") {
      return typeof metadata.shelfLife !== "number" || !Number.isFinite(metadata.shelfLife) || metadata.shelfLife <= 0;
    }
    return !String(metadata[field] ?? "").trim();
  });
}

export function assertHealthFoodMetadataReady(metadata: PublishFromSpuMetadata): void {
  const missing = findMissingHealthFoodMetadataFields(metadata);
  if (missing.length) {
    throw new Error(`Missing required health-food metadata fields: ${missing.join(", ")}`);
  }
}
