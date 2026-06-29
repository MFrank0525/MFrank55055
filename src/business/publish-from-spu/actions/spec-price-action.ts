import type { Page } from "playwright";
import type { PriceInventoryRowValue } from "../price-inventory-rules.js";
import type { ResolvedPublishFromSpuMetadata } from "../types.js";
import type { BasicPublishMetadata, ProductCategoryContext, PublishModuleSnapshot, SpecPriceActionDeps } from "./types.js";

export async function runSpecPriceAction(
  deps: SpecPriceActionDeps,
  input: {
    page: Page;
    runtimeDir: string;
    createPageUrl: string;
    metadata: ResolvedPublishFromSpuMetadata;
    categoryContext: ProductCategoryContext;
    shopFolder: string;
    priceInventoryRows: PriceInventoryRowValue[];
    specAttempt: number;
  }
): Promise<
  PublishModuleSnapshot & {
    page: Page;
    createPageUrl: string;
    matchedRowText: string;
    configuredFields: string[];
    specTypeOptions: string[];
    specIssue: string;
    filledPriceRows: number;
    priceIssue: string;
    completed: boolean;
    shouldRetryFromSpecTemplate: boolean;
  }
> {
  const screenshotFiles: string[] = [];
  const stages: PublishModuleSnapshot["stages"] = [];
  const configuredFields: string[] = [];
  let page = input.page;
  let createPageUrl = input.createPageUrl;
  let matchedRowText = "";

  if (input.categoryContext.productCategory === "保健食品") {
    const shippingRule = await deps.applyHealthFoodShippingBeforeSpecOnPage(page);
    if (!shippingRule.passed) {
      stages.push({ step: "apply_health_food_shipping_before_spec", status: "failed" });
      throw new Error(`Sequential publish flow stopped: 发货与规格前置模块未完成。${shippingRule.issue}`);
    }
    if (input.specAttempt === 0) {
      configuredFields.push("healthFoodShippingMode", "healthFoodShippingTime");
      stages.push({ step: "apply_health_food_shipping_before_spec", status: "completed" });
    }
  }

  const specResult = await deps.applyFixedSpecsOnPage(page, input.runtimeDir, "publish-page-spec-editor.png", input.metadata.title);
  screenshotFiles.push(specResult.screenshotFile);
  configuredFields.push(...specResult.configuredFields);
  const specTypeOptions = specResult.specTypeOptions;
  let specIssue = specResult.specIssue;
  if (input.categoryContext.productCategory === "保健食品" && !specIssue) {
    await page.waitForTimeout(3000);
    const healthFoodSpecResult = await deps.applyHealthFoodSpecificationOnPage(page, input.metadata);
    if (!healthFoodSpecResult.ok) {
      specIssue = `Health-food full specification readback mismatch: expected=${
        healthFoodSpecResult.expectedValue || "<empty>"
      } actual=${healthFoodSpecResult.readbackValue || "<empty>"}`;
    } else {
      configuredFields.push("healthFoodSpecification");
    }
  }
  const specModuleError = await deps.readSpecModuleErrorOnPage(page).catch(() => "");
  if (!specIssue && specModuleError) {
    specIssue = `Spec module error detected: ${specModuleError}`;
  }

  const priceEntryRule = deps.evaluatePriceInventoryEntryRule({ specIssue });
  if (priceEntryRule.action === "block_until_spec_template_complete") {
    return {
      page,
      createPageUrl,
      matchedRowText,
      screenshotFiles,
      stages,
      configuredFields,
      specTypeOptions,
      specIssue,
      filledPriceRows: 0,
      priceIssue: "",
      completed: false,
      shouldRetryFromSpecTemplate: false
    };
  }

  await deps.assertBasicPublishCompletionOnPage(page, input.runtimeDir, input.categoryContext.basicMetadata, "before_price_inventory_module");
  const shippingBeforePriceRule = await deps.applyShippingBeforePriceInventoryOnPage(page);
  if (!shippingBeforePriceRule.passed) {
    stages.push({ step: "apply_shipping_before_price_inventory", status: "failed" });
    throw new Error(`Sequential publish flow stopped: 价格库存发货前置模块未完成。${shippingBeforePriceRule.issue}`);
  }
  configuredFields.push("shippingMode", "shippingTime");
  stages.push({ step: "apply_shipping_before_price_inventory", status: "completed" });

  const priceInventoryResult = await deps.applyPriceInventoryOnPage(
    page,
    input.runtimeDir,
    "publish-page-price-inventory-filled.png",
    input.priceInventoryRows
  );
  screenshotFiles.push(priceInventoryResult.screenshotFile);
  const filledPriceRows = priceInventoryResult.filledRows;
  const priceIssue = priceInventoryResult.priceIssue;
  const priceRule = deps.evaluatePriceInventoryCompletion({
    filledPriceRows,
    expectedRows: input.priceInventoryRows.length,
    priceIssue,
    specIssue
  });

  return {
    page,
    createPageUrl,
    matchedRowText,
    screenshotFiles,
    stages,
    configuredFields,
    specTypeOptions,
    specIssue,
    filledPriceRows,
    priceIssue,
    completed: priceRule.passed,
    shouldRetryFromSpecTemplate: false
  };
}
