import type { Page } from "playwright";
import type { ProductCategory } from "../../../autolist/product-category.js";
import type { PriceInventoryRowValue } from "../price-inventory-rules.js";
import type { PublishRuleCheck, ServiceFulfillmentState } from "../publish-rules.js";
import type { ProductAssets, PublishActionResult, PublishFlowStage, ResolvedPublishFromSpuMetadata } from "../types.js";

export type PublishFlowProgress = {
  onProgress?: (message: string) => void;
};

export type EmitPublishFlowProgress = (step: string, message: string) => void;

export type BasicPublishMetadata = {
  title: string;
  shortTitle: string;
  modelSpec?: string;
  spu: string;
};

export type PublishFlowCommonState = {
  page: Page;
  createPageUrl: string;
  matchedRowText: string;
  shopVerifiedBeforeCreatePage: boolean;
  screenshotFiles: string[];
  stages: PublishFlowStage[];
};

export type ShopSpuActionDeps = {
  queryPlatformSpu: (
    runtimeDir: string,
    brand: string,
    spu: string,
    shopFolder?: string
  ) => Promise<{
    pageUrl: string;
    pageTitle: string;
    screenshotFile: string;
    createPageUrl: string;
    matchedRowText: string;
  }>;
  reuseOrOpenCreatePage: (context: unknown, createPageUrl: string, currentPage?: Page) => Promise<Page>;
  waitForPublishCreatePageReady: (
    page: Page,
    runtimeDir: string,
    publishPageUrl: string,
    label: string,
    maxAttempts?: number,
    options?: { allowPageNavigationRecovery?: boolean }
  ) => Promise<void>;
  ensureShopContext: (page: Page, runtimeDir: string, shopFolder: string) => Promise<string>;
  closeCreatePagesExcept: (context: unknown, keepPages?: Page[]) => Promise<void>;
};

export type BasicInfoActionDeps = Pick<
  ShopSpuActionDeps,
  "queryPlatformSpu" | "reuseOrOpenCreatePage" | "waitForPublishCreatePageReady"
> & {
  logInfo: (message: string) => void;
  assertBasicPrefillReadyOnPage: (
    page: Page,
    metadata: BasicPublishMetadata,
    onProgress?: (message: string) => void
  ) => Promise<void>;
  verifyCategoryRegistrationGateOnPage: (
    page: Page,
    runtimeDir: string,
    spu?: string,
    screenshotFileName?: string
  ) => Promise<void>;
  fillBasicPublishPageOnPage: (
    page: Page,
    runtimeDir: string,
    metadata: BasicPublishMetadata,
    fileName: string,
    onProgress?: (message: string) => void,
    guardUnexpectedFieldChanges?: boolean
  ) => Promise<{ screenshotFile: string; filledFields: string[] }>;
  assertBasicPublishCompletionOnPage: (
    page: Page,
    runtimeDir: string,
    metadata: BasicPublishMetadata,
    label: string
  ) => Promise<void>;
  isPublishCreatePageReopenRequiredError: (error: unknown) => boolean;
  fillHealthFoodSafetyAttributesOnPage: (
    page: Page,
    metadata: ResolvedPublishFromSpuMetadata
  ) => Promise<{ ok: boolean }>;
  uploadHealthFoodOuterPackagingOnPage: (
    page: Page,
    detailImages: string[]
  ) => Promise<{ ok: boolean }>;
  fillHealthFoodCategoryAttributesOnPage: (
    page: Page,
    metadata: ResolvedPublishFromSpuMetadata
  ) => Promise<{ ok: boolean }>;
};

export type GraphicInfoActionDeps = Pick<
  BasicInfoActionDeps,
  "waitForPublishCreatePageReady" | "assertBasicPublishCompletionOnPage"
> & {
  uploadProductImagesOnPage: (
    page: Page,
    runtimeDir: string,
    assets: ProductAssets,
    fileName: string
  ) => Promise<{ screenshotFile: string; uploadedGroups: string[]; uploadIssue: string }>;
  graphicUploadGroupsComplete: (uploadedGroups: string[]) => boolean;
  resetGraphicModuleOnPage: (page: Page, runtimeDir: string, screenshotFileName: string) => Promise<string>;
};

export type SpecPriceActionDeps = Pick<
  BasicInfoActionDeps,
  | "queryPlatformSpu"
  | "reuseOrOpenCreatePage"
  | "waitForPublishCreatePageReady"
  | "verifyCategoryRegistrationGateOnPage"
  | "fillBasicPublishPageOnPage"
  | "assertBasicPublishCompletionOnPage"
> & {
  gotoWithTolerance: (page: Page, url: string, waitMs?: number) => Promise<void>;
  applyHealthFoodShippingBeforeSpecOnPage: (page: Page) => Promise<PublishRuleCheck>;
  applyShippingBeforePriceInventoryOnPage: (page: Page, runtimeDir?: string) => Promise<PublishRuleCheck & { screenshotFile?: string }>;
  applyFixedSpecsOnPage: (
    page: Page,
    runtimeDir: string,
    fileName: string,
    title?: string
  ) => Promise<{ screenshotFile: string; configuredFields: string[]; specTypeOptions: string[]; specIssue: string }>;
  applyHealthFoodSpecificationOnPage: (
    page: Page,
    metadata: ResolvedPublishFromSpuMetadata
  ) => Promise<{ ok: boolean; expectedValue?: string; readbackValue?: string }>;
  readSpecModuleErrorOnPage: (page: Page) => Promise<string>;
  evaluatePriceInventoryEntryRule: (input: { specIssue: string }) => { action: "apply_price_inventory" | "block_until_spec_template_complete" };
  applyPriceInventoryOnPage: (
    page: Page,
    runtimeDir: string,
    fileName: string,
    priceInventoryRows: PriceInventoryRowValue[]
  ) => Promise<{ screenshotFile: string; filledRows: number; priceIssue: string }>;
  evaluatePriceInventoryCompletion: (input: {
    filledPriceRows: number;
    expectedRows: number;
    priceIssue: string;
    specIssue: string;
  }) => { passed: boolean; issue: string };
};

export type ServiceActionDeps = Pick<BasicInfoActionDeps, "assertBasicPublishCompletionOnPage" | "fillBasicPublishPageOnPage"> & {
  applyFixedPublishSettingsOnPage: (
    page: Page,
    runtimeDir: string,
    fileName: string,
    expectedSpu?: string
  ) => Promise<{
    screenshotFile: string;
    configuredFields: string[];
    freightTemplateName: string;
    serviceState: ServiceFulfillmentState;
  }>;
  evaluateServiceFulfillmentCompletion: (state: ServiceFulfillmentState) => { passed: boolean; issue: string };
  uploadHealthFoodPackagingLabelOnPage: (
    page: Page,
    detailImages: string[]
  ) => Promise<{ ok: boolean }>;
  ensureMedicalDeviceCertificateFromFirstQualification: (
    page: Page,
    runtimeDir: string,
    assets: ProductAssets
  ) => Promise<{ completed: boolean; issue: string; screenshotFile?: string; configuredField?: string }>;
};

export type SubmitActionDeps = {
  runPublishCheckOnPage: (
    page: Page,
    runtimeDir: string,
    fileName: string
  ) => Promise<{
    screenshotFile: string;
    checkPassed: boolean;
    checkMessage: string;
    checkHints: string[];
    blockingFields: string[];
  }>;
  evaluatePublishCheckResult: (input: {
    checkPassed: boolean;
    blockingFields: string[];
    uploadIssue: string;
    specIssue: string;
    priceIssue: string;
  }) => { passed: boolean; issue: string };
  resolvePublishCheckBlockingFields: (input: {
    blockingFields: string[];
    completedFields: string[];
    filledPriceRows: number;
    freightTemplateName: string;
  }) => string[];
  clickPublishProductOnPage: (
    page: Page,
    runtimeDir: string,
    fileName: string
  ) => Promise<
    PublishActionResult & {
      publishClicked: boolean;
      publishClickAttempted: boolean;
      publishIssue: string;
    }
  >;
  inspectPublishPageOnPage: (
    page: Page,
    runtimeDir: string,
    fileName: string
  ) => Promise<{
    pageUrl: string;
    pageTitle: string;
    screenshotFile: string;
    sections: string[];
    topActions: string[];
    errorHints: string[];
  }>;
  savePageScreenshot: (page: Page, runtimeDir: string, fileName: string) => Promise<string>;
};

export type PublishModuleSnapshot = {
  page: Page;
  screenshotFiles: string[];
  stages: PublishFlowStage[];
};

export type ProductCategoryContext = {
  productCategory: ProductCategory;
  basicMetadata: BasicPublishMetadata;
  basicInfoGuardUnexpectedFieldChanges: boolean;
};
