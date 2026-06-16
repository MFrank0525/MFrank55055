import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeVideosBase64PaidResumePlan } from "../dist/src/autolist/jimeng-assets.js";
import {
  providerExplicitlyProvesNoPaidTaskAccepted,
  submitTransportFailureProvesNoPaidTaskAccepted,
  resolveOpenAiCompatibleImageMode,
  resolvePaidImageLedgerFailureDisposition,
  resolveMissingFixedImageIndexes,
  resolveVideosBase64SubmitConcurrency,
  resolveVideosBase64SubmitTimeoutMs
} from "../dist/src/autolist/image-generation-rules.js";
import {
  initializePaidImageProductLedger,
  recordPaidImageAmbiguous,
  recordPaidImageCompleted,
  recordPaidImageFailedAfterAcceptance,
  reconcileAmbiguousPaidImageNoAcceptance,
  recordPaidImageSubmitted,
  reservePaidImageSlot
} from "../dist/src/autolist/paid-image-submission-ledger.js";

const source = fs.readFileSync("src/autolist/jimeng-assets.ts", "utf8");
const configSource = fs.readFileSync("src/autolist/config.ts", "utf8");
const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const typesSource = fs.readFileSync("src/autolist/types.ts", "utf8");
const imageGenerationRulesSource = fs.readFileSync("src/autolist/image-generation-rules.ts", "utf8");
const example = JSON.parse(fs.readFileSync("input/image-generation.config.videos-base64.example.json", "utf8"));
const ruleDoc = fs.readFileSync("docs/auto-listing/steps/03-main-image-generation.md", "utf8");

assert.equal(example.mode, "videos-base64");
assert.equal(example.apiUrl.endsWith("/v1/videos"), true);
assert.equal(example.size, "1024x1024");
assert.equal(example.videoMetadata.aspect_ratio, "1:1");
assert.equal(example.submitConcurrency, 2);
assert.match(source, /mode\?: "generations" \| "edits" \| "media-generate" \| "videos-base64"/);
assert.match(source, /buildVideosBase64JsonBody/);
assert.match(source, /data:image\/\$\{mimeType\.split\("\/"\)\[1\]\};base64,/);
assert.match(source, /resolveVideosBase64TaskUrl/);
assert.match(source, /extractVideosBase64ResultUrl/);
assert.match(source, /\/content/);
assert.match(source, /recordPaidImageAmbiguous/);
assert.match(source, /recordPaidImageFailedAfterAcceptance/);
assert.match(source, /recordPaidImageFailedBeforeAcceptance/);
assert.match(source, /\[redacted base64 image data url\]/);
assert.match(source, /generateVideosBase64Image/);
assert.match(source, /readVideosBase64SubmittedTask/);
assert.match(source, /resuming submitted videos-base64 task/);
assert.match(source, /initializePaidImageProductLedger/);
assert.match(source, /reservePaidImageSlot/);
assert.match(source, /resolvePaidImageSlotAction/);
assert.match(source, /recordPaidImageSubmitted/);
assert.match(source, /recordPaidImageCompleted/);
assert.match(source, /paid image ledger/i);
assert.match(source, /slotOffset/);
assert.match(source, /ledgerSlot/);
assert.match(source, /slotOffset: promptIndex \* options\.mainImageExpectedCount/);
assert.doesNotMatch(source, /slotOffset: imageIndex - 1/);
assert.match(source, /Promise\.allSettled\(work\)/);
assert.match(source, /settleConcurrentWork\(\s*videosBase64ImageIndexes\.map/s);
assert.match(source, /settleConcurrentWork\(\s*promptIndexes\.map/s);
assert.match(source, /reasons: \$\{reasons\.join\("\s*\|\s*"\)\}/);
assert.match(source, /mode === "videos-base64"/);
assert.match(typesSource, /paidImageSubmissionLedgerDir\?: string/);
assert.match(configSource, /paidImageSubmissionLedgerDir: path\.resolve/);
assert.match(orchestratorSource, /paidImageSubmissionLedgerDir,\s*simulateOnly/s);
assert.match(orchestratorSource, /resolved\.input\.paidImageSubmissionLedgerDir,\s*resolved\.input\.simulateOnly/s);
assert.match(source, /rootDir: options\.paidImageSubmissionLedgerDir/);
assert.doesNotMatch(source, /rootDir: path\.join\(taskDir, "paid-image-ledger"\)/);
assert.doesNotMatch(source, /batchFingerprint: options\.feishuBatchFingerprint \|\| options\.taskId/);
assert.doesNotMatch(source, /recordId: options\.feishuRecordId \|\| options\.taskId/);
assert.match(source, /providerExplicitlyProvesNoPaidTaskAccepted/);
assert.match(source, /resolveVideosBase64SubmitTimeoutMs/);
assert.match(source, /sendVideosBase64SubmitWithTransientRetries/);
assert.match(
  source,
  /submitGate\.run\(\(\) => sendVideosBase64SubmitWithTransientRetries\(absoluteImageIndex, requestBody\)\)/,
  "videos-base64 paid submit requests must use HTTP transient retries before a slot can become ambiguous"
);
assert.match(source, /requestedImageIndexes/);
assert.match(source, /resolveMissingFixedImageIndexes/);
assert.match(source, /requestedImageIndexes: missingLocalIndexes/);
assert.match(source, /summarizeVideosBase64PaidResumePlan/);
assert.match(source, /allowExistingSubmittedTaskImport/);
assert.match(source, /allowExistingSubmittedTaskImport =[\s\S]*slotAction\.action !== "retry_failed_before_acceptance"[\s\S]*slotAction\.action !== "retry_failed_after_acceptance"/);
assert.match(
  source,
  /isPolicyCompatibleRetryFailureReason\(reason: string\)[\s\S]*违规[\s\S]*failedAfterAcceptanceReason[\s\S]*slotAction\.action === "retry_failed_after_acceptance"[\s\S]*isPolicyCompatibleRetryFailureReason\(failedAfterAcceptanceReason\)[\s\S]*buildPolicyCompatibleImageEditPrompt\(promptText, absoluteImageIndex\)[\s\S]*request-" \+ paddedImageIndex \+ "-policy-retry\.json"/,
  "videos-base64 failed-after-acceptance fixed-slot retries must switch only that slot to the policy-compatible prompt"
);
assert.match(source, /submitSlots/);
assert.match(source, /roundStartImageIndex \+ missingLocalIndexes\[itemIndex\] - 1/);
assert.match(source, /sendRequest\(requestBody, "application\/json", videosBase64SubmitTimeoutMs\)/);
assert.match(source, /createConcurrencyGate\(resolveVideosBase64SubmitConcurrency\(config\.submitConcurrency\)\)/);
assert.match(source, /const videosBase64SubmitGate =[\s\S]*createConcurrencyGate\(resolveVideosBase64SubmitConcurrency\(imageGenerationConfig\.submitConcurrency\)\)/);
assert.match(source, /videosBase64SubmitGate,\s*paidImageLedger:/);
assert.match(source, /imageGenerationMode === "videos-base64" &&\s*\(!options\.feishuBatchFingerprint/);
assert.doesNotMatch(
  source,
  /submitGate\.run\(\(\) => sendRequest\(requestBody, "application\/json", videosBase64SubmitTimeoutMs\)\)/,
  "videos-base64 paid submit requests must not bypass transient HTTP retry handling"
);
assert.match(source, /fetchVideosBase64TaskWithTransportRetries\(taskId, false/);
assert.match(source, /fetchVideosBase64TaskWithTransportRetries\(taskId, true/);
assert.match(source, /downloadVideosBase64ResultWithTransportRetries\(resultUrl, targetFile/);
assert.match(source, /summarizePaidImageProductLedger/);
assert.match(source, /resolvePaidImageLedgerFailureDisposition/);
assert.match(
  source,
  /settleConcurrentWork\(\s*promptIndexes\.map\(\(promptIndex\) => processPromptRound\(promptIndex\)\)[\s\S]*summarizePaidImageProductLedger/
);
assert.match(source, /fs\.existsSync\(productDir\)[\s\S]*summarizePaidImageProductLedger/);
assert.match(imageGenerationRulesSource, /export function providerExplicitlyProvesNoPaidTaskAccepted/);
assert.match(ruleDoc, /videos-base64.*Base64.*1:1.*1024x1024/s);
assert.match(ruleDoc, /实际返回.*正方形.*2K.*4K/s);
assert.match(ruleDoc, /提交结果不明确.*不得在同一子进程里自动重新提交/s);
assert.match(ruleDoc, /paid-image-ledger.*付费资产.*续跑/s);
assert.match(ruleDoc, /项目控制器.*当前飞书批次.*续跑/s);
assert.match(ruleDoc, /异步提交当前商品任务.*统一收敛.*下载全部结果/s);
assert.match(ruleDoc, /其他.*串行/s);
assert.match(ruleDoc, /禁止 supervisor 快速重启并重新提交/s);
assert.match(ruleDoc, /固定文件槽位.*禁止按已有文件数量推算/s);
assert.match(ruleDoc, /进入发布前.*固定 raw 槽位完整性/s);
assert.match(ruleDoc, /提交准入并发.*默认.*2.*最高.*4/s);
assert.match(ruleDoc, /已取得.*任务 ID.*状态查询.*结果下载.*传输层瞬断.*同一任务.*退避重试/s);
assert.match(ruleDoc, /queued 0.*pending 0.*供应商队列心跳.*不代表项目业务进展/s);
assert.match(ruleDoc, /watchdog.*不得.*队列心跳.*最后真实进展/s);
assert.match(ruleDoc, /ambiguous.*reserved.*优先.*付费安全阻塞/s);
assert.match(ruleDoc, /failed_after_acceptance.*固定 slot.*允许.*重试/s);
assert.match(ruleDoc, /没有取得 task ID.*没有供应商响应摘要.*fetch failed.*no-acceptance/s);
assert.match(ruleDoc, /no-acceptance.*failed_before_acceptance.*重试同一固定 slot/s);
assert.match(ruleDoc, /failed_after_acceptance.*只补同一固定 slot/s);
assert.match(ruleDoc, /内容策略.*仅对该固定 slot.*内容策略兼容降级提示词/s);
assert.match(ruleDoc, /不得降级整份提示词.*整轮重生.*重新提交已完成 slot/s);

assert.equal(providerExplicitlyProvesNoPaidTaskAccepted(422, "validation failed"), true);
assert.equal(providerExplicitlyProvesNoPaidTaskAccepted(401, "unauthorized"), true);
assert.equal(providerExplicitlyProvesNoPaidTaskAccepted(429, "rate limited"), false);
assert.equal(providerExplicitlyProvesNoPaidTaskAccepted(502, "upstream error"), false);
assert.equal(submitTransportFailureProvesNoPaidTaskAccepted("fetch failed"), true);
assert.equal(submitTransportFailureProvesNoPaidTaskAccepted("image generation request exceeded hard deadline 1830000ms"), true);
assert.equal(submitTransportFailureProvesNoPaidTaskAccepted("ECONNRESET before response"), true);
assert.equal(submitTransportFailureProvesNoPaidTaskAccepted("videos-base64 task abc failed"), false);
assert.equal(resolveVideosBase64SubmitTimeoutMs(180000, 1800000), 1800000);
assert.equal(resolveVideosBase64SubmitTimeoutMs(180000, 60000), 180000);
assert.equal(resolveOpenAiCompatibleImageMode(undefined, "https://relay.example/v1/videos"), "videos-base64");
assert.equal(resolveOpenAiCompatibleImageMode("edits", "https://relay.example/v1/videos"), "edits");
assert.equal(resolveVideosBase64SubmitConcurrency(undefined), 2);
assert.equal(resolveVideosBase64SubmitConcurrency(1), 1);
assert.equal(resolveVideosBase64SubmitConcurrency(3), 3);
assert.equal(resolveVideosBase64SubmitConcurrency(20), 4);
assert.equal(
  resolvePaidImageLedgerFailureDisposition({
    expectedSlotCount: 20,
    missing: 0,
    reserved: 0,
    submitted: 1,
    completed: 18,
    failedBeforeAcceptance: 0,
    failedAfterAcceptance: 0,
    ambiguous: 1
  }),
  "safety_block"
);
assert.equal(
  resolvePaidImageLedgerFailureDisposition({
    expectedSlotCount: 20,
    missing: 0,
    reserved: 0,
    submitted: 2,
    completed: 18,
    failedBeforeAcceptance: 0,
    failedAfterAcceptance: 0,
    ambiguous: 0
  }),
  "retryable_external_wait"
);
assert.deepEqual(resolveMissingFixedImageIndexes([2, 3, 4], 4), [1]);
assert.deepEqual(resolveMissingFixedImageIndexes([1, 3], 4), [2, 4]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "videos-base64-resume-plan-"));
const product = initializePaidImageProductLedger({
  rootDir: path.join(tmp, "ledger"),
  batchFingerprint: "batch-a",
  recordId: "record-a",
  expectedSlotCount: 4,
  providerIdentity: "provider-a",
  sourceImageDigest: "source-a"
});
const completedImage = path.join(tmp, "completed.png");
fs.writeFileSync(completedImage, "image-bytes");
for (const slot of [1, 2, 4]) {
  reservePaidImageSlot({
    productDir: product.productDir,
    slot,
    requestDigest: `request-${slot}`,
    promptDigest: `prompt-${slot}`,
    owner: { runId: "run-a", taskId: "image-001" }
  });
  recordPaidImageSubmitted({ productDir: product.productDir, slot, providerTaskId: `provider-task-${slot}` });
  recordPaidImageCompleted({ productDir: product.productDir, slot, sourceFile: completedImage });
}
reservePaidImageSlot({
  productDir: product.productDir,
  slot: 3,
  requestDigest: "request-3",
  promptDigest: "prompt-3",
  owner: { runId: "run-a", taskId: "image-001" }
});
recordPaidImageAmbiguous({ productDir: product.productDir, slot: 3, reason: "submit transport failed before provider task id" });
reconcileAmbiguousPaidImageNoAcceptance({
  productDir: product.productDir,
  slot: 3,
  reason: "provider dashboard has no task id and no charge for slot 3"
});
assert.deepEqual(summarizeVideosBase64PaidResumePlan(product.productDir, [1, 2, 3, 4]), {
  requestedSlots: [1, 2, 3, 4],
  submitSlots: [3],
  reuseSlots: [1, 2, 4],
  pollSlots: [],
  blockedSlots: []
});

const providerFailedProduct = initializePaidImageProductLedger({
  rootDir: path.join(tmp, "provider-failed-ledger"),
  batchFingerprint: "batch-provider-failed",
  recordId: "record-provider-failed",
  expectedSlotCount: 4,
  providerIdentity: "provider-a",
  sourceImageDigest: "source-a"
});
for (const slot of [1, 2, 4]) {
  reservePaidImageSlot({
    productDir: providerFailedProduct.productDir,
    slot,
    requestDigest: `provider-failed-request-${slot}`,
    promptDigest: `provider-failed-prompt-${slot}`,
    owner: { runId: "run-a", taskId: "image-001" }
  });
  recordPaidImageSubmitted({
    productDir: providerFailedProduct.productDir,
    slot,
    providerTaskId: `provider-failed-task-${slot}`
  });
  recordPaidImageCompleted({ productDir: providerFailedProduct.productDir, slot, sourceFile: completedImage });
}
reservePaidImageSlot({
  productDir: providerFailedProduct.productDir,
  slot: 3,
  requestDigest: "provider-failed-request-3",
  promptDigest: "provider-failed-prompt-3",
  owner: { runId: "run-a", taskId: "image-001" }
});
recordPaidImageSubmitted({
  productDir: providerFailedProduct.productDir,
  slot: 3,
  providerTaskId: "provider-failed-task-3"
});
recordPaidImageFailedAfterAcceptance({
  productDir: providerFailedProduct.productDir,
  slot: 3,
  reason: "provider task failed: upstream failed",
  providerResponse: { id: "provider-failed-task-3", status: "failed", error: { message: "upstream failed" } }
});
assert.deepEqual(summarizeVideosBase64PaidResumePlan(providerFailedProduct.productDir, [1, 2, 3, 4]), {
  requestedSlots: [1, 2, 3, 4],
  submitSlots: [3],
  reuseSlots: [1, 2, 4],
  pollSlots: [],
  blockedSlots: []
});
const partialPolicyFailedProduct = initializePaidImageProductLedger({
  rootDir: path.join(tmp, "partial-policy-failed-ledger"),
  batchFingerprint: "batch-partial-policy-failed",
  recordId: "record-partial-policy-failed",
  expectedSlotCount: 4,
  providerIdentity: "provider-a",
  sourceImageDigest: "source-a"
});
for (const slot of [1, 3, 4]) {
  reservePaidImageSlot({
    productDir: partialPolicyFailedProduct.productDir,
    slot,
    requestDigest: `partial-policy-request-${slot}`,
    promptDigest: `partial-policy-prompt-${slot}`,
    owner: { runId: "run-a", taskId: "image-001" }
  });
  recordPaidImageSubmitted({
    productDir: partialPolicyFailedProduct.productDir,
    slot,
    providerTaskId: `partial-policy-task-${slot}`
  });
  recordPaidImageCompleted({ productDir: partialPolicyFailedProduct.productDir, slot, sourceFile: completedImage });
}
reservePaidImageSlot({
  productDir: partialPolicyFailedProduct.productDir,
  slot: 2,
  requestDigest: "partial-policy-request-2",
  promptDigest: "partial-policy-prompt-2",
  owner: { runId: "run-a", taskId: "image-001" }
});
recordPaidImageSubmitted({
  productDir: partialPolicyFailedProduct.productDir,
  slot: 2,
  providerTaskId: "partial-policy-task-2"
});
recordPaidImageFailedAfterAcceptance({
  productDir: partialPolicyFailedProduct.productDir,
  slot: 2,
  reason: 'provider task failed: {"code":"upstream_error","message":"提示词或图片中可能包含违规信息，请修改后重试"}',
  providerResponse: {
    id: "partial-policy-task-2",
    status: "failed",
    error: { code: "upstream_error", message: "提示词或图片中可能包含违规信息，请修改后重试" }
  }
});
assert.deepEqual(summarizeVideosBase64PaidResumePlan(partialPolicyFailedProduct.productDir, [1, 2, 3, 4]), {
  requestedSlots: [1, 2, 3, 4],
  submitSlots: [2],
  reuseSlots: [1, 3, 4],
  pollSlots: [],
  blockedSlots: []
});
