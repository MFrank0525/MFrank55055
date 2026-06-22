import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAutoListingJob } from "../dist/src/autolist/orchestrator.js";
import { getShopSpecs } from "../dist/src/autolist/product-category.js";
import {
  FEISHU_CACHE_SCHEMA_VERSION,
  FEISHU_FIELD_MAP_VERSION
} from "../dist/src/feishu/cache-contract.js";
import { buildFeishuBatchFingerprint } from "../dist/src/autolist/feishu-batch-rules.js";

const BUSINESS_STEPS = [
  "selling_points_loaded",
  "poster_prompts_generated",
  "main_images_generated",
  "product_folders_built",
  "titles_generated",
  "titles_distributed",
  "metadata_enriched",
  "qualifications_attached",
  "shop_distributed",
  "published",
  "cleaned"
];

function mkdir(target) {
  fs.mkdirSync(target, { recursive: true });
  return target;
}

export async function runRepresentativeSimulation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "representative-auto-listing-"));
  const inputRoot = mkdir(path.join(root, "input", "auto-listing"));
  const feishuImageDir = mkdir(path.join(inputRoot, "feishu-images"));
  const mainImageWorkDir = mkdir(path.join(inputRoot, "main-images"));
  const titleDir = mkdir(path.join(inputRoot, "titles"));
  const qualificationDir = mkdir(path.join(inputRoot, "qualifications"));
  const shopRootDir = mkdir(path.join(inputRoot, "shops"));
  for (const shop of getShopSpecs()) {
    mkdir(path.join(shopRootDir, `${shop.shopCode}${shop.watermarkText}`));
  }

  const fixtureImage = path.resolve("input/fixed-main-images/辅助图02.png");
  const sourceImage = path.join(feishuImageDir, "representative-white.png");
  const qualificationImage = path.join(qualificationDir, "representative-qualification.png");
  fs.copyFileSync(fixtureImage, sourceImage);
  fs.copyFileSync(fixtureImage, qualificationImage);

  const record = JSON.parse(fs.readFileSync("scripts/fixtures/representative-feishu-product.json", "utf8"));
  record.whiteBackgroundImages = [{ fileToken: "fixture-white", name: path.basename(sourceImage), localFile: sourceImage, raw: {} }];
  record.qualificationImages = [{ fileToken: "fixture-qualification", name: path.basename(qualificationImage), localFile: qualificationImage, raw: {} }];
  const feishuProductDataFile = path.join(root, "data", "feishu", "products.json");
  mkdir(path.dirname(feishuProductDataFile));
  fs.writeFileSync(feishuProductDataFile, JSON.stringify({
    schemaVersion: FEISHU_CACHE_SCHEMA_VERSION,
    fieldMapVersion: FEISHU_FIELD_MAP_VERSION,
    batchFingerprint: buildFeishuBatchFingerprint([record]),
    ok: true,
    count: 1,
    records: [record]
  }, null, 2));

  const runtimeRootDir = mkdir(path.join(root, "data", "auto-listing", "runs"));
  const result = await runAutoListingJob({
    runId: "representative-simulation",
    runtimeDir: path.join(runtimeRootDir, "representative-simulation"),
    input: {
      feishuImageDir,
      mainImageWorkDir,
      titleDir,
      qualificationDir,
      feishuProductDataFile,
      shopRootDir,
      runtimeRootDir,
      processedImageManifest: path.join(root, "data", "auto-listing", "processed-images.json"),
      paidImageSubmissionLedgerDir: path.join(root, "data", "auto-listing", "paid-image-submissions"),
      pauseSignalFile: path.join(root, "data", "auto-listing", "pause.requested"),
      archiveMainImageDir: path.join(root, "archive"),
      imageGenerationProvider: "openai-compatible",
      mainImageExpectedCount: 4,
      mainImageCountStrategy: "require_exact",
      titleCount: 20,
      maxImagesPerRun: 1,
      serialOnly: true,
      stopOnError: true,
      cleanupAfterPublish: true,
      cleanupSourceImageAfterPublish: true,
      clearTestOutputsBeforeRun: false,
      simulateOnly: true
    }
  });

  const eventLines = fs.readFileSync(result.artifacts.eventFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const eventSteps = eventLines.map((line) => JSON.parse(line).step);
  const observedSteps = BUSINESS_STEPS.filter((step) => eventSteps.includes(step));
  return { root, result, observedSteps };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const evidence = await runRepresentativeSimulation();
  console.log(JSON.stringify({
    ok: evidence.result.ok,
    runId: evidence.result.runId,
    taskCount: evidence.result.tasks.length,
    observedSteps: evidence.observedSteps
  }, null, 2));
}
