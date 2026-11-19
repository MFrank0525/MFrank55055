import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { normalizeProductCategory } from "../../autolist/product-category.js";
import { launchPersistentBrowser } from "../../browser/launch.js";
import { getSelectAllShortcut } from "../../utils/platform.js";
import { logInfo, logWarn } from "../../utils/logger.js";
import {
  PublishCreatePageReopenRequiredError,
  attachSafeDialogHandler,
  closeCreatePagesExcept,
  closeExtraPages,
  gotoWithTolerance,
  isNavigationContextDestroyedError,
  normalizeMatchText,
  normalizeSpuMatchText,
  reuseOrOpenCreatePage,
  savePageScreenshot
} from "./browser-session.js";
import {
  clickRadioByLabel,
  clickVisibleText,
  dismissTransientOverlays,
  isRadioSelectedByLabel
} from "./dom-actions.js";
import { writePublishJobResult } from "./job-result.js";
import {
  assertProductAssetsForShop,
  assertResolvedMetadata,
  resolvePublishFromSpuMetadata
} from "./metadata-resolution.js";
import { inspectPublishPage, inspectPublishPageOnPage } from "./publish-page-inspection.js";
import {
  assertDoudianPublishSessionReady,
  clickVisibleDropdownOption,
  ensurePlatformSpuPage,
  queryPlatformSpu
} from "./platform-spu-query-action.js";
import {
  assertPublishMutationBoundaryReady,
  recoverUsablePageFromContext,
  recoverUsablePublishPage,
  waitForPublishCreatePageReady
} from "./publish-page-readiness.js";
import {
  clickSwitchManualSpecEntryMode,
  isSpecTemplateSmartFillUploadModeVisible
} from "./spec-template-mode.js";
import {
  ensurePublishSectionTab,
  ensureServiceSectionReady,
  findLabelAbsoluteTop,
  scrollLabelIntoView,
  scrollPublishSectionContentIntoView
} from "./publish-section-navigation.js";
import { runBasicInfoAction } from "./actions/basic-info-action.js";
import { runGraphicInfoAction } from "./actions/graphic-info-action.js";
import { runServiceAction } from "./actions/service-action.js";
import { createDefaultShopSpuActionDeps, runShopSpuAction } from "./actions/shop-spu-action.js";
import { runSpecPriceAction } from "./actions/spec-price-action.js";
import { runSubmitAction } from "./actions/submit-action.js";
import { classifyAssets, validateMainImageAspectRatio } from "./assets.js";
import { prepareQualificationImagesForUpload } from "./qualification-image-normalizer.js";
import {
  FIXED_FREIGHT_TEMPLATE_KEYWORD,
  FIXED_SPEC_VALUES,
  GRAPHIC_SECTION_LABELS,
  PLATFORM_SPU_URL,
  SPEC_TEMPLATE_KEYWORD_DEFAULT,
  SPEC_TEMPLATE_KEYWORD_JIUGUANG
} from "./constants.js";
import {
  evaluateControlledSpecTemplatePriceCardinality,
  resolveFeishuPriceInventoryRows,
  type PriceInventoryRowValue
} from "./price-inventory-rules.js";
import { applyPriceInventoryOnPage, countVisiblePriceInventoryRows } from "./price-inventory-action.js";
import { readPublishRuleSummary } from "./publish-rule-text.js";
import { getPublishCategoryMutationPolicy } from "./publish-category-policy.js";
import type {
  PublishActionResult,
  ProductAssets,
  ProductSheetSummary,
  PublishFlowStage,
  PublishFromSpuMetadata,
  PublishFromSpuJobInput,
  PublishFromSpuJobOptions,
  PublishFromSpuJobResult,
  ResolvedPublishFromSpuMetadata,
  QueryDiagnosticError,
  QueryMatchCandidate
} from "./types.js";
import { summarizeWorkbook } from "./workbook.js";
import {
  applyHealthFoodSpecificationOnPage,
  fillHealthFoodCategoryAttributesOnPage,
  fillHealthFoodSafetyAttributesOnPage,
  uploadHealthFoodOuterPackagingOnPage,
  uploadHealthFoodPackagingLabelOnPage
} from "./health-food-actions.js";
import {
  OPTIONAL_GRAPHIC_SECTIONS_ARE_OUTSIDE_PUBLISH_FLOW,
  evaluateBasicInfoGateRecovery,
  evaluateBasicPrefillReadiness,
  evaluateShopSwitchMenuState,
  evaluateDetailImageCompletion,
  evaluateDetailUploadOutcome,
  evaluateMedicalDeviceCertificateUploadRule,
  evaluatePriceInventoryEntryRule,
  evaluatePriceInventoryCompletion,
  evaluatePublishCheckResult,
  evaluatePublishCreatePageReadiness,
  evaluatePlatformSpuQueryPageReadiness,
  evaluatePublishSubmission,
  evaluatePublishSubmissionAfterAction,
  evaluateServiceFulfillmentCompletion,
  evaluateSpecTemplateCompletion,
  isDoudianLoginPageText,
  isMatchingSpecTemplateValue,
  isUploadPlaceholderGraphicContext,
  resolveBasicFieldIdAliases,
  resolvePublishCheckBlockingFields,
  resolvePriceInventoryRowInputRoles,
  resolveSpecTemplateKeywordCandidates
} from "./publish-rules.js";
import type { PublishRuleCheck, ServiceFulfillmentState } from "./publish-rules.js";
import { makePublishActionResult } from "./publish-actions.js";

import { assertBasicPrefillReadyOnPage, assertBasicPublishCompletionOnPage, fillBasicPublishPageOnPage, verifyCategoryRegistrationGateOnPage } from "./basic-info-page-action.js";
import { readSpecModuleErrorOnPage } from "./spec-service-page-action.js";
import {
  applyFixedPublishSettingsOnPage,
  applyFixedSpecsOnPage,
  applyHealthFoodShippingBeforeSpecOnPage,
  applyShippingBeforePriceInventoryOnPage
} from "./service-fulfillment-page-action.js";
import { ensureMedicalDeviceCertificateFromFirstQualification } from "./graphic-file-input-action.js";
import { graphicUploadGroupsComplete, resetGraphicModuleOnPage, uploadProductImagesOnPage } from "./graphic-upload-page-action.js";
import { clickPublishProductOnPage, runPublishCheckOnPage } from "./publish-submit-page-action.js";
import {
  CategoryAdviceRecoveredError,
  configureCategoryAdviceRecoveryForPage,
  isCategoryAdviceFormRebuildRequiredError,
  resolveCategoryAdviceOverlaySafely
} from "./category-advice-overlay-action.js";

export async function runPublishFlow(
  runtimeDir: string,
  metadata: ResolvedPublishFromSpuMetadata,
  assets: ProductAssets,
  shopFolder: string,
  publishPageUrl?: string,
  stopBeforePublish = false,
  graphicResetAttempt = 0,
  createPageResetAttempt = 0,
  progress?: { onProgress?: (message: string) => void },
  samePageCategoryRebuildAttempt = 0
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFiles: string[];
  createPageUrl: string;
  matchedRowText?: string;
  filledFields: string[];
  configuredFields: string[];
  uploadedGroups: string[];
  uploadIssue: string;
  specTypeOptions: string[];
  specIssue: string;
  filledPriceRows: number;
  priceIssue: string;
  checkPassed: boolean;
  checkMessage: string;
  checkHints: string[];
  blockingFields: string[];
  publishClicked: boolean;
  publishClickAttempted: boolean;
  publishIssue: string;
  freightTemplateName?: string;
  sections: string[];
  topActions: string[];
  errorHints: string[];
  stages: PublishFlowStage[];
}> {
  const emitPublishFlowProgress = (step: string, message: string): void => {
    const text = `${step}: ${message}`;
    logInfo(text);
    progress?.onProgress?.(text);
  };
  const screenshotFiles: string[] = [];
  const stages: PublishFlowStage[] = [];
  const filledFields: string[] = [];
  const configuredFields: string[] = [];
  let uploadedGroups: string[] = [];
  let uploadIssue = "";
  let specTypeOptions: string[] = [];
  let specIssue = "";
  let filledPriceRows = 0;
  let priceIssue = "";
  let freightTemplateName = "";
  let finalSubmitStarted = false;

  let createPageUrl = publishPageUrl || "";
  let matchedRowText = "";
  const productCategory = normalizeProductCategory(metadata.productCategory);
  const mutationPolicy = getPublishCategoryMutationPolicy(productCategory);
  const basicMetadata =
    mutationPolicy.categoryAttributes === "fill_model_spec"
      ? { title: metadata.title, shortTitle: metadata.shortTitle, modelSpec: metadata.modelSpec, spu: metadata.spu }
      : { title: metadata.title, shortTitle: metadata.shortTitle, modelSpec: undefined, spu: metadata.spu };
  const basicInfoGuardUnexpectedFieldChanges = mutationPolicy.guardUnexpectedBasicFieldChanges;
  const priceInventoryRows = resolveFeishuPriceInventoryRows(metadata.productPriceText || "");
  const sourceCardinality = evaluateControlledSpecTemplatePriceCardinality({
    specTemplate: metadata.specTemplate || "",
    priceCount: priceInventoryRows.length
  });
  if (!sourceCardinality.passed) {
    throw new Error(sourceCardinality.issue);
  }

  const context = await launchPersistentBrowser();
  try {
    const shopSpuDeps = createDefaultShopSpuActionDeps();
    const categoryContext = {
      productCategory,
      mutationPolicy,
      basicMetadata,
      basicInfoGuardUnexpectedFieldChanges
    };
    let shopSpuResult: Awaited<ReturnType<typeof runShopSpuAction>>;
    try {
      shopSpuResult = await runShopSpuAction(
        shopSpuDeps,
        {
          context,
          runtimeDir,
          metadata,
          mutationPolicy,
          shopFolder,
          publishPageUrl
        }
      );
      await waitForPublishCreatePageReady(
        shopSpuResult.page,
        runtimeDir,
        shopSpuResult.createPageUrl,
        "publish-initial"
      );
    } catch (error) {
      if (error instanceof PublishCreatePageReopenRequiredError && createPageResetAttempt < 2) {
        logWarn(`Publish create page was unusable after SPU query; reopening from platform SPU. issue=${error.message}`);
        await closeCreatePagesExcept(context, []).catch(() => {});
        await context.browser()?.close().catch(() => {});
        const retryResult = await runPublishFlow(
          runtimeDir,
          metadata,
          assets,
          shopFolder,
          undefined,
          stopBeforePublish,
          graphicResetAttempt,
          createPageResetAttempt + 1,
          progress
        );
        return {
          ...retryResult,
          screenshotFiles: [...screenshotFiles, ...retryResult.screenshotFiles],
          stages: [
            ...stages,
            { step: "reopen_publish_page_after_spu_prefill_failure", status: "completed" },
            ...retryResult.stages
          ]
        };
      }
      throw error;
    }
    screenshotFiles.push(...shopSpuResult.screenshotFiles);
    stages.push(...shopSpuResult.stages);
    let page = shopSpuResult.page;
    createPageUrl = shopSpuResult.createPageUrl;
    matchedRowText = shopSpuResult.matchedRowText;
    const configureCurrentCategoryAdviceRecovery = (): void =>
      configureCategoryAdviceRecoveryForPage(page, {
        productCategory,
        spu: metadata.spu,
        title: metadata.title
      });
    configureCurrentCategoryAdviceRecovery();

    const runCurrentBasicInfoAction = () => runBasicInfoAction(
      {
        queryPlatformSpu,
        reuseOrOpenCreatePage: (targetContext, targetCreatePageUrl, currentPage) =>
          reuseOrOpenCreatePage(targetContext as Awaited<ReturnType<typeof launchPersistentBrowser>>, targetCreatePageUrl, currentPage),
        waitForPublishCreatePageReady,
        assertBasicPrefillReadyOnPage,
        verifyCategoryRegistrationGateOnPage,
        fillBasicPublishPageOnPage,
        assertBasicPublishCompletionOnPage,
        isPublishCreatePageReopenRequiredError: (error) => error instanceof PublishCreatePageReopenRequiredError,
        logInfo,
        fillHealthFoodSafetyAttributesOnPage,
        uploadHealthFoodOuterPackagingOnPage,
        fillHealthFoodCategoryAttributesOnPage
      },
      {
        page,
        runtimeDir,
        createPageUrl,
        metadata,
        mutationPolicy,
        basicMetadata,
        shopFolder,
        assets,
        guardUnexpectedFieldChanges: basicInfoGuardUnexpectedFieldChanges,
        emitProgress: emitPublishFlowProgress
      }
    );
    let basicResult = await runCurrentBasicInfoAction();
    page = basicResult.page;
    configureCurrentCategoryAdviceRecovery();
    createPageUrl = basicResult.createPageUrl;
    if (basicResult.matchedRowText) {
      matchedRowText = basicResult.matchedRowText;
    }
    screenshotFiles.push(...basicResult.screenshotFiles);
    stages.push(...basicResult.stages);
    filledFields.length = 0;
    filledFields.push(...basicResult.filledFields);
    configuredFields.push(...basicResult.configuredFields);
    let priceInventoryCompleted = false;
    await assertPublishMutationBoundaryReady(page, runtimeDir, "before_graphic_info");
    for (let specAttempt = 0; specAttempt < 2; specAttempt += 1) {
      if (specAttempt === 0) {
        logInfo(`publish module started: ${"graphic_info"} (${path.basename(shopFolder)})`);
      }
      const graphicDeps = {
        waitForPublishCreatePageReady,
        assertBasicPublishCompletionOnPage,
        uploadProductImagesOnPage,
        graphicUploadGroupsComplete,
        resetGraphicModuleOnPage
      };
      const runCurrentGraphicAction = (preserveExistingMainImages = false) => runGraphicInfoAction(
        graphicDeps,
        {
          page,
          runtimeDir,
          createPageUrl,
          basicMetadata,
          assets,
          graphicResetAttempt: preserveExistingMainImages ? 1 : graphicResetAttempt,
          specAttempt,
          preserveExistingMainImages,
          logWarn
        }
      );
      let graphicResult: Awaited<ReturnType<typeof runGraphicInfoAction>>;
      try {
        await resolveCategoryAdviceOverlaySafely(page);
        graphicResult = await runCurrentGraphicAction();
      } catch (error) {
        if (!isCategoryAdviceFormRebuildRequiredError(error)) {
          throw error;
        }
        logInfo(
          error instanceof CategoryAdviceRecoveredError
            ? `rebuilding category-dependent fields after restoring the original category: ${error.originalCategory}`
            : `rebuilding category-dependent fields after restoring the medical-device SPU: ${error.expectedSpu}`
        );
        basicResult = await runCurrentBasicInfoAction();
        page = basicResult.page;
        configureCurrentCategoryAdviceRecovery();
        createPageUrl = basicResult.createPageUrl;
        if (basicResult.matchedRowText) {
          matchedRowText = basicResult.matchedRowText;
        }
        screenshotFiles.push(...basicResult.screenshotFiles);
        stages.push(...basicResult.stages);
        filledFields.length = 0;
        filledFields.push(...basicResult.filledFields);
        configuredFields.push(...basicResult.configuredFields);
        graphicResult = await runCurrentGraphicAction();
      }
      screenshotFiles.push(...graphicResult.screenshotFiles);
      stages.push(...graphicResult.stages);
      uploadedGroups = graphicResult.uploadedGroups;
      uploadIssue = graphicResult.uploadIssue;

      if (mutationPolicy.healthFoodShippingBeforeSpecification) {
        if (specAttempt === 0) {
          logInfo(`publish module started: ${"shipping_and_spec"} (${path.basename(shopFolder)})`);
        }
      }

      await assertPublishMutationBoundaryReady(page, runtimeDir, "before_price_inventory");
      const specPriceResult = await runSpecPriceAction(
        {
          queryPlatformSpu,
          reuseOrOpenCreatePage: (targetContext, targetCreatePageUrl, currentPage) =>
            reuseOrOpenCreatePage(targetContext as Awaited<ReturnType<typeof launchPersistentBrowser>>, targetCreatePageUrl, currentPage),
          waitForPublishCreatePageReady,
          verifyCategoryRegistrationGateOnPage,
          fillBasicPublishPageOnPage,
          assertBasicPublishCompletionOnPage,
          gotoWithTolerance,
          applyHealthFoodShippingBeforeSpecOnPage,
          applyShippingBeforePriceInventoryOnPage,
          applyFixedSpecsOnPage,
          applyHealthFoodSpecificationOnPage,
          readSpecModuleErrorOnPage,
          evaluatePriceInventoryEntryRule,
          applyPriceInventoryOnPage,
          evaluatePriceInventoryCompletion
        },
        {
          page,
          runtimeDir,
          createPageUrl,
          metadata,
          categoryContext,
          shopFolder,
          priceInventoryRows,
          specAttempt
        }
      );
      page = specPriceResult.page;
      configureCurrentCategoryAdviceRecovery();
      createPageUrl = specPriceResult.createPageUrl;
      if (specPriceResult.matchedRowText) {
        matchedRowText = specPriceResult.matchedRowText;
      }
      screenshotFiles.push(...specPriceResult.screenshotFiles);
      stages.push(...specPriceResult.stages);
      configuredFields.push(...specPriceResult.configuredFields);
      specTypeOptions = specPriceResult.specTypeOptions;
      specIssue = specPriceResult.specIssue;
      filledPriceRows = specPriceResult.filledPriceRows;
      priceIssue = specPriceResult.priceIssue;
      if (specPriceResult.shouldRetryFromSpecTemplate) {
        continue;
      }
      if (specPriceResult.completed) {
        priceInventoryCompleted = true;
        break;
      }
      break;
    }
    if (!priceInventoryCompleted) {
      const priceRule = evaluatePriceInventoryCompletion({
        filledPriceRows,
        expectedRows: priceInventoryRows.length,
        priceIssue,
        specIssue
      });
      stages.push({ step: "apply_price_inventory", status: "failed" });
      throw new Error(`Sequential publish flow stopped: 价格库存模块未完成。${priceRule.issue}`);
    }
    stages.push({ step: "apply_price_inventory", status: "completed" });

    await assertPublishMutationBoundaryReady(page, runtimeDir, "before_service_fulfillment");
    const recoverLateCategoryAdvice = async (): Promise<boolean> =>
      resolveCategoryAdviceOverlaySafely(page);
    await recoverLateCategoryAdvice();
    logInfo(`publish module started: ${"service_fulfillment"} (${path.basename(shopFolder)})`);
    const runCurrentServiceAction = () => runServiceAction(
        {
          assertBasicPublishCompletionOnPage,
          fillBasicPublishPageOnPage,
          applyFixedPublishSettingsOnPage,
          evaluateServiceFulfillmentCompletion,
          uploadHealthFoodPackagingLabelOnPage,
          ensureMedicalDeviceCertificateFromFirstQualification
        },
        {
          page,
          runtimeDir,
          metadata,
          categoryContext,
          assets,
          filledFields
        }
      );
    let serviceResult: Awaited<ReturnType<typeof runServiceAction>>;
    try {
      serviceResult = await runCurrentServiceAction();
    } catch (error) {
      if (!(await recoverLateCategoryAdvice())) throw error;
      serviceResult = await runCurrentServiceAction();
    }
    screenshotFiles.push(...serviceResult.screenshotFiles);
    stages.push(...serviceResult.stages);
    configuredFields.push(...serviceResult.configuredFields);
    freightTemplateName = serviceResult.freightTemplateName;

    if (!stopBeforePublish) {
      logInfo(`publish module started: final_submit (${path.basename(shopFolder)})`);
    }
    await assertPublishMutationBoundaryReady(page, runtimeDir, "before_final_submit");
    finalSubmitStarted = !stopBeforePublish;
    const submitResult = await runSubmitAction(
      {
        runPublishCheckOnPage,
        evaluatePublishCheckResult,
        resolvePublishCheckBlockingFields,
        clickPublishProductOnPage,
        inspectPublishPageOnPage,
        savePageScreenshot
      },
      {
        page,
        runtimeDir,
        stopBeforePublish,
        categoryContext,
        filledFields,
        configuredFields,
        filledPriceRows,
        freightTemplateName,
        uploadIssue,
        specIssue,
        priceIssue,
        currentTitle: metadata.title,
        categoryFallbackTitles: metadata.categoryFallbackTitles
      }
    );
    metadata.title = submitResult.effectiveTitle;
    screenshotFiles.push(...submitResult.screenshotFiles);
    stages.push(...submitResult.stages);

    return {
      pageUrl: submitResult.pageUrl,
      pageTitle: submitResult.pageTitle,
      screenshotFiles,
      createPageUrl,
      matchedRowText,
      filledFields,
      configuredFields,
      uploadedGroups,
      uploadIssue,
      specTypeOptions,
      specIssue,
      filledPriceRows,
      priceIssue,
      checkPassed: submitResult.checkPassed,
      checkMessage: submitResult.checkMessage,
      checkHints: submitResult.checkHints,
      blockingFields: submitResult.blockingFields,
      publishClicked: submitResult.publishClicked,
      publishClickAttempted: submitResult.publishClickAttempted,
      publishIssue: submitResult.publishIssue,
      freightTemplateName,
      sections: submitResult.sections,
      topActions: submitResult.topActions,
      errorHints: submitResult.errorHints,
      stages
    };
  } catch (error) {
    if (isCategoryAdviceFormRebuildRequiredError(error) && !finalSubmitStarted) {
      if (!createPageUrl || samePageCategoryRebuildAttempt >= 2) {
        const recoveryTarget = error instanceof CategoryAdviceRecoveredError ? error.originalCategory : error.expectedSpu;
        throw new Error(
          `Same-page category form rebuild exhausted after category-advice recovery. ` +
          `target=${recoveryTarget}; attempts=${samePageCategoryRebuildAttempt}; ` +
          `createPageUrl=${createPageUrl || "<empty>"}`,
          { cause: error }
        );
      }
      const nextAttempt = samePageCategoryRebuildAttempt + 1;
      const recoveryTarget = error instanceof CategoryAdviceRecoveredError ? error.originalCategory : error.expectedSpu;
      logInfo(
        `rebuilding the full form on the same create page after category-advice recovery: ` +
        `${recoveryTarget}; attempt=${nextAttempt}/2; createPageUrl=${createPageUrl}`
      );
      await context.browser()?.close().catch(() => {});
      const retryResult = await runPublishFlow(
        runtimeDir,
        metadata,
        assets,
        shopFolder,
        createPageUrl,
        stopBeforePublish,
        graphicResetAttempt,
        createPageResetAttempt,
        progress,
        nextAttempt
      );
      return {
        ...retryResult,
        screenshotFiles: [...screenshotFiles, ...retryResult.screenshotFiles],
        stages: [
          ...stages,
          { step: "rebuild_same_create_page_after_category_advice", status: "completed" },
          ...retryResult.stages
        ]
      };
    }
    throw error;
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

export async function runGraphicFlow(
  runtimeDir: string,
  metadata: { brand: string; spu: string; title?: string; shortTitle?: string; modelSpec?: string; productPriceText?: string; specTemplate?: string; productCategory?: string },
  assets: ProductAssets,
  shopFolder: string,
  publishPageUrl?: string,
  graphicResetAttempt = 0
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFiles: string[];
  createPageUrl: string;
  matchedRowText?: string;
  filledFields: string[];
  uploadedGroups: string[];
  uploadIssue: string;
  sections: string[];
  topActions: string[];
  errorHints: string[];
  stages: PublishFlowStage[];
}> {
  const screenshotFiles: string[] = [];
  const stages: PublishFlowStage[] = [];
  const filledFields: string[] = [];
  let uploadedGroups: string[] = [];
  let uploadIssue = "";
  let createPageUrl = "";
  let matchedRowText = "";
  const productCategory = normalizeProductCategory(metadata.productCategory);
  const mutationPolicy = getPublishCategoryMutationPolicy(productCategory);
  const actionMetadata: ResolvedPublishFromSpuMetadata = {
    brand: metadata.brand,
    spu: metadata.spu,
    title: metadata.title || "",
    shortTitle: metadata.shortTitle || "",
    modelSpec: metadata.modelSpec || "",
    productPriceText: metadata.productPriceText || "",
    specTemplate: metadata.specTemplate || "",
    productCategory
  };
  const basicMetadata = {
    title: actionMetadata.title,
    shortTitle: actionMetadata.shortTitle,
    modelSpec:
      mutationPolicy.categoryAttributes === "fill_model_spec"
        ? actionMetadata.modelSpec
        : undefined,
    spu: actionMetadata.spu
  };

  const context = await launchPersistentBrowser();
  try {
    const shopSpuDeps = createDefaultShopSpuActionDeps();
    const shopSpuResult = await runShopSpuAction(
      shopSpuDeps,
      {
        context,
        runtimeDir,
        metadata: actionMetadata,
        mutationPolicy,
        shopFolder,
        publishPageUrl
      }
    );
    screenshotFiles.push(...shopSpuResult.screenshotFiles);
    stages.push(...shopSpuResult.stages);
    let page = shopSpuResult.page;
    createPageUrl = shopSpuResult.createPageUrl;
    matchedRowText = shopSpuResult.matchedRowText;
    configureCategoryAdviceRecoveryForPage(page, {
      productCategory,
      spu: actionMetadata.spu,
      title: actionMetadata.title
    });

    const basicResult = await runBasicInfoAction(
      {
        queryPlatformSpu,
        reuseOrOpenCreatePage: (targetContext, targetCreatePageUrl, currentPage) =>
          reuseOrOpenCreatePage(targetContext as Awaited<ReturnType<typeof launchPersistentBrowser>>, targetCreatePageUrl, currentPage),
        waitForPublishCreatePageReady,
        assertBasicPrefillReadyOnPage,
        verifyCategoryRegistrationGateOnPage,
        fillBasicPublishPageOnPage,
        assertBasicPublishCompletionOnPage,
        isPublishCreatePageReopenRequiredError: (error) => error instanceof PublishCreatePageReopenRequiredError,
        logInfo,
        fillHealthFoodSafetyAttributesOnPage,
        uploadHealthFoodOuterPackagingOnPage,
        fillHealthFoodCategoryAttributesOnPage
      },
      {
        page,
        runtimeDir,
        createPageUrl,
        metadata: actionMetadata,
        mutationPolicy,
        basicMetadata,
        shopFolder,
        assets,
        guardUnexpectedFieldChanges: true,
        emitProgress: () => {},
        failurePrefix: "Graphic flow stopped"
      }
    );
    page = basicResult.page;
    configureCategoryAdviceRecoveryForPage(page, {
      productCategory,
      spu: actionMetadata.spu,
      title: actionMetadata.title
    });
    createPageUrl = basicResult.createPageUrl;
    if (basicResult.matchedRowText) {
      matchedRowText = basicResult.matchedRowText;
    }
    screenshotFiles.push(...basicResult.screenshotFiles);
    stages.push(...basicResult.stages);
    filledFields.push(...basicResult.filledFields);

    const graphicResult = await runGraphicInfoAction(
      {
        waitForPublishCreatePageReady,
        assertBasicPublishCompletionOnPage,
        uploadProductImagesOnPage,
        graphicUploadGroupsComplete,
        resetGraphicModuleOnPage
      },
      {
        page,
        runtimeDir,
        createPageUrl,
        basicMetadata,
        assets,
        graphicResetAttempt,
        specAttempt: 0,
        logWarn,
        failurePrefix: "Graphic flow stopped"
      }
    );
    screenshotFiles.push(...graphicResult.screenshotFiles);
    stages.push(...graphicResult.stages);
    uploadedGroups = graphicResult.uploadedGroups;
    uploadIssue = graphicResult.uploadIssue;
    if (!stages.some((stage) => stage.step === "upload_product_images" && stage.status === "completed")) {
      stages.push({ step: "upload_product_images", status: "completed" });
    }

    const inspectResult = await inspectPublishPageOnPage(page, runtimeDir, "publish-page-graphic-flow-inspect.png");
    screenshotFiles.push(inspectResult.screenshotFile);
    stages.push({ step: "inspect_publish_page", status: "completed" });

    return {
      pageUrl: inspectResult.pageUrl,
      pageTitle: inspectResult.pageTitle,
      screenshotFiles,
      createPageUrl,
      matchedRowText,
      filledFields,
      uploadedGroups,
      uploadIssue,
      sections: inspectResult.sections,
      topActions: inspectResult.topActions,
      errorHints: inspectResult.errorHints,
      stages
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}
