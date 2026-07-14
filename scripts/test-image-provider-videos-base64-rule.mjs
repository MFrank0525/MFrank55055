import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeVideosBase64PaidResumePlan } from "../dist/src/autolist/main-image-assets.js";
import {
  providerExplicitlyProvesNoPaidTaskAccepted,
  submitTransportFailureProvesNoPaidTaskAccepted,
  resolveOpenAiCompatibleImageMode,
  resolvePaidImageLedgerFailureDisposition,
  resolveMissingFixedImageIndexes,
  resolveVideosBase64SubmitConcurrency,
  resolveVideosBase64AcceptedTaskPollCeilingMs,
  resolveVideosBase64SubmitTimeoutMs,
  shouldKeepPaidImagePolicyCompatiblePrompt,
  resolvePaidImageProviderTimeoutRetry,
  resolvePaidImageFixedSlotRecovery
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

const source = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
const configSource = fs.readFileSync("src/autolist/config.ts", "utf8");
const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const typesSource = fs.readFileSync("src/autolist/types.ts", "utf8");
const imageGenerationRulesSource = fs.readFileSync("src/autolist/image-generation-rules.ts", "utf8");
const example = JSON.parse(fs.readFileSync("input/image-generation.config.videos-base64.example.json", "utf8"));
const ruleDoc = fs.readFileSync("docs/auto-listing/steps/03-main-image-generation.md", "utf8");
const stabilityChecklist = fs.readFileSync("docs/auto-listing/stability-checklist.md", "utf8");

assert.equal(example.mode, "videos-base64");
assert.equal(example.apiUrl.endsWith("/v1/videos"), true);
assert.equal(example.size, "1024x1024");
assert.equal(example.videoMetadata.aspect_ratio, "1:1");
assert.equal(example.submitConcurrency, 2);
assert.equal(example.maxPollMs, 180000);
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(undefined), 30 * 60 * 1000);
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(3 * 60 * 1000), 30 * 60 * 1000);
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(60 * 60 * 1000), 30 * 60 * 1000);
assert.equal(
  shouldKeepPaidImagePolicyCompatiblePrompt({
    failureReason: 'provider task failed: {"message":"失败了超时 请重试","code":"upstream_error"}',
    recordedPromptDigest: "policy-digest",
    originalPromptDigest: "original-digest",
    policyCompatiblePromptDigest: "policy-digest"
  }),
  true,
  "A fixed slot that already switched to the policy-compatible prompt must keep that identity after later provider timeouts"
);
const repeatedProviderTimeoutAudit = [
  { state: "failed_after_acceptance", at: "2026-06-18T01:00:00.000Z", reason: "provider task failed: 失败了超时 请重试" },
  { state: "failed_after_acceptance", at: "2026-06-18T01:20:00.000Z", reason: "provider task failed: timed out" },
  { state: "failed_after_acceptance", at: "2026-06-18T01:40:00.000Z", reason: "provider task failed: 失败了超时 请重试" }
];
const twoProviderTimeoutAudit = repeatedProviderTimeoutAudit.slice(0, 2);
assert.deepEqual(
  resolvePaidImageFixedSlotRecovery({
    failureReason: 'provider task failed: {"code":"task_timeout","message":"任务失败，超时5分钟"}',
    audit: [
      {
        state: "failed_after_acceptance",
        at: "2026-06-18T01:00:00.000Z",
        reason: 'provider task failed: {"code":"task_timeout","message":"任务失败，超时5分钟"}'
      }
    ],
    recordedPromptDigest: "original-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-06-18T01:01:00.000Z")
  }),
  { action: "retry_fixed_slot_now", usePolicyCompatiblePrompt: false, deferMs: 0 },
  "A first explicit provider task timeout must retry only its fixed slot in the current child process"
);
assert.deepEqual(
  resolvePaidImageFixedSlotRecovery({
    failureReason: "provider task failed: videos-base64 task task_dead did not finish within 180000ms.",
    audit: [
      {
        state: "failed_after_acceptance",
        at: "2026-06-18T01:00:00.000Z",
        reason: "provider task failed: videos-base64 task task_dead did not finish within 180000ms."
      }
    ],
    recordedPromptDigest: "original-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-06-18T01:01:00.000Z")
  }),
  { action: "retry_fixed_slot_now", usePolicyCompatiblePrompt: false, deferMs: 0 },
  "A videos-base64 poll timeout must be treated as an accepted-task timeout and retry only that fixed slot"
);
assert.deepEqual(
  resolvePaidImageFixedSlotRecovery({
    failureReason: "videos-base64 accepted task stayed queued/pending beyond 1800000ms; retrying fixed slot 11.",
    audit: [
      {
        state: "failed_after_acceptance",
        at: "2026-07-14T06:40:00.000Z",
        reason: "videos-base64 accepted task stayed queued/pending beyond 1800000ms; retrying fixed slot 11."
      }
    ],
    recordedPromptDigest: "policy-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-07-14T06:44:00.000Z")
  }),
  { action: "retry_fixed_slot_now", usePolicyCompatiblePrompt: true, deferMs: 0 }
);
assert.deepEqual(
  resolvePaidImageFixedSlotRecovery({
    failureReason: "submitted provider task timed out after 1800000ms",
    audit: [
      {
        state: "failed_after_acceptance",
        at: "2026-07-14T06:40:00.000Z",
        reason: "submitted provider task timed out after 1800000ms"
      }
    ],
    recordedPromptDigest: "original-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-07-14T06:44:00.000Z")
  }),
  { action: "retry_fixed_slot_now", usePolicyCompatiblePrompt: false, deferMs: 0 }
);
for (const failureReason of [
  "provider task failed: invalid image",
  "provider task failed: permission denied",
  "provider task failed: insufficient balance",
  "submit response was ambiguous after timeout",
  "videos-base64 submit failed with HTTP 504: upstream request timeout",
  "videos-base64 submit response was not JSON: timeout",
  'videos-base64 response did not include task id: {"message":"timeout"}',
  "provider task failed: invalid_api_key after timeout",
  "provider task failed: authentication failed after timeout",
  "provider task failed: usage limit exceeded after timeout",
  "provider task failed: payment required after timeout",
  "request timed out while submitting to provider",
  "provider task submission timed out before task id was received",
  "provider task failed: authentication_error after timeout",
  "provider task failed: unauthenticated after timeout",
  "provider task failed: api_key_invalid after timeout",
  "provider task failed: usage_limit_exceeded after timeout",
  "provider task failed: payment_required after timeout"
]) {
  assert.deepEqual(
    resolvePaidImageFixedSlotRecovery({
      failureReason,
      audit: [],
      recordedPromptDigest: "original-digest",
      policyCompatiblePromptDigest: "policy-digest",
      nowMs: Date.parse("2026-06-18T01:01:00.000Z")
    }),
    { action: "bubble", usePolicyCompatiblePrompt: false, deferMs: 0 },
    `Unsafe or non-timeout provider failure must not be locally replayed: ${failureReason}`
  );
}
assert.deepEqual(
  resolvePaidImageProviderTimeoutRetry({
    failureReason: "provider task failed: 失败了超时 请重试",
    audit: twoProviderTimeoutAudit,
    recordedPromptDigest: "original-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-06-18T01:21:00.000Z")
  }),
  { usePolicyCompatiblePrompt: true, deferMs: 0 },
  "Two accepted provider timeouts must switch only the failed fixed slot to the stability-compatible prompt"
);
assert.deepEqual(
  resolvePaidImageProviderTimeoutRetry({
    failureReason: "provider task failed: videos-base64 task task_dead did not finish within 180000ms.",
    audit: [
      {
        state: "failed_after_acceptance",
        at: "2026-06-18T01:00:00.000Z",
        reason: "videos-base64 accepted task stayed queued/pending beyond 180000ms; retrying fixed slot 8."
      },
      {
        state: "failed_after_acceptance",
        at: "2026-06-18T01:20:00.000Z",
        reason: "provider task failed: videos-base64 task task_dead did not finish within 180000ms."
      }
    ],
    recordedPromptDigest: "original-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-06-18T01:21:00.000Z")
  }),
  { usePolicyCompatiblePrompt: true, deferMs: 0 },
  "Queued/pending stale expiry plus poll timeout must count as two accepted-task timeouts and switch to the fallback prompt"
);
assert.deepEqual(
  resolvePaidImageFixedSlotRecovery({
    failureReason: "provider task failed: timed out",
    audit: repeatedProviderTimeoutAudit,
    recordedPromptDigest: "policy-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-06-18T01:41:00.000Z")
  }),
  { action: "defer_to_supervisor", usePolicyCompatiblePrompt: true, deferMs: 2 * 60 * 1000 },
  "A policy-compatible fixed slot that still times out must defer with a cooldown capped at the project three-minute ceiling"
);
assert.deepEqual(
  resolvePaidImageProviderTimeoutRetry({
    failureReason: "provider task failed: 失败了超时 请重试",
    audit: repeatedProviderTimeoutAudit,
    recordedPromptDigest: "policy-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-06-18T01:41:00.000Z")
  }),
  { usePolicyCompatiblePrompt: true, deferMs: 2 * 60 * 1000 },
  "A stability-compatible slot that still times out must enter a fixed-slot cooldown capped at three minutes instead of immediate paid resubmission"
);
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
assert.match(
  source,
  /generateVideosBase64ImageAttempt[\s\S]*const generateVideosBase64Image =[\s\S]*for \(;;\)[\s\S]*generateVideosBase64ImageAttempt\(absoluteImageIndex\)[\s\S]*resolvePaidImageSlotAction[\s\S]*retry_failed_after_acceptance[\s\S]*resolvePaidImageFixedSlotRecovery[\s\S]*retry_fixed_slot_now[\s\S]*retrying fixed paid slot/s,
  "An explicit accepted provider timeout must retry only the failed fixed slot inside the current child process"
);
assert.match(
  source,
  /Date\.now\(\) - startedAt > maxPollMs[\s\S]*recordPaidImageFailedAfterAcceptance\(\{[\s\S]*slot: ledgerSlot[\s\S]*provider task failed: videos-base64 task \$\{taskId\} did not finish within \$\{maxPollMs\}ms/s,
  "videos-base64 poll timeout must mark only the accepted fixed slot failed_after_acceptance before retrying"
);
assert.match(
  source,
  /if \(expired\) \{[\s\S]*resolvePaidImageFixedSlotRecovery\(\{[\s\S]*failureReason: expired\.reason \|\| ""[\s\S]*usePolicyCompatiblePrompt[\s\S]*request-" \+ paddedImageIndex \+ "-policy-retry\.json"[\s\S]*allowFailedAfterAcceptanceDigestChange: expiredRecovery\.usePolicyCompatiblePrompt/s,
  "videos-base64 stale queued/pending expiry must apply fixed-slot fallback prompt rules before resubmitting"
);
assert.match(
  source,
  /defer_to_supervisor[\s\S]*paid image provider timeout circuit open for slot \$\{ledgerSlot\}; retry after \$\{recovery\.deferMs\}ms/s,
  "Only an opened fixed-slot timeout circuit may defer the child back to the supervisor"
);
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
assert.match(orchestratorSource, /paidImageSubmissionLedgerDir,\s*archiveMainImageDir,\s*simulateOnly/s);
assert.doesNotMatch(orchestratorSource, /archiveProductNames/);
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
  /isPolicyCompatibleRetryFailureReason\(reason: string\)[\s\S]*违规[\s\S]*policyCompatiblePromptText = buildPolicyCompatibleImageEditPrompt\(promptText, absoluteImageIndex\)[\s\S]*failedAfterAcceptanceReason[\s\S]*shouldKeepPaidImagePolicyCompatiblePrompt[\s\S]*keepPolicyCompatiblePrompt[\s\S]*request-" \+ paddedImageIndex \+ "-policy-retry\.json"/,
  "videos-base64 failed-after-acceptance fixed-slot retries must switch only that slot to the policy-compatible prompt"
);
assert.match(
  source,
  /allowFailedAfterAcceptanceDigestChange\s*=[\s\S]*fixedSlotRecovery\.usePolicyCompatiblePrompt[\s\S]*isPolicyCompatibleRetryFailureReason\(failedAfterAcceptanceReason\)/,
  "Repeated provider timeouts must explicitly authorize the one-time fixed-slot digest switch to the stability-compatible prompt"
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
assert.match(
  ruleDoc,
  /明确终态超时.*当前子进程.*同一固定 slot.*禁止.*整批.*supervisor/s,
  "Main-image rules must require local fixed-slot recovery before escalating to the supervisor"
);
assert.match(
  ruleDoc,
  /超时熔断.*supervisor.*精确冷却/s,
  "Only a fixed-slot timeout circuit may defer terminal timeouts to the supervisor"
);
assert.match(ruleDoc, /超时熔断.*3 分钟/s, "Fixed-slot timeout circuit cooldown must be three minutes");
assert.match(
  stabilityChecklist,
  /外部服务.*最多等待 3 分钟.*不再指数增长/s,
  "External image-service waits must stay at or below three minutes instead of growing exponentially"
);
assert.match(ruleDoc, /内容策略.*仅对该固定 slot.*内容策略兼容降级提示词/s);
assert.match(ruleDoc, /内容策略.*failed_after_acceptance.*requestDigest.*promptDigest.*允许.*更新/s);
assert.match(ruleDoc, /普通供应商失败.*不得改变 digest/s);
assert.match(ruleDoc, /不得降级整份提示词.*整轮重生.*重新提交已完成 slot/s);

assert.equal(providerExplicitlyProvesNoPaidTaskAccepted(422, "validation failed"), true);
assert.equal(providerExplicitlyProvesNoPaidTaskAccepted(401, "unauthorized"), true);
assert.equal(providerExplicitlyProvesNoPaidTaskAccepted(429, "rate limited"), false);
assert.equal(providerExplicitlyProvesNoPaidTaskAccepted(502, "upstream error"), false);
assert.equal(
  providerExplicitlyProvesNoPaidTaskAccepted(
    503,
    '{"code":"fail_to_fetch_task","message":"{\\"error\\":{\\"code\\":\\"model_not_found\\",\\"message\\":\\"No available channel for model gpt-image-2 under group default\\"}}","data":null}'
  ),
  true
);
assert.equal(submitTransportFailureProvesNoPaidTaskAccepted("fetch failed"), true);
assert.equal(submitTransportFailureProvesNoPaidTaskAccepted("image generation request exceeded hard deadline 1830000ms"), true);
assert.equal(submitTransportFailureProvesNoPaidTaskAccepted("ECONNRESET before response"), true);
assert.equal(submitTransportFailureProvesNoPaidTaskAccepted("videos-base64 task abc failed"), false);
assert.equal(resolveVideosBase64SubmitTimeoutMs(180000, 1800000), 180000);
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
