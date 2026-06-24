import type { Page } from "playwright";
import type { ProductAssets, ResolvedPublishFromSpuMetadata } from "../types.js";
import type { BasicInfoActionDeps, BasicPublishMetadata, EmitPublishFlowProgress, PublishModuleSnapshot } from "./types.js";

export async function runBasicInfoAction(
  deps: BasicInfoActionDeps,
  input: {
    page: Page;
    runtimeDir: string;
    createPageUrl: string;
    metadata: ResolvedPublishFromSpuMetadata;
    productCategory: string;
    basicMetadata: BasicPublishMetadata;
    shopFolder: string;
    assets: ProductAssets;
    guardUnexpectedFieldChanges: boolean;
    emitProgress: EmitPublishFlowProgress;
    failurePrefix?: string;
  }
): Promise<PublishModuleSnapshot & { filledFields: string[]; configuredFields: string[]; createPageUrl: string; matchedRowText: string }> {
  const screenshotFiles: string[] = [];
  const stages: PublishModuleSnapshot["stages"] = [];
  const filledFields: string[] = [];
  const configuredFields: string[] = [];
  const failurePrefix = input.failurePrefix || "Sequential publish flow stopped";
  let page = input.page;
  let createPageUrl = input.createPageUrl;
  let matchedRowText = "";
  let basicInfoCompleted = false;

  for (let basicAttempt = 0; basicAttempt < 2; basicAttempt += 1) {
    input.emitProgress("basic_info_attempt", `${basicAttempt + 1}/2 ${input.shopFolder.split(/[\\/]/).pop() || input.shopFolder}`);
    if (basicAttempt > 0) {
      page = await deps.reuseOrOpenCreatePage(page.context(), createPageUrl, page);
    }
    await deps.waitForPublishCreatePageReady(page, input.runtimeDir, createPageUrl, `publish-basic-${basicAttempt + 1}`, 3, {
      allowPageNavigationRecovery: basicAttempt > 0
    });

    try {
      await deps.assertBasicPrefillReadyOnPage(page, input.basicMetadata, (message) =>
        input.emitProgress("basic_info_wait", message)
      );
      if (input.basicMetadata.modelSpec) {
        await deps.verifyCategoryRegistrationGateOnPage(
          page,
          input.runtimeDir,
          input.metadata.spu,
          "publish-page-category-registration-mismatch.png"
        );
      }
      if (input.basicMetadata.title || input.basicMetadata.shortTitle || input.basicMetadata.modelSpec) {
        const fillResult = await deps.fillBasicPublishPageOnPage(
          page,
          input.runtimeDir,
          input.basicMetadata,
          "publish-page-basic-filled.png",
          (message) => input.emitProgress("basic_info_fill", message),
          input.guardUnexpectedFieldChanges
        );
        screenshotFiles.push(fillResult.screenshotFile);
        filledFields.length = 0;
        filledFields.push(...fillResult.filledFields);
        const missingBasicFields = [
          input.basicMetadata.title ? "title" : "",
          input.basicMetadata.shortTitle ? "shortTitle" : "",
          input.basicMetadata.modelSpec ? "modelSpec" : ""
        ]
          .filter(Boolean)
          .filter((field) => !filledFields.includes(field));
        if (missingBasicFields.length) {
          throw new Error(`基础信息模块缺失字段: ${missingBasicFields.join(", ")}`);
        }
      }
      await deps.assertBasicPublishCompletionOnPage(page, input.runtimeDir, input.basicMetadata, "after_basic_fill");
      stages.push({ step: "fill_basic_publish_page", status: "completed" });
      basicInfoCompleted = true;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (deps.isPublishCreatePageReopenRequiredError(error) && basicAttempt === 0) {
        input.emitProgress("basic_info_reopen", message);
        const retryQueryResult = await deps.queryPlatformSpu(input.runtimeDir, input.metadata.brand, input.metadata.spu, input.shopFolder);
        screenshotFiles.push(retryQueryResult.screenshotFile);
        createPageUrl = retryQueryResult.createPageUrl;
        matchedRowText = retryQueryResult.matchedRowText;
        page = await deps.reuseOrOpenCreatePage(page.context(), createPageUrl, page);
        continue;
      }
      const categoryMismatch = message.includes("Category registration mismatch before modelSpec fill.");
      if (categoryMismatch && basicAttempt === 0) {
        input.emitProgress("basic_info_reopen", message);
        const retryQueryResult = await deps.queryPlatformSpu(input.runtimeDir, input.metadata.brand, input.metadata.spu, input.shopFolder);
        screenshotFiles.push(retryQueryResult.screenshotFile);
        createPageUrl = retryQueryResult.createPageUrl;
        matchedRowText = retryQueryResult.matchedRowText;
        continue;
      }
      stages.push({ step: "fill_basic_publish_page", status: "failed" });
      throw new Error(`${failurePrefix}: 基础信息模块未完成。${message}`);
    }
  }

  if (!basicInfoCompleted) {
    stages.push({ step: "fill_basic_publish_page", status: "failed" });
    throw new Error(`${failurePrefix}: 基础信息模块未完成。`);
  }

  if (input.productCategory === "保健食品") {
    deps.logInfo(`publish module started: food_safety (${input.shopFolder.split(/[\\/]/).pop() || input.shopFolder})`);
    const foodSafetyResult = await deps.fillHealthFoodSafetyAttributesOnPage(page, input.metadata);
    if (!foodSafetyResult.ok) {
      stages.push({ step: "fill_health_food_safety", status: "failed" });
      throw new Error(`${failurePrefix}: 食品安全小模块稳定读回未完成。`);
    }
    const outerPackagingResult = await deps.uploadHealthFoodOuterPackagingOnPage(page, input.assets.detailImages);
    if (!outerPackagingResult.ok) {
      stages.push({ step: "fill_health_food_safety", status: "failed" });
      throw new Error(
        `${failurePrefix}: 食品安全模块未完成。foodSafety=${foodSafetyResult.ok}; outerPackaging=${outerPackagingResult.ok}`
      );
    }
    configuredFields.push("healthFoodSafety", "healthFoodOuterPackaging");
    stages.push({ step: "fill_health_food_safety", status: "completed" });

    deps.logInfo(`publish module started: category_attributes (${input.shopFolder.split(/[\\/]/).pop() || input.shopFolder})`);
    const categoryAttributeResult = await deps.fillHealthFoodCategoryAttributesOnPage(page, input.metadata);
    if (!categoryAttributeResult.ok) {
      stages.push({ step: "fill_health_food_category_attributes", status: "failed" });
      throw new Error(`${failurePrefix}: 保健食品类目属性模块未完成。`);
    }
    configuredFields.push("healthFoodCategoryAttributes");
    stages.push({ step: "fill_health_food_category_attributes", status: "completed" });
  }

  return { page, screenshotFiles, stages, filledFields, configuredFields, createPageUrl, matchedRowText };
}
