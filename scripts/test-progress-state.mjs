import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLatestTaskProgressEvent } from "../dist/src/autolist/progress-events.js";
import { buildFeishuSellingPointText } from "../dist/src/autolist/selling-point-rules.js";
import {
  auditAutoListingContinuity,
  summarizeFeishuBatchProgress,
  auditMainImageGeneration,
  auditPublishCoverage
} from "../dist/src/autolist/audit-rules.js";
import {
  shouldContinueFeishuBatchAfterChildExit,
  shouldContinueFeishuAfterBatchRefresh,
  shouldRefreshFeishuAssetsBeforeFullFlow,
  shouldPreferActiveTaskStateSummary,
  selectHermesStatusResultFile,
  isHermesSupervisorProcessCommand,
  shouldResumeFeishuBatchAfterRetryableChildFailure,
  shouldResumeInterruptedTaskInPlace
} from "../dist/src/autolist/batch-continuation-rules.js";
import { buildFeishuBatchFingerprint } from "../dist/src/autolist/feishu-batch-rules.js";
import { resolvePendingFeishuProductSourceImagesFromRecords } from "../dist/src/autolist/feishu-products.js";
import { appendProcessedImages, migrateLegacyProcessedImagesToBatch, readProcessedImages } from "../dist/src/autolist/file-batch.js";
import { selectCleanupTargets } from "../dist/src/autolist/cleanup-rules.js";
import {
  evaluateImageGenerationEndpointProbe,
  resolveImageDownloadTimeoutMs,
  resolveImageGenerationRequestDeadlineMs,
  resolveImageGenerationHttpRetryPolicy,
  resolveImageGenerationTransportRetryPolicy,
  shouldRetryImageGenerationWithPolicyPrompt
} from "../dist/src/autolist/image-generation-rules.js";
import { inferResumeStartStepForTask } from "../dist/src/autolist/resume-rules.js";
import { applyResumeTaskId, createRunState, recordTaskProgress } from "../dist/src/autolist/state-machine.js";
import { normalizeDoubaoGeneratedTitleForDoudian } from "../dist/src/autolist/title-rules.js";
import { assertGeneratedTitlesBelongToProduct } from "../dist/src/autolist/title-rules.js";
import { resolveFeishuAssetRecordForFolder } from "../dist/src/business/publish-from-spu/asset-rules.js";
import {
  classifyPublishFailure,
  evaluateDetailImageCompletion,
  evaluatePriceInventoryEntryRule,
  evaluatePublishCreatePageReadiness,
  evaluateSpecTemplateCompletion,
  isUploadPlaceholderGraphicContext,
  evaluateShopSwitchMenuState,
  shouldRetryPublishFailure
} from "../dist/src/business/publish-from-spu/publish-rules.js";
import {
  looksLikeDoubaoTitleResponse,
  isRetryableDoubaoCaptureError,
  resolveDoubaoCaptureRetryPolicy
} from "../dist/src/doubao/capture-rules.js";
import { saveTitlesFromRaw } from "../dist/src/doubao/save.js";

const hermesRunnerSource = fs.readFileSync("src/cli/hermes-auto-listing-runner.ts", "utf8");
assert.match(
  hermesRunnerSource,
  /inferResumeStartStepForTask/,
  "Hermes runner must use resume-rules when building resume jobs so recoverable title-folder states resume at publish"
);
assert.match(
  hermesRunnerSource,
  /compactStatusLine/,
  "Hermes text status must compact very long log/error lines before returning them to Feishu"
);

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
assert.deepEqual(resolveDoubaoCaptureRetryPolicy("titles"), {
  maxAttempts: 4,
  delayMs: [30000, 60000, 90000]
});
assert.equal(isRetryableDoubaoCaptureError("Doubao title response was not found in the latest visible answer."), true);
assert.equal(isRetryableDoubaoCaptureError("Doubao conversation page not found"), false);
const inlineDoubaoTitles = Array.from({ length: 20 }, (_, index) => {
  const no = String(index + 1).padStart(2, "0");
  return `${no}、医用透明质酸钠液体敷料延草纲目测试内容`;
}).join("");
assert.equal(looksLikeDoubaoTitleResponse(inlineDoubaoTitles, 20), true);
const inlineTitleDir = fs.mkdtempSync(path.join(os.tmpdir(), "doubao-inline-titles-"));
const inlineRawFile = path.join(inlineTitleDir, "raw.txt");
fs.writeFileSync(inlineRawFile, inlineDoubaoTitles, "utf8");
assert.equal(
  saveTitlesFromRaw({
    rawFile: inlineRawFile,
    outputDir: inlineTitleDir,
    titleCount: 20
  }).titleCount,
  20
);

assert.equal(
  buildFeishuSellingPointText({
    userCognitionName: "医用芦荟凝胶",
    brandedGenericName: "延草纲目医用聚乙二醇护创敷料",
    sellingPointText: "120g/盒，官方正品，二类医疗器械认证"
  }),
  "120g/盒，官方正品，二类医疗器械认证"
);
assert.ok(
  !buildFeishuSellingPointText({
    userCognitionName: "医用芦荟凝胶",
    brandedGenericName: "延草纲目医用聚乙二醇护创敷料",
    sellingPointText: "120g/盒，官方正品，二类医疗器械认证"
  }).startsWith("医用芦荟凝胶,延草纲目医用聚乙二醇护创敷料")
);

const resumedState = applyResumeTaskId(createRunState("resume-run", ["/tmp/product-2.png"]), "image-002");
assert.equal(resumedState.tasks[0].taskId, "image-002");
assert.equal(resumedState.currentTaskId, "image-002");

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

assert.deepEqual(
  evaluateDetailImageCompletion({
    filledFromMain: true,
    qualificationImageCount: 4,
    finalDetailCount: 9,
    expectedDetailCount: 9
  }),
  { passed: true, issue: "" }
);
assert.equal(isUploadPlaceholderGraphicContext("白底图 + 上传白底图"), true);
assert.equal(isUploadPlaceholderGraphicContext("主图3:4 + 上传辅助图"), true);
assert.equal(isUploadPlaceholderGraphicContext("白底图 删除 预览图片"), false);
const duplicateDetailCheck = evaluateDetailImageCompletion({
  filledFromMain: true,
  qualificationImageCount: 4,
  finalDetailCount: 13,
  expectedDetailCount: 9
});
assert.equal(duplicateDetailCheck.passed, false);
assert.match(duplicateDetailCheck.issue, /exceeded expected count/);

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

const remoteDebuggingUnavailableClass = classifyPublishFailure("Remote debugging browser did not become ready in time.");
assert.equal(remoteDebuggingUnavailableClass, "browser_remote_debugging_unavailable");
assert.equal(shouldRetryPublishFailure(remoteDebuggingUnavailableClass, 0), true);

const cdpContextManagementClass = classifyPublishFailure(
  "browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported."
);
assert.equal(cdpContextManagementClass, "browser_remote_debugging_unavailable");
assert.equal(shouldRetryPublishFailure(cdpContextManagementClass, 0), true);

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

const pendingFeishuSourceImages = resolvePendingFeishuProductSourceImagesFromRecords({
  records: [
    record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
    record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png")
  ],
  processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
  fileExists: (filePath) => filePath.endsWith("product-2.png")
});
assert.deepEqual(pendingFeishuSourceImages, [path.resolve("/work/input/auto-listing/feishu-images/product-2.png")]);

assert.throws(
  () =>
    resolvePendingFeishuProductSourceImagesFromRecords({
      records: [
        record("rec-1", "/work/input/auto-listing/feishu-images/product-1.png"),
        record("rec-2", "/work/input/auto-listing/feishu-images/product-2.png")
      ],
      processedImages: ["/work/input/auto-listing/feishu-images/product-1.png"],
      fileExists: () => false
    }),
  /Feishu product row 2 \(rec-2\) white background image was missing/
);

const repeatedProductManifest = path.join(tempDir, "processed-images.json");
const repeatedBatchA = [
  record("rec-batch-a", "/work/input/auto-listing/feishu-images/same-product.png")
];
const repeatedBatchB = [
  record("rec-batch-b", "/work/input/auto-listing/feishu-images/same-product.png")
];
const repeatedBatchAFingerprint = buildFeishuBatchFingerprint(repeatedBatchA);
const repeatedBatchBFingerprint = buildFeishuBatchFingerprint(repeatedBatchB);

assert.notEqual(repeatedBatchAFingerprint, repeatedBatchBFingerprint);
appendProcessedImages(repeatedProductManifest, ["/work/input/auto-listing/feishu-images/same-product.png"], repeatedBatchAFingerprint);
assert.equal(readProcessedImages(repeatedProductManifest, repeatedBatchAFingerprint).has("/work/input/auto-listing/feishu-images/same-product.png"), true);
assert.equal(readProcessedImages(repeatedProductManifest, repeatedBatchBFingerprint).has("/work/input/auto-listing/feishu-images/same-product.png"), false);

const repeatedBatchProgress = summarizeFeishuBatchProgress({
  records: repeatedBatchB,
  processedImages: readProcessedImages(repeatedProductManifest, repeatedBatchBFingerprint)
});
assert.equal(repeatedBatchProgress.processedRecordCount, 0);
assert.equal(repeatedBatchProgress.pendingRecordCount, 1);
assert.equal(repeatedBatchProgress.batchComplete, false);

const legacyManifest = path.join(tempDir, "legacy-processed-images.json");
appendProcessedImages(legacyManifest, ["/work/input/auto-listing/feishu-images/legacy-product.png"]);
assert.equal(migrateLegacyProcessedImagesToBatch(legacyManifest, repeatedBatchAFingerprint), true);
assert.equal(readProcessedImages(legacyManifest, repeatedBatchAFingerprint).has("/work/input/auto-listing/feishu-images/legacy-product.png"), true);
assert.equal(readProcessedImages(legacyManifest, repeatedBatchBFingerprint).has("/work/input/auto-listing/feishu-images/legacy-product.png"), false);

const appendMigratedManifest = path.join(tempDir, "append-migrated-processed-images.json");
appendProcessedImages(appendMigratedManifest, ["/work/input/auto-listing/feishu-images/current-batch-first.png"]);
appendProcessedImages(appendMigratedManifest, ["/work/input/auto-listing/feishu-images/current-batch-second.png"], repeatedBatchAFingerprint);
assert.equal(readProcessedImages(appendMigratedManifest, repeatedBatchAFingerprint).has("/work/input/auto-listing/feishu-images/current-batch-first.png"), true);
assert.equal(readProcessedImages(appendMigratedManifest, repeatedBatchAFingerprint).has("/work/input/auto-listing/feishu-images/current-batch-second.png"), true);
assert.equal(readProcessedImages(appendMigratedManifest, repeatedBatchBFingerprint).has("/work/input/auto-listing/feishu-images/current-batch-first.png"), false);

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
  shouldContinueFeishuAfterBatchRefresh({
    exitCode: 0,
    currentBatchComplete: true,
    refreshedBatchChanged: true,
    refreshedBatchComplete: false
  }),
  true
);
assert.equal(
  shouldContinueFeishuAfterBatchRefresh({
    exitCode: 0,
    currentBatchComplete: true,
    refreshedBatchChanged: false,
    refreshedBatchComplete: false
  }),
  false
);
assert.equal(
  shouldContinueFeishuAfterBatchRefresh({
    exitCode: 0,
    currentBatchComplete: true,
    refreshedBatchChanged: true,
    refreshedBatchComplete: true
  }),
  false
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "same_batch_pending"
  }),
  false
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "new_batch_after_refresh"
  }),
  false
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "initial_full",
    currentBatchComplete: true
  }),
  true
);
assert.equal(
  shouldRefreshFeishuAssetsBeforeFullFlow({
    continuationReason: "initial_full",
    currentBatchComplete: false
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
assert.equal(resolveImageGenerationRequestDeadlineMs(180000), 210000);
assert.equal(resolveImageGenerationRequestDeadlineMs(10000), 60000);
assert.deepEqual(resolveImageGenerationTransportRetryPolicy(undefined), {
  maxRetries: 8,
  delayMs: [3000, 6000, 12000, 24000, 45000, 45000, 45000, 45000]
});
assert.deepEqual(resolveImageGenerationTransportRetryPolicy(2), {
  maxRetries: 8,
  delayMs: [3000, 6000, 12000, 24000, 45000, 45000, 45000, 45000]
});
assert.equal(resolveImageGenerationTransportRetryPolicy(10).maxRetries, 10);
assert.equal(
  selectHermesStatusResultFile({
    running: false,
    expected: { resultFile: "old-resume-result.json", mtimeMs: 100 },
    log: { resultFile: "new-supervisor-child-result.json", mtimeMs: 300 },
    latest: { resultFile: "latest-result.json", mtimeMs: 200 }
  }),
  "new-supervisor-child-result.json"
);
assert.equal(
  selectHermesStatusResultFile({
    running: true,
    expected: { resultFile: "old-resume-result.json", mtimeMs: 100 },
    log: { resultFile: "active-child-result.json", mtimeMs: 300 },
    latest: { resultFile: "latest-result.json", mtimeMs: 400 }
  }),
  "active-child-result.json"
);
assert.equal(
  isHermesSupervisorProcessCommand("node dist/src/cli/hermes-auto-listing-supervisor.js --initial full"),
  true
);
assert.equal(isHermesSupervisorProcessCommand("/usr/bin/yes 9485"), false);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "Image generation request timed out. The provider did not respond in time.",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "validation failed",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  false
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 1,
    batchComplete: false,
    retryableFailureMessage: "Refusing to generate paid titles while product folders already contain workbook(s): /work/shop/product-1 -> title.xlsx",
    recoveryAttempts: 0,
    maxRecoveryAttempts: 3
  }),
  true
);
assert.equal(
  shouldResumeFeishuBatchAfterRetryableChildFailure({
    exitCode: 124,
    batchComplete: false,
    retryableFailureMessage: "child made no progress before watchdog timeout",
    recoveryAttempts: 3,
    maxRecoveryAttempts: 3
  }),
  false
);
assert.equal(
  shouldResumeInterruptedTaskInPlace({
    runStatus: "running",
    taskStatus: "main_images_generated",
    sourceImageExists: true,
    reusableRawImageCount: 7
  }),
  true
);
assert.equal(
  shouldResumeInterruptedTaskInPlace({
    runStatus: "running",
    taskStatus: "main_images_generated",
    sourceImageExists: true,
    reusableRawImageCount: 0
  }),
  false
);
assert.equal(
  shouldResumeInterruptedTaskInPlace({
    runStatus: "completed",
    taskStatus: "done",
    sourceImageExists: true,
    reusableRawImageCount: 20
  }),
  false
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 503,
    responseText: '{"error":{"message":"system memory overloaded (current: 93.6%, threshold: 90%)","code":"system_memory_overloaded"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 8,
    delayMs: [60000, 90000, 120000, 180000, 240000, 300000, 300000, 300000],
    reason: "provider_resource_overloaded"
  }
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 503,
    responseText: '{"error":{"message":"temporary unavailable"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 8,
    delayMs: [60000, 90000, 120000, 180000, 240000, 300000, 300000, 300000],
    reason: "provider_gateway_unavailable"
  }
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 500,
    responseText: '{"error":{"message":"upstream error: do request failed (request id: 202605250701525013041518268d9d621y2kdZ5)","code":"do_request_failed"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 8,
    delayMs: [60000, 90000, 120000, 180000, 240000, 300000, 300000, 300000],
    reason: "provider_upstream_failed"
  }
);
assert.deepEqual(
  resolveImageGenerationHttpRetryPolicy({
    status: 500,
    responseText: '{"error":{"message":"temporary unavailable"}}',
    configuredMaxRetries: undefined
  }),
  {
    maxRetries: 3,
    delayMs: [3000, 6000, 9000],
    reason: "http_transient"
  }
);
assert.deepEqual(evaluateImageGenerationEndpointProbe({ status: 404, statusText: "Not Found" }), {
  passed: true,
  issue: ""
});
assert.deepEqual(
  evaluateImageGenerationEndpointProbe({
    errorName: "TypeError",
    errorMessage: "fetch failed",
    errorCauseCode: "ENOTFOUND"
  }),
  {
    passed: false,
    issue: "Image generation endpoint is not reachable from this Node runtime: TypeError: fetch failed; cause=ENOTFOUND"
  }
);
assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 4,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 1
  }),
  { passed: true, issue: "" }
);
assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 3,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 1
  }),
  { passed: true, issue: "" }
);
assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 0,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 0
  }),
  { passed: true, issue: "" }
);
assert.deepEqual(
  evaluatePriceInventoryEntryRule({
    specIssue: "Spec module error detected: 该项为必填，请输入"
  }),
  {
    action: "block_until_spec_template_complete",
    issue: "Spec module error detected: 该项为必填，请输入"
  }
);
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

assert.doesNotThrow(() =>
  assertGeneratedTitlesBelongToProduct({
    titles: ["官方正品补水保湿医用聚乙二醇护创敷料延草纲目"],
    genericName: "医用聚乙二醇护创敷料",
    productCategory: "医疗器械"
  })
);
assert.throws(
  () =>
    assertGeneratedTitlesBelongToProduct({
      titles: ["官方正品补水保湿舒奈美医用医用重组Ⅲ型人源化胶原蛋白软膏延草纲目"],
      genericName: "医用聚乙二醇护创敷料",
      productCategory: "医疗器械"
    }),
  /do not match current product genericName/
);

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

assert.equal(
  inferResumeStartStepForTask({
    status: "shop_distributed",
    generatedProductFolders: ["/work/shop/product-1"],
    shopDistributionArtifact: { distributedFolders: ["/work/shop/product-1"], simulated: false }
  }),
  "published"
);
assert.equal(
  inferResumeStartStepForTask({
    status: "failed",
    error: {
      step: "titles_generated",
      message: "Refusing to generate paid titles while product folders already contain workbook(s): /work/shop/product-1 -> title.xlsx"
    },
    generatedProductFolders: ["/work/shop/product-1"]
  }),
  "published"
);

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
