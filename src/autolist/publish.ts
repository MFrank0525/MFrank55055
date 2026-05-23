import fs from "node:fs";
import path from "node:path";
import { runPublishFromSpuJob } from "../business/publish-from-spu.js";
import { clearCheckpoint, isStageCompleted, loadCheckpoint, saveCheckpoint } from "../business/publish-from-spu/checkpoint.js";
import { evaluatePublishResult } from "../business/publish-from-spu/publish-rules.js";
import { logInfo } from "../utils/logger.js";
import {
  extractWatermarkNo,
  findPublishManifestEntry,
  isManifestEntrySafelyPublished,
  loadPublishManifest,
  savePublishPlan,
  upsertPublishManifestEntry
} from "./publish-manifest.js";
import { readWorkbookRows } from "./xlsx-lite.js";
import type { PublishArtifact } from "./types.js";

type ProductWorkbookFields = {
  title: string;
  shortTitle: string;
  brand: string;
  spu: string;
  modelSpec: string;
};

type PublishPreflightError = {
  productFolder: string;
  message: string;
};

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
    modelSpec: rows[5]?.[1]?.trim() || "盒装"
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
      data?: {
        browser?: {
          publishClicked?: boolean;
        };
      };
    };
    const resultCompleted = result.ok === true && result.status === "published" && result.data?.browser?.publishClicked === true;
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

function readPublishResultSummary(resultFile: string): { ok?: boolean; status?: string; message?: string; publishClicked?: boolean; publishIssue?: string } {
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as {
    ok?: boolean;
    status?: string;
    message?: string;
    data?: {
      browser?: {
        publishClicked?: boolean;
        publishIssue?: string;
      };
    };
  };
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
    publishClicked: result.data?.browser?.publishClicked,
    publishIssue: result.data?.browser?.publishIssue
  };
}

export async function publishDistributedProducts(options: {
  runtimeDir: string;
  distributedFolders: string[];
  simulateOnly: boolean;
  assertNotPaused?: () => void;
}): Promise<PublishArtifact> {
  const orderedFolders = [...options.distributedFolders].sort((a, b) => {
    const shopDiff = path.dirname(a).localeCompare(path.dirname(b), "zh-CN");
    if (shopDiff !== 0) {
      return shopDiff;
    }
    return path.basename(a).localeCompare(path.basename(b), "zh-CN");
  });

  const manifest = loadPublishManifest(options.runtimeDir);
  const plan = orderedFolders.map((productFolder) => {
    const runtimeKey = publishRuntimeKey(productFolder);
    const manifestEntry = findPublishManifestEntry(manifest, runtimeKey);
    if (isManifestEntrySafelyPublished(manifestEntry)) {
      return {
        productFolder,
        runtimeKey,
        action: "skip" as const,
        reason: `manifest:${manifestEntry?.finalVerifyStatus}`,
        manifestStatus: manifestEntry?.status,
        finalVerifyStatus: manifestEntry?.finalVerifyStatus
      };
    }
    const resultFile = path.join(options.runtimeDir, "publish", runtimeKey, "result.json");
    if (fs.existsSync(resultFile)) {
      const decision = evaluatePublishResult(readPublishResultSummary(resultFile));
      if (decision.safelyPublished) {
        return {
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
    const runtimeKey = publishRuntimeKey(productFolder);
    const publishRuntimeDir = path.join(options.runtimeDir, "publish", runtimeKey);
    const planItem = plan.find((item) => item.runtimeKey === runtimeKey);
    if (planItem?.action === "skip") {
      alreadyPublishedResults.push({
        productFolder,
        ok: true,
        status: "published",
        message: `Skipped because publish plan marked it completed: ${planItem.reason}`,
        resultFile: path.join(publishRuntimeDir, "result.json"),
        finalVerifyStatus: planItem.finalVerifyStatus
      });
      return false;
    }
    if (!wasPublishCompleted(publishRuntimeDir)) {
      return true;
    }

    upsertPublishManifestEntry(options.runtimeDir, {
      productFolder,
      runtimeKey,
      shopFolder: path.dirname(productFolder),
      watermarkNo: extractWatermarkNo(productFolder),
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      resultFile: path.join(publishRuntimeDir, "result.json"),
      message: "Recovered from legacy completed result file."
    });
    alreadyPublishedResults.push({
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
  if (options.simulateOnly) {
    return {
      preflightErrors,
      results: pendingFolders.map((productFolder) => ({
        productFolder,
        ok: true,
        status: preflightErrors.some((item) => item.productFolder === productFolder)
          ? "simulated_with_preflight_warnings"
          : "simulated",
        message: preflightErrors
          .filter((item) => item.productFolder === productFolder)
          .map((item) => item.message)
          .join(" | ") || "Publish simulated."
      })).concat(alreadyPublishedResults),
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
  for (const productFolder of pendingFolders) {
    options.assertNotPaused?.();
    const shopFolder = path.dirname(productFolder);
    const fields = readProductWorkbookFields(findWorkbookFile(productFolder));
    const runtimeKey = publishRuntimeKey(productFolder);
    logInfo(`publishing product folder: ${path.basename(productFolder)} (${path.basename(shopFolder)})`);
    upsertPublishManifestEntry(options.runtimeDir, {
      productFolder,
      runtimeKey,
      shopFolder,
      watermarkNo: extractWatermarkNo(productFolder),
      status: "pending",
      finalVerifyStatus: "not_checked",
      resultFile: path.join(options.runtimeDir, "publish", runtimeKey, "result.json"),
      message: "Publish flow is running."
    });

    const publishResult = await runPublishFromSpuJob(
      {
        shopFolder,
        productFolder,
        mode: "run_publish_flow",
        metadata: {
          brand: fields.brand,
          spu: fields.spu,
          title: fields.title,
          shortTitle: fields.shortTitle,
          modelSpec: fields.modelSpec || "盒装"
        },
        headless: false,
        retryOnSystemError: true
      },
      {
        runId: `auto-listing-${runtimeKey}`,
        runtimeDir: path.join(options.runtimeDir, "publish", runtimeKey)
      }
    );
    const resultSummary = readPublishResultSummary(publishResult.artifacts.resultFile);
    const decision = evaluatePublishResult(resultSummary);

    results.push({
      productFolder,
      ok: publishResult.ok,
      status: publishResult.status,
      message: publishResult.message,
      resultFile: publishResult.artifacts.resultFile,
      finalVerifyStatus: decision.finalVerifyStatus,
      errorClass: decision.errorClass
    });
    upsertPublishManifestEntry(options.runtimeDir, {
      productFolder,
      runtimeKey,
      shopFolder,
      watermarkNo: extractWatermarkNo(productFolder),
      status: decision.safelyPublished ? "published" : "failed",
      finalVerifyStatus: decision.finalVerifyStatus,
      resultFile: publishResult.artifacts.resultFile,
      message: publishResult.message,
      errorClass: decision.errorClass
    });

    const checkpointFile = path.join(options.runtimeDir, "publish", runtimeKey);
    if (!decision.safelyPublished) {
      logInfo(`publish failed: ${path.basename(productFolder)} (${path.basename(shopFolder)}) - ${publishResult.message}`);
      clearCheckpoint(checkpointFile);
      return {
        preflightErrors: [],
        results,
        simulated: false
      };
    }
    logInfo(
      `publish completed: ${path.basename(productFolder)} (${path.basename(shopFolder)}) - ${decision.finalVerifyStatus}`
    );
    saveCheckpoint(checkpointFile, [{ step: "publish_flow", status: "completed" }]);
  }

  return {
    preflightErrors: [],
    results,
    simulated: false
  };
}
