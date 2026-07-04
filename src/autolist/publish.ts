import fs from "node:fs";
import path from "node:path";
import { runPublishFromSpuJob } from "../business/publish-from-spu.js";
import { clearCheckpoint, isStageCompleted, loadCheckpoint, saveCheckpoint } from "../business/publish-from-spu/checkpoint.js";
import {
  verifyPublishedProductInDoudianList,
  type DoudianProductListVerificationResult
} from "../business/publish-from-spu/product-list-verification-action.js";
import {
  evaluatePublishResult,
  shouldRetryPublishFailure
} from "../business/publish-from-spu/publish-rules.js";
import { logInfo } from "../utils/logger.js";
import { shopCodeFromFolder } from "./product-category.js";
import { recordPublishFailure, type PublishFailureCircuitState } from "./failure-circuit-breaker.js";
import { buildPublishTargetIdentity, publishTargetKey } from "./publish-identity.js";
import {
  extractWatermarkNo,
  findPublishManifestEntry,
  isManifestEntrySafelyPublishedForIdentity,
  loadPublishManifest,
  normalizePublishProductIdentity,
  savePublishPlan,
  upsertPublishManifestEntry
} from "./publish-manifest.js";
import { readWorkbookRows } from "./xlsx-lite.js";
import type { PublishFromSpuMetadata } from "../business/publish-from-spu/types.js";
import type { FeishuProductRecord } from "../feishu/types.js";
import type { PublishTargetIdentity } from "./publish-identity.js";
import type { PublishProductIdentity } from "./publish-manifest.js";
import type { PublishArtifact } from "./types.js";

type ProductWorkbookFields = {
  title: string;
  shortTitle: string;
  brand: string;
  spu: string;
  modelSpec: string;
  productPriceText: string;
};

type PublishPreflightError = {
  productFolder: string;
  message: string;
};

export function buildPublishJobMetadata(input: {
  workbookFields: ProductWorkbookFields;
  feishuProductRecord: FeishuProductRecord;
  targetIdentity: PublishTargetIdentity;
}): PublishFromSpuMetadata {
  const { workbookFields, feishuProductRecord, targetIdentity } = input;
  if (feishuProductRecord.recordId !== targetIdentity.recordId) {
    throw new Error(
      `Feishu product recordId ${feishuProductRecord.recordId} does not match canonical identity recordId ${targetIdentity.recordId}.`
    );
  }
  return {
    brand: feishuProductRecord.brand || workbookFields.brand,
    spu: feishuProductRecord.spu || workbookFields.spu,
    title: workbookFields.title,
    shortTitle: feishuProductRecord.shortTitle || workbookFields.shortTitle,
    modelSpec: workbookFields.modelSpec || "盒装",
    productPriceText: feishuProductRecord.productPriceText || workbookFields.productPriceText,
    feishuRecordId: targetIdentity.recordId,
    productCategory: feishuProductRecord.productCategory,
    manufacturerName: feishuProductRecord.manufacturerName,
    manufacturerAddress: feishuProductRecord.manufacturerAddress,
    netContent: feishuProductRecord.netContent,
    productStandardCode: feishuProductRecord.productStandardCode,
    ingredients: feishuProductRecord.ingredients,
    healthFunction: feishuProductRecord.healthFunction,
    specification: feishuProductRecord.specification,
    canonicalIdentity: { ...targetIdentity }
  };
}

function normalizeShopName(value: string): string {
  return value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
}

function getExpectedShopWatermarkVariants(shopFolder: string): string[] {
  const expectedShopName = normalizeShopName(path.basename(shopFolder));
  const variants = new Set<string>([expectedShopName]);

  if (expectedShopName.includes("延草纲目健康护理专营店")) {
    variants.add("延草纲目健康护理旗舰店");
  }
  if (expectedShopName.includes("延草纲目健康护理旗舰店")) {
    variants.add("延草纲目健康护理专营店");
  }

  return [...variants];
}

function isImageFile(name: string): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(name);
}

function isDetailImageFile(name: string): boolean {
  return /(资质|医疗器械注册证|医疗器械备案|白装展开图|包装展开图).*\.(png|jpg|jpeg|webp)$/i.test(name);
}

function findWorkbookFile(productFolder: string): string {
  const workbook = fs.readdirSync(productFolder).find((name) => name.toLowerCase().endsWith(".xlsx"));
  if (!workbook) {
    throw new Error(`No workbook found in product folder: ${productFolder}`);
  }
  return path.join(productFolder, workbook);
}

function readProductWorkbookFields(workbookFile: string): ProductWorkbookFields {
  const rows = readWorkbookRows(workbookFile);
  return {
    title: rows[1]?.[1]?.trim() || "",
    shortTitle: rows[2]?.[1]?.trim() || "",
    brand: rows[3]?.[1]?.trim() || "",
    spu: rows[4]?.[1]?.trim() || "",
    modelSpec: rows[5]?.[1]?.trim() || "盒装",
    productPriceText: rows.find((row) => (row[0] || "").trim() === "产品价格")?.[1]?.trim() || ""
  };
}

function validateWorkbookFields(fields: ProductWorkbookFields): string[] {
  const missing: string[] = [];
  if (!fields.title.trim()) {
    missing.push("title");
  }
  if (!fields.shortTitle.trim()) {
    missing.push("shortTitle");
  }
  if (!fields.brand.trim()) {
    missing.push("brand");
  }
  if (!fields.spu.trim()) {
    missing.push("spu");
  }
  if (!fields.modelSpec.trim()) {
    missing.push("modelSpec");
  }
  if (!fields.productPriceText.trim()) {
    missing.push("productPriceText");
  }
  return missing;
}

function validateProductFolderAssets(productFolder: string, shopFolder: string): string[] {
  const expectedShopNames = getExpectedShopWatermarkVariants(shopFolder);
  const imageFiles = fs.readdirSync(productFolder).filter((name) => isImageFile(name));
  const detailImages = imageFiles.filter((name) => isDetailImageFile(name));
  const mainCandidates = imageFiles.filter((name) => !isDetailImageFile(name));
  const errors: string[] = [];

  if (mainCandidates.length === 0) {
    errors.push("No generated watermarked main image candidate was found.");
  } else {
    const normalizedMainNames = mainCandidates.map((name) => normalizeShopName(name));
    if (!normalizedMainNames.some((name) => expectedShopNames.some((expectedShopName) => name.includes(expectedShopName)))) {
      errors.push(`No main image candidate matched current shop watermark: ${expectedShopNames.join(" / ")}`);
    }
  }

  if (detailImages.length === 0) {
    errors.push("No qualification detail images were found.");
  }

  return errors;
}

function runPreflightForProductFolder(productFolder: string): PublishPreflightError[] {
  const errors: PublishPreflightError[] = [];
  const shopFolder = path.dirname(productFolder);

  try {
    const workbookFile = findWorkbookFile(productFolder);
    const fields = readProductWorkbookFields(workbookFile);
    for (const field of validateWorkbookFields(fields)) {
      errors.push({
        productFolder,
        message: `Workbook fields were incomplete: ${field}`
      });
    }
  } catch (error) {
    errors.push({
      productFolder,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  for (const message of validateProductFolderAssets(productFolder, shopFolder)) {
    errors.push({ productFolder, message });
  }

  return errors;
}

export function publishRuntimeKey(productFolder: string): string {
  const shopName = path.basename(path.dirname(productFolder));
  const productName = path.basename(productFolder);
  return `${shopName}__${productName}`.replace(/[\/\\:*?"<>|]/g, "_");
}

function wasPublishCompleted(runtimeDir: string): boolean {
  const checkpointCompleted = isStageCompleted(loadCheckpoint(runtimeDir), "publish_flow");
  const resultFile = path.join(runtimeDir, "result.json");
  if (!fs.existsSync(resultFile)) {
    if (checkpointCompleted) {
      clearCheckpoint(runtimeDir);
    }
    return false;
  }
  try {
    const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
      ok?: boolean;
      status?: string;
      message?: string;
      data?: {
        browser?: {
          publishClicked?: boolean;
          publishClickAttempted?: boolean;
          publishIssue?: string;
        };
      };
    };
    const resultCompleted = evaluatePublishResult({
      ok: result.ok,
      status: result.status,
      message: result.message,
      publishClicked: result.data?.browser?.publishClicked,
      publishClickAttempted: result.data?.browser?.publishClickAttempted,
      publishIssue: result.data?.browser?.publishIssue
    }).safelyPublished;
    if (!resultCompleted && checkpointCompleted) {
      clearCheckpoint(runtimeDir);
    }
    return resultCompleted;
  } catch {
    if (checkpointCompleted) {
      clearCheckpoint(runtimeDir);
    }
    return false;
  }
}

function readPublishResultSummary(resultFile: string): {
  ok?: boolean;
  status?: string;
  message?: string;
  publishClicked?: boolean;
  publishClickAttempted?: boolean;
  publishIssue?: string;
} {
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
    ok?: boolean;
    status?: string;
    message?: string;
    data?: {
      browser?: {
        publishClicked?: boolean;
        publishClickAttempted?: boolean;
        publishIssue?: string;
      };
    };
  };
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    publishClicked: result.data?.browser?.publishClicked,
    publishClickAttempted: result.data?.browser?.publishClickAttempted,
    publishIssue: result.data?.browser?.publishIssue
  };
}

function markPublishResultListVerified(resultFile: string, verification: DoudianProductListVerificationResult): void {
  if (!fs.existsSync(resultFile)) {
    return;
  }
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as Record<string, unknown>;
  result.ok = true;
  result.status = "published";
  result.finalVerifyStatus = "list_verified";
  result.message = `Read-only Doudian 全部 tab full-title verification found the product in the target shop${verification.countText ? ` (${verification.countText})` : ""}.`;
  result.listVerification = {
    method: "doudian_all_tab_full_title_search",
    title: verification.title,
    shopFolder: verification.shopFolder,
    shopName: verification.shopName,
    countText: verification.countText,
    matchedRows: verification.matchedRows,
    pageUrl: verification.pageUrl,
    screenshotFile: verification.screenshotFile,
    verifiedAt: new Date().toISOString()
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n");
}

export function selectLatestFailedPublishResult<T extends { ok: boolean; finalVerifyStatus?: string; status?: string }>(
  results: T[]
): T | undefined {
  return [...results].reverse().find((item) => !item.ok || item.status === "failed" || item.finalVerifyStatus === "needs_manual_review");
}

export async function publishDistributedProducts(options: {
  runtimeDir: string;
  distributedFolders: string[];
  productIdentity?: PublishProductIdentity;
  feishuProductRecord?: FeishuProductRecord;
  simulateOnly: boolean;
  assertNotPaused?: () => void;
  onProgress?: (message: string) => void;
}): Promise<PublishArtifact> {
  const productIdentity = normalizePublishProductIdentity(options.productIdentity);
  const productIdentityFields = productIdentity || {};
  if (!productIdentity?.batchFingerprint || !productIdentity.recordId || !productIdentity.taskId) {
    throw new Error("Publish requires batchFingerprint, recordId, and taskId canonical identity.");
  }
  if (!options.feishuProductRecord) {
    throw new Error("Publish requires the current normalized FeishuProductRecord.");
  }
  if (options.feishuProductRecord.recordId !== productIdentity.recordId) {
    throw new Error(
      `Feishu product recordId ${options.feishuProductRecord.recordId} does not match canonical identity recordId ${productIdentity.recordId}.`
    );
  }
  const targetContextForFolder = (productFolder: string) => {
    const watermarkNo = extractWatermarkNo(productFolder);
    if (!watermarkNo) {
      throw new Error(`Publish product folder is missing a watermark number: ${productFolder}`);
    }
    const targetIdentity = buildPublishTargetIdentity({
      batchFingerprint: productIdentity.batchFingerprint as string,
      recordId: productIdentity.recordId as string,
      taskId: productIdentity.taskId as string,
      shopCode: shopCodeFromFolder(path.dirname(productFolder)),
      watermarkNo
    });
    const targetKey = publishTargetKey(targetIdentity);
    return { targetIdentity, targetKey, runtimeKey: targetKey };
  };
  const orderedFolders = [...options.distributedFolders].sort((a, b) => {
    const shopDiff = path.dirname(a).localeCompare(path.dirname(b), "zh-CN");
    if (shopDiff !== 0) {
      return shopDiff;
    }
    return path.basename(a).localeCompare(path.basename(b), "zh-CN");
  });

  const manifest = loadPublishManifest(options.runtimeDir);
  const plan = orderedFolders.map((productFolder) => {
    const { targetIdentity, targetKey, runtimeKey } = targetContextForFolder(productFolder);
    const manifestEntry = findPublishManifestEntry(manifest, targetKey);
    if (isManifestEntrySafelyPublishedForIdentity(manifestEntry, productIdentity)) {
      return {
        targetIdentity,
        targetKey,
        productFolder,
        runtimeKey,
        action: "skip" as const,
        reason: `manifest:${manifestEntry?.finalVerifyStatus}:identity_matched`,
        manifestStatus: manifestEntry?.status,
        finalVerifyStatus: manifestEntry?.finalVerifyStatus
      };
    }
    const resultFile = path.join(options.runtimeDir, "publish", runtimeKey, "result.json");
    if (fs.existsSync(resultFile)) {
      const decision = evaluatePublishResult(readPublishResultSummary(resultFile));
      if (decision.safelyPublished) {
        return {
          targetIdentity,
          targetKey,
          productFolder,
          runtimeKey,
          action: "skip" as const,
          reason: `result:${decision.finalVerifyStatus}`,
          manifestStatus: "published",
          finalVerifyStatus: decision.finalVerifyStatus
        };
      }
    }
    return {
      targetIdentity,
      targetKey,
      productFolder,
      runtimeKey,
      action: "publish" as const,
      reason: manifestEntry?.message || "no safe published checkpoint",
      manifestStatus: manifestEntry?.status,
      finalVerifyStatus: manifestEntry?.finalVerifyStatus
    };
  });
  savePublishPlan(options.runtimeDir, plan);

  const alreadyPublishedResults: PublishArtifact["results"] = [];

  const pendingFolders = orderedFolders.filter((productFolder) => {
    const { targetIdentity, targetKey, runtimeKey } = targetContextForFolder(productFolder);
    const publishRuntimeDir = path.join(options.runtimeDir, "publish", runtimeKey);
    const planItem = plan.find((item) => item.runtimeKey === runtimeKey);
    if (planItem?.action === "skip") {
      alreadyPublishedResults.push({
        targetIdentity,
        targetKey,
        productFolder,
        ok: true,
        status: "published",
        message: `Skipped because publish plan marked it completed: ${planItem.reason}`,
        resultFile: path.join(publishRuntimeDir, "result.json"),
        finalVerifyStatus: planItem.finalVerifyStatus
      });
      return false;
    }
    if (productIdentity || !wasPublishCompleted(publishRuntimeDir)) {
      return true;
    }

    upsertPublishManifestEntry(options.runtimeDir, {
      ...targetContextForFolder(productFolder),
      productFolder,
      runtimeKey,
      shopFolder: path.dirname(productFolder),
      watermarkNo: extractWatermarkNo(productFolder),
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      resultFile: path.join(publishRuntimeDir, "result.json"),
      message: "Recovered from legacy completed result file.",
      ...productIdentityFields
    });
    alreadyPublishedResults.push({
      targetIdentity,
      targetKey,
      productFolder,
      ok: true,
      status: "published",
      message: "Skipped because this product was already published in a previous run.",
      resultFile: path.join(publishRuntimeDir, "result.json"),
      finalVerifyStatus: "publish_signal_confirmed"
    });
    return false;
  });

  const preflightErrors = pendingFolders.flatMap((productFolder) => runPreflightForProductFolder(productFolder));
  const metadataByTargetKey = new Map(
    pendingFolders.map((productFolder) => {
      const { targetIdentity, targetKey } = targetContextForFolder(productFolder);
      let workbookFields: ProductWorkbookFields;
      try {
        workbookFields = readProductWorkbookFields(findWorkbookFile(productFolder));
      } catch (error) {
        if (!options.simulateOnly) {
          throw error;
        }
        workbookFields = {
          title: "",
          shortTitle: "",
          brand: "",
          spu: "",
          modelSpec: "",
          productPriceText: ""
        };
      }
      return [
        targetKey,
        buildPublishJobMetadata({
          workbookFields,
          feishuProductRecord: options.feishuProductRecord as FeishuProductRecord,
          targetIdentity
        })
      ] as const;
    })
  );
  if (options.simulateOnly) {
    return {
      preflightErrors,
      results: pendingFolders.map((productFolder) => {
        const { targetIdentity, targetKey } = targetContextForFolder(productFolder);
        return {
          targetIdentity,
          targetKey,
          productFolder,
          ok: true,
          status: preflightErrors.some((item) => item.productFolder === productFolder)
            ? "simulated_with_preflight_warnings"
            : "simulated",
          message: preflightErrors
            .filter((item) => item.productFolder === productFolder)
            .map((item) => item.message)
            .join(" | ") || "Publish simulated."
        };
      }).concat(alreadyPublishedResults),
      simulated: true
    };
  }

  if (preflightErrors.length > 0) {
    throw new Error(
      `Publish preflight failed for ${preflightErrors.length} issue(s): ${preflightErrors
        .map((item) => `${path.basename(item.productFolder)} -> ${item.message}`)
        .join(" | ")}`
    );
  }

  const results: PublishArtifact["results"] = [...alreadyPublishedResults];
  let failureCircuit: PublishFailureCircuitState = { signature: "", consecutive: 0, open: false };
  let openedCircuit: PublishFailureCircuitState | undefined;
  for (const productFolder of pendingFolders) {
    options.assertNotPaused?.();
    const shopFolder = path.dirname(productFolder);
    const { targetIdentity, targetKey, runtimeKey } = targetContextForFolder(productFolder);
    const metadata = metadataByTargetKey.get(targetKey);
    if (!metadata) {
      throw new Error(`Publish metadata was not built for canonical target: ${targetKey}`);
    }
    const startMessage = `Publishing product folder: ${path.basename(productFolder)} (${path.basename(shopFolder)})`;
    logInfo(startMessage.replace(/^Publishing/, "publishing"));
    options.onProgress?.(startMessage);
    upsertPublishManifestEntry(options.runtimeDir, {
      targetIdentity,
      targetKey,
      productFolder,
      runtimeKey,
      shopFolder,
      watermarkNo: extractWatermarkNo(productFolder),
      status: "pending",
      finalVerifyStatus: "not_checked",
      resultFile: path.join(options.runtimeDir, "publish", runtimeKey, "result.json"),
      message: "Publish flow is running.",
      ...productIdentityFields
    });

    let publishResult = await runPublishFromSpuJob(
      {
        shopFolder,
        productFolder,
        mode: "run_publish_flow",
        metadata,
        headless: false,
        retryOnSystemError: true
      },
      {
        runId: `auto-listing-${runtimeKey}`,
        runtimeDir: path.join(options.runtimeDir, "publish", runtimeKey),
        onProgress: (message) => {
          const progressMessage = `${path.basename(productFolder)}: ${message}`;
          upsertPublishManifestEntry(options.runtimeDir, {
            targetIdentity,
            targetKey,
            productFolder,
            runtimeKey,
            shopFolder,
            watermarkNo: extractWatermarkNo(productFolder),
            status: "pending",
            finalVerifyStatus: "not_checked",
            resultFile: path.join(options.runtimeDir, "publish", runtimeKey, "result.json"),
            message: progressMessage,
            ...productIdentityFields
          });
          options.onProgress?.(progressMessage);
        }
      }
    );
    let resultSummary = readPublishResultSummary(publishResult.artifacts.resultFile);
    let decision = evaluatePublishResult(resultSummary);
    for (let retryAttempt = 0; !decision.safelyPublished && shouldRetryPublishFailure(decision.errorClass, retryAttempt); retryAttempt += 1) {
      options.assertNotPaused?.();
      logInfo(
        `retrying publish after retryable system failure: ${path.basename(productFolder)} (${path.basename(shopFolder)}) - ${decision.errorClass}; attempt ${retryAttempt + 1}`
      );
      options.onProgress?.(
        `Retrying publish for ${path.basename(productFolder)} (${path.basename(shopFolder)}): ${decision.errorClass}; attempt ${retryAttempt + 1}`
      );
      upsertPublishManifestEntry(options.runtimeDir, {
        targetIdentity,
        targetKey,
        productFolder,
        runtimeKey,
        shopFolder,
        watermarkNo: extractWatermarkNo(productFolder),
        status: "pending",
        finalVerifyStatus: "not_checked",
        resultFile: publishResult.artifacts.resultFile,
        message: `Retrying after ${decision.errorClass}: ${decision.issue}`,
        ...productIdentityFields
      });
      publishResult = await runPublishFromSpuJob(
        {
          shopFolder,
          productFolder,
          mode: "run_publish_flow",
          metadata,
          headless: false,
          retryOnSystemError: true
        },
        {
          runId: `auto-listing-${runtimeKey}-retry-${retryAttempt + 1}`,
          runtimeDir: path.join(options.runtimeDir, "publish", runtimeKey),
          onProgress: (message) => {
            const progressMessage = `${path.basename(productFolder)}: ${message}`;
            upsertPublishManifestEntry(options.runtimeDir, {
              targetIdentity,
              targetKey,
              productFolder,
              runtimeKey,
              shopFolder,
              watermarkNo: extractWatermarkNo(productFolder),
              status: "pending",
              finalVerifyStatus: "not_checked",
              resultFile: path.join(options.runtimeDir, "publish", runtimeKey, "result.json"),
              message: progressMessage,
              ...productIdentityFields
            });
            options.onProgress?.(progressMessage);
          }
        }
      );
      resultSummary = readPublishResultSummary(publishResult.artifacts.resultFile);
      decision = evaluatePublishResult(resultSummary);
    }
    let replayedAfterListVerificationNotFound = false;
    if (!decision.safelyPublished && decision.finalVerifyStatus === "submit_accepted_unconfirmed") {
      options.assertNotPaused?.();
      let listVerification: DoudianProductListVerificationResult | undefined;
      try {
        listVerification = await verifyPublishedProductInDoudianList({
          runtimeDir: path.join(options.runtimeDir, "publish", runtimeKey),
          shopFolder,
          title: metadata.title || ""
        });
      } catch (error) {
        const message = `Doudian list full-title verification failed after uncertain final submit: ${error instanceof Error ? error.message : String(error)}`;
        logInfo(message);
        options.onProgress?.(message);
      }

      if (listVerification?.found) {
        const message = `Read-only Doudian 全部 tab full-title verification found product: ${path.basename(productFolder)} (${path.basename(shopFolder)})`;
        markPublishResultListVerified(publishResult.artifacts.resultFile, listVerification);
        publishResult = {
          ...publishResult,
          ok: true,
          status: "published",
          message
        };
        decision = {
          safelyPublished: true,
          finalVerifyStatus: "list_verified",
          errorClass: "",
          issue: ""
        };
      } else if (listVerification?.found === false) {
        replayedAfterListVerificationNotFound = true;
        logInfo(`Retrying publish after Doudian list verification returned no product: ${path.basename(productFolder)} (${path.basename(shopFolder)})`);
        options.onProgress?.(
          `Retrying publish after Doudian list verification returned no product: ${path.basename(productFolder)} (${path.basename(shopFolder)})`
        );
        upsertPublishManifestEntry(options.runtimeDir, {
          targetIdentity,
          targetKey,
          productFolder,
          runtimeKey,
          shopFolder,
          watermarkNo: extractWatermarkNo(productFolder),
          status: "pending",
          finalVerifyStatus: "not_checked",
          resultFile: publishResult.artifacts.resultFile,
          message: "Doudian 全部 tab full-title verification returned no product; replaying publish once.",
          ...productIdentityFields
        });
        publishResult = await runPublishFromSpuJob(
          {
            shopFolder,
            productFolder,
            mode: "run_publish_flow",
            metadata,
            headless: false,
            retryOnSystemError: true
          },
          {
            runId: `auto-listing-${runtimeKey}-list-verification-retry`,
            runtimeDir: path.join(options.runtimeDir, "publish", runtimeKey),
            onProgress: (message) => {
              const progressMessage = `${path.basename(productFolder)}: ${message}`;
              upsertPublishManifestEntry(options.runtimeDir, {
                targetIdentity,
                targetKey,
                productFolder,
                runtimeKey,
                shopFolder,
                watermarkNo: extractWatermarkNo(productFolder),
                status: "pending",
                finalVerifyStatus: "not_checked",
                resultFile: path.join(options.runtimeDir, "publish", runtimeKey, "result.json"),
                message: progressMessage,
                ...productIdentityFields
              });
              options.onProgress?.(progressMessage);
            }
          }
        );
        resultSummary = readPublishResultSummary(publishResult.artifacts.resultFile);
        decision = evaluatePublishResult(resultSummary);
      }
    }
    if (!decision.safelyPublished && replayedAfterListVerificationNotFound && decision.finalVerifyStatus === "submit_accepted_unconfirmed") {
      options.assertNotPaused?.();
      try {
        const listVerification = await verifyPublishedProductInDoudianList({
          runtimeDir: path.join(options.runtimeDir, "publish", runtimeKey),
          shopFolder,
          title: metadata.title || ""
        });
        if (listVerification.found) {
          const message = `Read-only Doudian 全部 tab full-title verification found product after replay: ${path.basename(productFolder)} (${path.basename(shopFolder)})`;
          markPublishResultListVerified(publishResult.artifacts.resultFile, listVerification);
          publishResult = {
            ...publishResult,
            ok: true,
            status: "published",
            message
          };
          decision = {
            safelyPublished: true,
            finalVerifyStatus: "list_verified",
            errorClass: "",
            issue: ""
          };
        }
      } catch (error) {
        const message = `Doudian list full-title verification failed after replay: ${error instanceof Error ? error.message : String(error)}`;
        logInfo(message);
        options.onProgress?.(message);
      }
    }

    results.push({
      targetIdentity,
      targetKey,
      productFolder,
      ok: publishResult.ok,
      status: publishResult.status,
      message: publishResult.message,
      resultFile: publishResult.artifacts.resultFile,
      finalVerifyStatus: decision.finalVerifyStatus,
      errorClass: decision.errorClass
    });
    upsertPublishManifestEntry(options.runtimeDir, {
      targetIdentity,
      targetKey,
      productFolder,
      runtimeKey,
      shopFolder,
      watermarkNo: extractWatermarkNo(productFolder),
      status: decision.safelyPublished ? "published" : "failed",
      finalVerifyStatus: decision.finalVerifyStatus,
      resultFile: publishResult.artifacts.resultFile,
      message: publishResult.message,
      errorClass: decision.errorClass,
      ...productIdentityFields
    });

    const checkpointFile = path.join(options.runtimeDir, "publish", runtimeKey);
    if (!decision.safelyPublished) {
      logInfo(`publish failed: ${path.basename(productFolder)} (${path.basename(shopFolder)}) - ${publishResult.message}`);
      options.onProgress?.(
        `Publish failed: ${path.basename(productFolder)} (${path.basename(shopFolder)}) - ${publishResult.message}`
      );
      clearCheckpoint(checkpointFile);
      if (decision.finalVerifyStatus === "not_checked") {
        openedCircuit = {
          signature: `publish:${decision.errorClass || "not_checked"}`,
          consecutive: 1,
          open: true
        };
        logInfo(`publish batch stopped after unsafe pre-submit failure: ${openedCircuit.signature}`);
        options.onProgress?.(`Publish batch stopped after unsafe pre-submit failure: ${openedCircuit.signature}`);
        break;
      }
      failureCircuit = recordPublishFailure(failureCircuit, {
        stage: "publish",
        errorClass: decision.errorClass,
        threshold: 2
      });
      if (failureCircuit.open) {
        openedCircuit = failureCircuit;
        logInfo(`publish batch circuit opened: ${failureCircuit.signature}; consecutive=${failureCircuit.consecutive}`);
        options.onProgress?.(`Publish batch circuit opened: ${failureCircuit.signature}; consecutive=${failureCircuit.consecutive}`);
        break;
      }
      continue;
    }
    failureCircuit = { signature: "", consecutive: 0, open: false };
    logInfo(
      `publish completed: ${path.basename(productFolder)} (${path.basename(shopFolder)}) - ${decision.finalVerifyStatus}`
    );
    options.onProgress?.(
      `Publish completed: ${path.basename(productFolder)} (${path.basename(shopFolder)}) - ${decision.finalVerifyStatus}`
    );
    saveCheckpoint(checkpointFile, [{ step: "publish_flow", status: "completed" }]);
  }

  return {
    preflightErrors: [],
    results,
    circuitBreaker: openedCircuit,
    simulated: false
  };
}
