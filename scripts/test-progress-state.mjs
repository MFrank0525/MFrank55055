import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLatestTaskProgressEvent } from "../dist/src/autolist/progress-events.js";
import {
  auditAutoListingContinuity,
  summarizeFeishuBatchProgress,
  auditMainImageGeneration,
  auditPublishCoverage
} from "../dist/src/autolist/audit-rules.js";
import {
  shouldContinueFeishuBatchAfterChildExit,
  shouldPreferActiveTaskStateSummary
} from "../dist/src/autolist/batch-continuation-rules.js";
import { selectCleanupTargets } from "../dist/src/autolist/cleanup-rules.js";
import {
  resolveImageDownloadTimeoutMs,
  shouldRetryImageGenerationWithPolicyPrompt
} from "../dist/src/autolist/image-generation-rules.js";
import { createRunState, recordTaskProgress } from "../dist/src/autolist/state-machine.js";
import { normalizeDoubaoGeneratedTitleForDoudian } from "../dist/src/autolist/title-rules.js";
import { resolveFeishuAssetRecordForFolder } from "../dist/src/business/publish-from-spu/asset-rules.js";
import {
  classifyPublishFailure,
  evaluatePublishCreatePageReadiness,
  evaluateShopSwitchMenuState,
  shouldRetryPublishFailure
} from "../dist/src/business/publish-from-spu/publish-rules.js";

const state = createRunState("test-run", ["/tmp/product.png"]);
const task = state.tasks[0];
const before = task.lastUpdatedAt;

await new Promise((resolve) => setTimeout(resolve, 5));

const updated = recordTaskProgress(task, "main_images_generated", "Prompt 2/5: Image 4: submitting edits request.");

assert.equal(updated.status, "main_images_generated");
assert.notEqual(updated.lastUpdatedAt, before);
assert.equal(updated.notes.at(-1), "main_images_generated: Prompt 2/5: Image 4: submitting edits request.");

const saved = recordTaskProgress(updated, "main_images_generated", "Prompt 2/5: Image 4: saved generated-04.png.");

assert.equal(saved.status, "main_images_generated");
assert.equal(saved.notes.at(-1), "main_images_generated: Prompt 2/5: Image 4: saved generated-04.png.");
assert.ok(saved.notes.length <= 25);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-listing-progress-"));
const eventsFile = path.join(tempDir, "events.ndjson");
fs.writeFileSync(
  eventsFile,
  [
    JSON.stringify({ timestamp: "2026-05-23T10:01:00.000Z", level: "info", taskId: "image-001", step: "main_images_generated", message: "Prompt 1/5: Image 1: saved generated-01.png." }),
    JSON.stringify({ timestamp: "2026-05-23T10:02:00.000Z", level: "info", taskId: "image-002", step: "main_images_generated", message: "Prompt 1/5: Image 1: submitting edits request." }),
    JSON.stringify({ timestamp: "2026-05-23T10:03:00.000Z", level: "info", taskId: "image-001", step: "main_images_generated", message: "Prompt 1/5: Image 2: submitting edits request." })
  ].join("\n") + "\n",
  "utf8"
);

const latestEvent = readLatestTaskProgressEvent(eventsFile, "image-001");

assert.deepEqual(latestEvent, {
  timestamp: "2026-05-23T10:03:00.000Z",
  step: "main_images_generated",
  message: "Prompt 1/5: Image 2: submitting edits request."
});

const pageNotReadyClass = classifyPublishFailure("Platform SPU query page was not ready after navigation.");
assert.equal(pageNotReadyClass, "platform_page_not_ready");
assert.equal(shouldRetryPublishFailure(pageNotReadyClass, 0), true);
assert.equal(shouldRetryPublishFailure(pageNotReadyClass, 2), false);
assert.equal(shouldRetryPublishFailure("validation_blocked", 0), false);

const spuPrefillFailedClass = classifyPublishFailure(
  "Publish create page did not become ready after network/page-content recovery. sections=0; textLength=67; loading=false; body=spu信息填充失败"
);
assert.equal(spuPrefillFailedClass, "platform_spu_prefill_failed");
assert.equal(shouldRetryPublishFailure(spuPrefillFailedClass, 0), true);

assert.deepEqual(
  evaluatePublishCreatePageReadiness({
    usable: false,
    bodyTextLength: 67,
    sectionCount: 0,
    loading: false,
    loginRequired: false,
    bodyText: "商品发布 spu信息填充失败"
  }),
  {
    action: "reopen_from_platform_spu",
    issue: "Publish create page reported SPU prefill failure."
  }
);

const shopSwitchMissingClass = classifyPublishFailure("Shop switch failed: could not find 切换组织/店铺 for 延草纲目康复理疗专营店");
assert.equal(shopSwitchMissingClass, "shop_switch_entry_unavailable");
assert.equal(shouldRetryPublishFailure(shopSwitchMissingClass, 0), true);

const alreadyInTargetShop = evaluateShopSwitchMenuState({
  expectedShopName: "延草纲目康复理疗专营店",
  currentShopName: "延草纲目康复理疗专营店",
  menuOpened: true,
  switchEntryVisible: false
});

assert.deepEqual(alreadyInTargetShop, {
  action: "already_in_target_shop",
  issue: ""
});

const switchEntryUnavailable = evaluateShopSwitchMenuState({
  expectedShopName: "延草纲目康复理疗专营店",
  currentShopName: "延草纲目个护保健专营店",
  menuOpened: true,
  switchEntryVisible: false
});

assert.deepEqual(switchEntryUnavailable, {
  action: "retry_menu",
  issue: "Shop switch entry is unavailable while current shop does not match target."
});

const cleanupTargets = selectCleanupTargets({
  candidates: [
    "/work/input/auto-listing/feishu-images/product-1.png",
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/qualifications/product-1-cert.png",
    "/work/input/auto-listing/qualifications/product-2-cert.png"
  ],
  protectedPaths: [
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/qualifications/product-2-cert.png"
  ]
});

assert.deepEqual(cleanupTargets.sort(), [
  "/work/input/auto-listing/feishu-images/product-1.png",
  "/work/input/auto-listing/qualifications/product-1-cert.png"
]);

const sameSpuFolderMatch = resolveFeishuAssetRecordForFolder({
  folderSearchParts: [
    "延草纲目舒奈美医用医用重组Ⅲ型人源化胶原蛋白软膏水印01",
    "医用修复乳液豆包0120260524-144025.xlsx",
    "湘械注准20222141001-医用修复乳液-资质图片-01.png"
  ],
  records: [
    {
      recordId: "rec-lotion",
      spu: "湘械注准20222141001",
      brand: "舒奈美",
      userCognitionName: "医用修复乳液",
      genericName: "舒奈美医用医用重组Ⅲ型人源化胶原蛋白软膏",
      shortTitle: "SNM胶原蛋白乳液",
      whiteBackgroundImages: [{ name: "湘械注准20222141001-医用修复乳液-白底图-01.png" }],
      qualificationImages: [{ name: "湘械注准20222141001-医用修复乳液-资质图片-01.png" }]
    },
    {
      recordId: "rec-cream",
      spu: "湘械注准20222141001",
      brand: "舒奈美",
      userCognitionName: "医用修复霜",
      genericName: "舒奈美医用医用重组Ⅲ型人源化胶原蛋白软膏",
      shortTitle: "SNM胶原蛋白面霜",
      whiteBackgroundImages: [{ name: "湘械注准20222141001-医用修复霜-白底图-01.jpg" }],
      qualificationImages: [{ name: "湘械注准20222141001-医用修复霜-资质图片-01.png" }]
    }
  ]
});

assert.equal(sameSpuFolderMatch.issue, "");
assert.equal(sameSpuFolderMatch.record?.recordId, "rec-lotion");

function record(recordId, whiteImage, qualificationImage) {
  return {
    recordId,
    userCognitionName: recordId,
    genericName: "凝胶",
    brand: "宝元堂",
    spu: recordId,
    sellingPointText: "测试卖点",
    shortTitle: "测试短标题",
    rawFields: {},
    whiteBackgroundImages: whiteImage
      ? [{ fileToken: `${recordId}-white`, name: path.basename(whiteImage), localFile: whiteImage, raw: {} }]
      : [],
    qualificationImages: qualificationImage
      ? [{ fileToken: `${recordId}-cert`, name: path.basename(qualificationImage), localFile: qualificationImage, raw: {} }]
      : []
  };
}

const continuityOk = auditAutoListingContinuity({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png", "/work/input/auto-listing/qualifications/product-1-cert.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png", "/work/input/auto-listing/qualifications/product-2-cert.png"),
    record("rec-3", "/work/input/auto-listing/feishu-images/product-3.png", "/work/input/auto-listing/qualifications/product-3-cert.png")
  ],
  processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
  existingFiles: [
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/feishu-images/product-3.png",
    "/work/input/auto-listing/qualifications/product-2-cert.png",
    "/work/input/auto-listing/qualifications/product-3-cert.png"
  ],
  discoveredRunImageCount: 2
});

assert.equal(continuityOk.ok, true);
assert.equal(continuityOk.summary.recordCount, 3);
assert.equal(continuityOk.summary.processedRecordCount, 1);
assert.equal(continuityOk.summary.pendingRecordCount, 2);

const batchProgress = summarizeFeishuBatchProgress({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png"),
    record("rec-3", "/work/input/auto-listing/feishu-images/product-3.png")
  ],
  processedImages: [
    "/work/input/auto-listing/feishu-images/product-1.png",
    "/work/input/auto-listing/feishu-images/product-2.png"
  ]
});

assert.deepEqual(batchProgress, {
  recordCount: 3,
  processedRecordCount: 2,
  pendingRecordCount: 1,
  pendingSourceImages: ["/work/input/auto-listing/feishu-images/product-3.png"],
  batchComplete: false
});

assert.equal(
  shouldContinueFeishuBatchAfterChildExit({
    exitCode: 0,
    batchComplete: false
  }),
  true
);
assert.equal(
  shouldContinueFeishuBatchAfterChildExit({
    exitCode: 1,
    batchComplete: false
  }),
  false
);
assert.equal(
  shouldContinueFeishuBatchAfterChildExit({
    exitCode: 0,
    batchComplete: true
  }),
  false
);
assert.equal(
  shouldPreferActiveTaskStateSummary({
    running: true,
    stateHasActiveTask: true,
    publishProgressAvailable: true
  }),
  true
);
assert.equal(resolveImageDownloadTimeoutMs(180000), 180000);
assert.equal(resolveImageDownloadTimeoutMs(10000), 30000);
assert.equal(
  shouldRetryImageGenerationWithPolicyPrompt({
    responseOk: false,
    responseText: '{"error":{"code":"content_policy_violation"}}'
  }),
  true
);
assert.equal(
  shouldRetryImageGenerationWithPolicyPrompt({
    responseOk: false,
    responseText: '{"error":{"code":"billing"}}'
  }),
  false
);

const exactSixtyTitle = "标".repeat(60);
const exactSixtyTitleDecision = normalizeDoubaoGeneratedTitleForDoudian(exactSixtyTitle);
assert.equal(exactSixtyTitleDecision.title, exactSixtyTitle);
assert.equal(exactSixtyTitleDecision.changed, false);
assert.equal(exactSixtyTitleDecision.originalLength, 60);
assert.equal(exactSixtyTitleDecision.maxLength, 60);

const overSixtyTitle = `${"删".repeat(5)}${"留".repeat(60)}`;
const overSixtyTitleDecision = normalizeDoubaoGeneratedTitleForDoudian(overSixtyTitle);
assert.equal(overSixtyTitleDecision.title, "留".repeat(60));
assert.equal(overSixtyTitleDecision.changed, true);
assert.equal(overSixtyTitleDecision.originalLength, 65);
assert.equal(overSixtyTitleDecision.maxLength, 60);

const missingPendingAsset = auditAutoListingContinuity({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png")
  ],
  processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
  existingFiles: [],
  discoveredRunImageCount: 1
});

assert.equal(missingPendingAsset.ok, false);
assert.ok(missingPendingAsset.errors.some((issue) => issue.code === "pending_white_image_missing"));

const underDiscoveredRun = auditAutoListingContinuity({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png"),
    record("rec-3", "/work/input/auto-listing/feishu-images/product-3.png")
  ],
  processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
  existingFiles: [
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/feishu-images/product-3.png"
  ],
  discoveredRunImageCount: 1
});

assert.equal(underDiscoveredRun.ok, false);
assert.ok(underDiscoveredRun.errors.some((issue) => issue.code === "run_discovered_too_few_images"));

function taskWithMainImages(generatedFiles) {
  return {
    taskId: "image-001",
    sequenceNo: 1,
    sourceImagePath: "/work/input/source.png",
    sourceImageName: "source.png",
    status: "main_images_generated",
    lastUpdatedAt: "2026-05-23T00:00:00.000Z",
    generatedProductFolders: [],
    notes: [],
    feishuProductRecord: record("rec-main", "/work/input/source.png"),
    mainImageArtifact: {
      promptFile: "/work/run/tasks/image-001/jimeng-prompts.txt",
      generatedFiles,
      simulated: false
    }
  };
}

const completeGeneratedFiles = [1, 2].flatMap((promptIndex) =>
  [1, 2, 3, 4].map((imageIndex) => ({
    imageFile: `/work/shop/product-${promptIndex}-${imageIndex}.png`,
    rawImageFile: `/work/run/raw/generated-${promptIndex}-${imageIndex}.png`,
    productFolder: `/work/shop/product-${promptIndex}`,
    storeName: `shop-${promptIndex}`,
    promptIndex,
    promptWordFile: `/work/prompts/${promptIndex}.docx`
  }))
);

const generationOk = auditMainImageGeneration({
  tasks: [taskWithMainImages(completeGeneratedFiles)],
  existingFiles: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
  expectedPromptCount: 2,
  expectedImagesPerPrompt: 4,
  simulateOnly: false
});

assert.equal(generationOk.ok, true);
assert.equal(generationOk.summary.auditedTaskCount, 1);
assert.equal(generationOk.summary.generatedImageCount, 8);

const generationMissingPromptImage = auditMainImageGeneration({
  tasks: [taskWithMainImages(completeGeneratedFiles.slice(0, 7))],
  existingFiles: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
  expectedPromptCount: 2,
  expectedImagesPerPrompt: 4,
  simulateOnly: false
});

assert.equal(generationMissingPromptImage.ok, false);
assert.ok(generationMissingPromptImage.errors.some((issue) => issue.code === "main_image_prompt_count_mismatch"));

const generationDuplicate = auditMainImageGeneration({
  tasks: [
    taskWithMainImages([
      completeGeneratedFiles[0],
      { ...completeGeneratedFiles[1], imageFile: completeGeneratedFiles[0].imageFile },
      ...completeGeneratedFiles.slice(2)
    ])
  ],
  existingFiles: completeGeneratedFiles.flatMap((item) => [item.imageFile, item.rawImageFile, item.productFolder]),
  expectedPromptCount: 2,
  expectedImagesPerPrompt: 4,
  simulateOnly: false
});

assert.equal(generationDuplicate.ok, false);
assert.ok(generationDuplicate.errors.some((issue) => issue.code === "main_image_duplicate_file"));

const publishTask = {
  taskId: "image-001",
  sequenceNo: 1,
  sourceImagePath: "/work/input/source.png",
  sourceImageName: "source.png",
  status: "published",
  lastUpdatedAt: "2026-05-23T00:00:00.000Z",
  generatedProductFolders: ["/work/shop/product-1"],
  notes: [],
  shopDistributionArtifact: {
    distributedFolders: ["/work/shop/product-1"],
    simulated: false
  },
  publishArtifact: {
    results: [],
    simulated: false
  }
};

const publishOk = auditPublishCoverage({
  tasks: [publishTask],
  manifestEntries: [
    {
      productFolder: "/work/shop/product-1",
      runtimeKey: "shop__product-1",
      shopFolder: "/work/shop",
      watermarkNo: 1,
      status: "published",
      finalVerifyStatus: "publish_signal_confirmed",
      message: "ok",
      updatedAt: "2026-05-23T00:00:00.000Z"
    }
  ]
});

assert.equal(publishOk.ok, true);
assert.equal(publishOk.summary.expectedPublishCount, 1);
assert.equal(publishOk.summary.safelyPublishedCount, 1);

const publishMissing = auditPublishCoverage({
  tasks: [publishTask],
  manifestEntries: []
});

assert.equal(publishMissing.ok, false);
assert.ok(publishMissing.errors.some((issue) => issue.code === "publish_result_missing"));
