import fs from "node:fs";
import path from "node:path";
import { runPublishFromSpuJob } from "../business/publish-from-spu.js";
import { clearCheckpoint, isStageCompleted, loadCheckpoint, saveCheckpoint } from "../business/publish-from-spu/checkpoint.js";
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

  const alreadyPublishedResults: PublishArtifact["results"] = [];
  const pendingFolders = orderedFolders.filter((productFolder) => {
    const runtimeKey = publishRuntimeKey(productFolder);
    const publishRuntimeDir = path.join(options.runtimeDir, "publish", runtimeKey);
    if (!wasPublishCompleted(publishRuntimeDir)) {
      return true;
    }

    alreadyPublishedResults.push({
      productFolder,
      ok: true,
      status: "published",
      message: "Skipped because this product was already published in a previous run.",
      resultFile: path.join(publishRuntimeDir, "result.json")
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

    results.push({
      productFolder,
      ok: publishResult.ok,
      status: publishResult.status,
      message: publishResult.message,
      resultFile: publishResult.artifacts.resultFile
    });

    const checkpointFile = path.join(options.runtimeDir, "publish", runtimeKey);
    if (!publishResult.ok) {
      clearCheckpoint(checkpointFile);
      return {
        preflightErrors: [],
        results,
        simulated: false
      };
    }
    saveCheckpoint(checkpointFile, [{ step: "publish_flow", status: "completed" }]);
  }

  return {
    preflightErrors: [],
    results,
    simulated: false
  };
}
