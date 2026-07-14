import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildImageEditPromptFromWord,
  generateMainImageAssets,
  observeVideosBase64AcceptedTask,
  resolveLatestSubmittedPaidImageAuditTimestampMs,
  shouldAllowPaidImagePolicyCompatibilityIdentityTransition,
  summarizeVideosBase64PaidResumePlan
} from "../dist/src/autolist/main-image-assets.js";
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
  isUnsafePaidImageReplayPayload,
  isUnsafePaidImageReplayReason,
  resolvePaidImageProviderTimeoutRetry,
  resolvePaidImageFixedSlotRecovery
} from "../dist/src/autolist/image-generation-rules.js";
import {
  initializePaidImageProductLedger,
  recordPaidImageAmbiguous,
  recordPaidImageCompleted,
  recordPaidImageFailedAfterAcceptance,
  recordPaidImageFailedBeforeAcceptance,
  reconcileAmbiguousPaidImageNoAcceptance,
  recordPaidImageSubmitted,
  reservePaidImageSlot,
  sha256File,
  sha256Text
} from "../dist/src/autolist/paid-image-submission-ledger.js";
import { writeSimpleWordDocument } from "../dist/src/autolist/docx-lite.js";
import { getShopSpecs } from "../dist/src/autolist/shop-rules.js";

const source = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
const configSource = fs.readFileSync("src/autolist/config.ts", "utf8");
const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const typesSource = fs.readFileSync("src/autolist/types.ts", "utf8");
const imageGenerationRulesSource = fs.readFileSync("src/autolist/image-generation-rules.ts", "utf8");
const example = JSON.parse(fs.readFileSync("input/image-generation.config.videos-base64.example.json", "utf8"));
const ruleDoc = fs.readFileSync("docs/auto-listing/steps/03-main-image-generation.md", "utf8");
const stabilityChecklist = fs.readFileSync("docs/auto-listing/stability-checklist.md", "utf8");

function readTextTree(rootDir) {
  return fs
    .readdirSync(rootDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

assert.equal(example.mode, "videos-base64");
assert.equal(example.apiUrl.endsWith("/v1/videos"), true);
assert.equal(example.size, "1024x1024");
assert.equal(example.videoMetadata.aspect_ratio, "1:1");
assert.equal(example.submitConcurrency, 2);
assert.equal(example.timeoutMs, 180000);
assert.equal(example.maxPollMs, 30 * 60 * 1000);
assert.equal(example.acceptedQueueStaleMs, 30 * 60 * 1000);
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(undefined), 30 * 60 * 1000);
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(3 * 60 * 1000), 30 * 60 * 1000);
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(60 * 60 * 1000), 30 * 60 * 1000);
const resumedEvents = [];
const resumedPayload = { status: "completed", id: "resumed-task" };
const resumedOutcome = await observeVideosBase64AcceptedTask({
  resumed: true,
  pollIntervalMs: 1000,
  submittedAtMs: 0,
  ceilingMs: 100,
  sleep: async () => resumedEvents.push("sleep"),
  query: async () => {
    resumedEvents.push("query");
    return resumedPayload;
  },
  now: () => 100,
  succeeded: (payload) => payload.status === "completed",
  failed: (payload) => payload.status === "failed"
});
assert.deepEqual(resumedEvents, ["query"], "a resumed task must query immediately without an initial sleep");
assert.equal(resumedOutcome.kind, "success");
assert.strictEqual(resumedOutcome.payload, resumedPayload);

const newTaskEvents = [];
const newTaskOutcome = await observeVideosBase64AcceptedTask({
  resumed: false,
  pollIntervalMs: 1000,
  submittedAtMs: 0,
  ceilingMs: 100,
  sleep: async () => newTaskEvents.push("sleep"),
  query: async () => {
    newTaskEvents.push("query");
    return { status: "completed" };
  },
  now: () => 100,
  succeeded: (payload) => payload.status === "completed",
  failed: (payload) => payload.status === "failed"
});
assert.deepEqual(newTaskEvents, ["sleep", "query"], "a newly submitted task must sleep once before its first query");
assert.equal(newTaskOutcome.kind, "success");

const ceilingSuccessPayload = { status: "completed", marker: "final-success" };
const ceilingSuccess = await observeVideosBase64AcceptedTask({
  resumed: true,
  pollIntervalMs: 1,
  submittedAtMs: 0,
  ceilingMs: 100,
  sleep: async () => {},
  query: async () => ceilingSuccessPayload,
  now: () => 100,
  succeeded: (payload) => payload.status === "completed",
  failed: (payload) => payload.status === "failed"
});
assert.equal(ceilingSuccess.kind, "success", "a final queried success at the ceiling must win over stale classification");
assert.strictEqual(ceilingSuccess.payload, ceilingSuccessPayload);

const ceilingFailurePayload = { status: "failed", marker: "final-failure" };
const ceilingFailure = await observeVideosBase64AcceptedTask({
  resumed: true,
  pollIntervalMs: 1,
  submittedAtMs: 0,
  ceilingMs: 100,
  sleep: async () => {},
  query: async () => ceilingFailurePayload,
  now: () => 100,
  succeeded: (payload) => payload.status === "completed",
  failed: (payload) => payload.status === "failed"
});
assert.equal(ceilingFailure.kind, "failure", "a final queried explicit failure at the ceiling must win over stale classification");
assert.strictEqual(ceilingFailure.payload, ceilingFailurePayload);

const ceilingPendingPayload = { status: "pending", marker: "final-evidence" };
const ceilingPending = await observeVideosBase64AcceptedTask({
  resumed: true,
  pollIntervalMs: 1,
  submittedAtMs: 0,
  ceilingMs: 100,
  sleep: async () => {},
  query: async () => ceilingPendingPayload,
  now: () => 100,
  succeeded: (payload) => payload.status === "completed",
  failed: (payload) => payload.status === "failed"
});
assert.equal(ceilingPending.kind, "stale", "a final queued/pending status at the ceiling must become stale");
assert.strictEqual(ceilingPending.payload, ceilingPendingPayload, "stale outcome must carry the exact final queried evidence");

for (const [label, timing] of [
  ["zero poll interval", { pollIntervalMs: 0 }],
  ["negative ceiling", { ceilingMs: -1 }],
  ["nonfinite poll interval", { pollIntervalMs: Number.POSITIVE_INFINITY }],
  ["nonfinite submitted time", { submittedAtMs: Number.NaN }]
]) {
  await assert.rejects(
    () =>
      observeVideosBase64AcceptedTask({
        resumed: true,
        pollIntervalMs: 1,
        submittedAtMs: 0,
        ceilingMs: 100,
        sleep: async () => {
          throw new Error("invalid timing must fail before sleep");
        },
        query: async () => {
          throw new Error("invalid timing must fail before query");
        },
        now: () => 0,
        succeeded: () => false,
        failed: () => false,
        ...timing
      }),
    /positive finite|finite/i,
    `${label} must fail fast`
  );
}
await assert.rejects(
  () =>
    observeVideosBase64AcceptedTask({
      resumed: true,
      pollIntervalMs: 1,
      submittedAtMs: 0,
      ceilingMs: 100,
      sleep: async () => {
        throw new Error("invalid now must fail before sleep");
      },
      query: async () => {
        throw new Error("invalid now must fail before query");
      },
      now: () => Number.NEGATIVE_INFINITY,
      succeeded: () => false,
      failed: () => false
    }),
  /now.*finite/i,
  "a nonfinite clock value must fail fast"
);

assert.equal(
  shouldAllowPaidImagePolicyCompatibilityIdentityTransition({
    recordedRequestDigest: "original-request",
    recordedPromptDigest: "original-prompt",
    originalRequestDigest: "original-request",
    originalPromptDigest: "original-prompt"
  }),
  true,
  "an exact original request and prompt identity may transition to the compatibility identity"
);
assert.equal(
  shouldAllowPaidImagePolicyCompatibilityIdentityTransition({
    recordedRequestDigest: "request-changed-by-model-size-source-or-extra",
    recordedPromptDigest: "original-prompt",
    originalRequestDigest: "original-request",
    originalPromptDigest: "original-prompt"
  }),
  false,
  "matching the original prompt alone must not bypass a changed request identity"
);
assert.equal(
  shouldAllowPaidImagePolicyCompatibilityIdentityTransition({
    recordedRequestDigest: "original-request",
    recordedPromptDigest: "different-prompt",
    originalRequestDigest: "original-request",
    originalPromptDigest: "original-prompt"
  }),
  false,
  "a mismatched prompt identity must not authorize the compatibility transition"
);
const submittedFallbackMs = Date.parse("2026-06-18T03:00:00.000Z");
assert.equal(
  resolveLatestSubmittedPaidImageAuditTimestampMs(
    [
      { state: "submitted", at: "2026-06-18T02:00:00.000Z" },
      { state: "submitted", at: "2026-06-18T01:00:00.000Z" },
      { state: "reserved", at: "2026-06-18T02:30:00.000Z" }
    ],
    submittedFallbackMs
  ),
  Date.parse("2026-06-18T02:00:00.000Z"),
  "out-of-order submitted audit entries must use the maximum valid timestamp"
);
assert.equal(
  resolveLatestSubmittedPaidImageAuditTimestampMs(
    [
      { state: "submitted", at: "invalid" },
      { state: "submitted", at: "2026-06-18T01:30:00.000Z" }
    ],
    submittedFallbackMs
  ),
  Date.parse("2026-06-18T01:30:00.000Z"),
  "invalid submitted timestamps must be ignored"
);
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
  "provider task failed: payment_required after timeout",
  "submitted provider task response was ambiguous after timeout",
  "submitted provider task timed out before task id was received"
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
assert.match(source, /mode\?: "videos-base64"/);
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
  /resolveVideosBase64AcceptedTaskPollCeilingMs\(config\.acceptedQueueStaleMs\s*\?\?\s*config\.maxPollMs\)/,
  "acceptedQueueStaleMs must be read as the compatibility input before the fixed 30-minute safety normalization"
);
const pollBranchStart = source.indexOf('if (slotAction.action === "poll")');
const pollTaskAssignment = source.indexOf("taskId = slotAction.providerTaskId", pollBranchStart);
const firstStatusQuery = source.indexOf("fetchVideosBase64TaskWithTransportRetries(taskId, false", pollTaskAssignment);
const firstAcceptedFailure = source.indexOf("recordPaidImageFailedAfterAcceptance({", pollTaskAssignment);
assert.ok(pollBranchStart >= 0 && pollTaskAssignment > pollBranchStart, "polling must retain the persisted provider task ID");
assert.ok(firstStatusQuery > pollTaskAssignment, "resumed polling must reach a status query using the persisted task ID");
assert.ok(firstAcceptedFailure > firstStatusQuery, "resumed polling must query provider status before marking acceptance failure");
const persistedImmediateFlag = source.indexOf("queryPersistedTaskImmediately = true", pollTaskAssignment);
const persistedObservationMode = source.indexOf("resumed: queryPersistedTaskImmediately", persistedImmediateFlag);
assert.ok(
  persistedImmediateFlag > pollTaskAssignment && persistedObservationMode > persistedImmediateFlag && firstStatusQuery > persistedObservationMode,
  "persisted polling must select the no-initial-sleep path before its first provider status query"
);
const pollBranchEnd = source.indexOf('if (slotAction.action === "blocked_reserved"', pollBranchStart);
assert.doesNotMatch(
  source.slice(pollBranchStart, pollBranchEnd),
  /expireSubmittedPaidImageQueue/,
  "poll branch must never expire a submitted paid task before querying its provider status"
);
const pollingLoopStart = source.indexOf("export async function observeVideosBase64AcceptedTask");
const pollingLoopEnd = source.indexOf("function formatSlotList", pollingLoopStart);
const pollingLoop = source.slice(pollingLoopStart, pollingLoopEnd);
assert.ok(
  pollingLoop.indexOf("input.query(pollNo)") < pollingLoop.indexOf("const nowMs = input.now()"),
  "each accepted-task iteration must perform its final provider query before elapsed stale classification"
);
assert.ok(
  pollingLoop.indexOf("input.failed(payload)") < pollingLoop.indexOf("const nowMs = input.now()"),
  "queried provider failure must be handled before stale queued/pending classification"
);
assert.match(
  source.slice(firstStatusQuery, source.indexOf("const resultUrl =", firstStatusQuery)),
  /videos-base64 accepted task stayed queued\/pending beyond \$\{maxPollMs\}ms; retrying fixed slot \$\{ledgerSlot\}\.[\s\S]*providerResponse: statusPayload/,
  "ceiling failure must preserve final queued/pending provider evidence"
);
const retryReservation = source.indexOf("slotAction = reservePaidImageSlot({", source.indexOf("const keepPolicyCompatiblePrompt"));
assert.ok(
  source.indexOf("promptText = policyCompatiblePromptText", source.indexOf("const keepPolicyCompatiblePrompt")) < retryReservation,
  "the authoritative policy-compatible prompt must be selected before retry reservation"
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
assert.doesNotMatch(source, /mode === "videos-base64"/, "current-only provider code must not retain obsolete mode branching");
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
  /allowFailedAfterAcceptanceDigestChange\s*=[\s\S]*fixedSlotRecovery\.usePolicyCompatiblePrompt[\s\S]*isPolicyCompatibleRetryFailureReason\(failedAfterAcceptanceReason\)[\s\S]*shouldAllowPaidImagePolicyCompatibilityIdentityTransition/,
  "Repeated provider timeouts must explicitly authorize the one-time fixed-slot digest switch to the stability-compatible prompt"
);
assert.match(source, /submitSlots/);
assert.match(source, /roundStartImageIndex \+ missingLocalIndexes\[itemIndex\] - 1/);
assert.match(source, /sendRequest\(requestBody, "application\/json", videosBase64SubmitTimeoutMs\)/);
assert.match(source, /createConcurrencyGate\(resolveVideosBase64SubmitConcurrency\(config\.submitConcurrency\)\)/);
assert.match(source, /const videosBase64SubmitGate =[\s\S]*createConcurrencyGate\(\s*resolveVideosBase64SubmitConcurrency\(imageGenerationConfig\.submitConcurrency\)\s*\)/);
assert.match(source, /videosBase64SubmitGate,\s*paidImageLedger:/);
assert.match(source, /if \(!options\.feishuBatchFingerprint \|\| !options\.feishuRecordId \|\| !options\.paidImageSubmissionLedgerDir\)/);
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
const ruleDocStatements = ruleDoc.split(/\r?\n/).map((line) => line.replace(/\s+/g, ""));
const stabilityStatements = stabilityChecklist.split(/\r?\n/).map((line) => line.replace(/\s+/g, ""));
assert.equal(
  ruleDocStatements.some((line) => /3分钟.*操作层外部服务等待.*退避.*慢服务阈值.*不得.*重新提交付费任务/.test(line)),
  true,
  "The operational three-minute semantics must coexist in one bounded rule statement"
);
assert.equal(
  ruleDocStatements.some((line) => /30分钟.*已受理付费任务.*观察上限.*30分钟.*最终状态查询/.test(line)),
  true,
  "The accepted-task observation ceiling and final query must coexist in one bounded rule statement"
);
assert.equal(
  stabilityStatements.some((line) => /已受理付费任务.*观察上限.*30分钟.*30分钟.*最终状态查询/.test(line)),
  true,
  "The checklist must keep the accepted-task ceiling and final query in one bounded statement"
);
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
assert.equal(resolveOpenAiCompatibleImageMode("videos-base64", "https://relay.example/v1/videos"), "videos-base64");
assert.equal(resolveOpenAiCompatibleImageMode("videos-base64", "http://relay.example/v1/videos"), "videos-base64");
const invalidEndpointUrls = [
  "file://localhost/v1/videos",
  "file:///v1/videos",
  "ftp://relay.example/v1/videos",
  "https://user:password@relay.example/v1/videos"
];
const unexpectedlyAcceptedEndpoints = invalidEndpointUrls.filter((apiUrl) => {
  try {
    resolveOpenAiCompatibleImageMode("videos-base64", apiUrl);
    return true;
  } catch {
    return false;
  }
});
assert.deepEqual(
  unexpectedlyAcceptedEndpoints,
  [],
  "image generation endpoint must use credential-free http(s) with a nonempty hostname"
);
for (const [mode, apiUrl] of [
  [undefined, "https://relay.example/v1/videos"],
  ["edits", "https://relay.example/v1/videos"],
  ["videos-base64", "https://relay.example/v1/videos/"],
  ["videos-base64", "https://relay.example/v1/videos///"],
  ["media-generate", "https://relay.example/v1/media/generate"],
  ["generations", "https://relay.example/v1/images/generations"],
  ["videos-base64", "https://relay.example/v1/images/edits"]
]) {
  assert.throws(
    () => resolveOpenAiCompatibleImageMode(mode, apiUrl),
    /videos-base64.*\/v1\/videos/i,
    `invalid provider config must fail closed: ${mode} ${apiUrl}`
  );
}
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

const unsafeRestartRoot = fs.mkdtempSync(path.join(os.tmpdir(), "videos-base64-unsafe-restart-"));
const unsafeRestartLedgerRoot = path.join(unsafeRestartRoot, "ledger");
const unsafeRestartSourceImage = path.join(unsafeRestartRoot, "source.png");
const unsafeRestartConfigFile = path.join(unsafeRestartRoot, "image-generation.json");
const unsafeRestartPromptFile = path.join(unsafeRestartRoot, "prompt.docx");
const unsafeRestartShopRoot = path.join(unsafeRestartRoot, "shops");
const unsafeRestartConfig = {
  provider: "openai-compatible",
  apiUrl: "https://provider.example/v1/videos",
  apiKey: "test-only-key",
  model: "gpt-image-2",
  mode: "videos-base64",
  size: "1024x1024",
  pollIntervalMs: 1
};
const unsafeRestartPromptParagraphs = [
  "main instruction",
  "selling points",
  "DeepSeek prompt",
  "positive prompt",
  "negative prompt"
];
fs.writeFileSync(unsafeRestartSourceImage, "source-image-bytes");
fs.writeFileSync(unsafeRestartConfigFile, JSON.stringify(unsafeRestartConfig));
writeSimpleWordDocument(unsafeRestartPromptFile, unsafeRestartPromptParagraphs);
for (const shop of getShopSpecs()) {
  fs.mkdirSync(path.join(unsafeRestartShopRoot, `${shop.shopCode}${shop.watermarkText}`), { recursive: true });
}
const unsafeRestartLedger = initializePaidImageProductLedger({
  rootDir: unsafeRestartLedgerRoot,
  batchFingerprint: "unsafe-restart-batch",
  recordId: "unsafe-restart-record",
  expectedSlotCount: 1,
  providerIdentity: sha256Text(JSON.stringify({
    apiUrl: unsafeRestartConfig.apiUrl,
    statusUrl: "",
    model: unsafeRestartConfig.model,
    mode: unsafeRestartConfig.mode,
    size: unsafeRestartConfig.size,
    videoMetadata: {},
    requestExtra: {}
  })),
  sourceImageDigest: sha256File(unsafeRestartSourceImage)
});
const unsafeRestartPromptText = buildImageEditPromptFromWord({
  paragraphs: unsafeRestartPromptParagraphs,
  promptWordFile: unsafeRestartPromptFile
});
const unsafeRestartRequestBody = JSON.stringify({
  model: unsafeRestartConfig.model,
  prompt: unsafeRestartPromptText,
  metadata: {
    aspect_ratio: "1:1",
    size: unsafeRestartConfig.size,
    urls: [`data:image/png;base64,${fs.readFileSync(unsafeRestartSourceImage).toString("base64")}`]
  }
});
reservePaidImageSlot({
  productDir: unsafeRestartLedger.productDir,
  slot: 1,
  requestDigest: sha256Text(unsafeRestartRequestBody),
  promptDigest: sha256Text(unsafeRestartPromptText),
  owner: { runId: "first-process", taskId: "image-001" }
});
recordPaidImageSubmitted({
  productDir: unsafeRestartLedger.productDir,
  slot: 1,
  providerTaskId: "unsafe-restart-provider-task"
});
const unsafeFailureReason = "provider task failed during image generation: insufficient balance";
recordPaidImageFailedAfterAcceptance({
  productDir: unsafeRestartLedger.productDir,
  slot: 1,
  providerTaskId: "unsafe-restart-provider-task",
  reason: unsafeFailureReason,
  providerResponse: { id: "unsafe-restart-provider-task", status: "failed", message: "insufficient balance" }
});
const unsafeSlotFile = path.join(unsafeRestartLedger.productDir, "slots", "01.json");
const legacyUnsafeSignedUrl =
  "https://legacy-unsafe-replay.example/detail?sig=legacy-replay-signature&token=legacy-replay-token";
const legacyUnsafeFailureReason = `${unsafeFailureReason}; details ${legacyUnsafeSignedUrl}`;
const legacyUnsafeSlot = JSON.parse(fs.readFileSync(unsafeSlotFile, "utf8"));
legacyUnsafeSlot.reason = legacyUnsafeFailureReason;
legacyUnsafeSlot.audit.at(-1).reason = legacyUnsafeFailureReason;
fs.writeFileSync(unsafeSlotFile, JSON.stringify(legacyUnsafeSlot, null, 2) + "\n", "utf8");
const unsafeSlotBeforeRestart = fs.readFileSync(unsafeSlotFile, "utf8");
const originalFetch = globalThis.fetch;
let unsafeRestartTransportCalls = 0;
let unsafeRestartFailure;
const unsafeRestartRuntimeDir = path.join(unsafeRestartRoot, "second-process-runtime");
globalThis.fetch = async () => {
  unsafeRestartTransportCalls += 1;
  throw new Error("unsafe restart must fail closed before submission transport");
};
try {
  await assert.rejects(
    async () => {
      try {
        return await generateMainImageAssets({
          runtimeDir: unsafeRestartRuntimeDir,
          taskId: "image-001",
          shopRootDir: unsafeRestartShopRoot,
          sourceImagePath: unsafeRestartSourceImage,
          sellingPointText: "test product",
          brandedGenericName: "test product",
          wordFiles: [unsafeRestartPromptFile],
          imageGenerationProvider: "openai-compatible",
          imageGenerationConfigFile: unsafeRestartConfigFile,
          mainImageExpectedCount: 1,
          mainImageCountStrategy: "exact",
          promptCount: 1,
          shopCodes: ["01"],
          imagesPerShop: 1,
          feishuRecordId: "unsafe-restart-record",
          feishuBatchFingerprint: "unsafe-restart-batch",
          paidImageSubmissionLedgerDir: unsafeRestartLedgerRoot,
          simulateOnly: false
        });
      } catch (error) {
        unsafeRestartFailure = error;
        throw error;
      }
    },
    /insufficient balance/i,
    "a restarted process must propagate an unsafe paid failure before reserving or submitting"
  );
} finally {
  globalThis.fetch = originalFetch;
}
const unsafeRestartFailureText = String(unsafeRestartFailure?.message || unsafeRestartFailure);
assert.match(unsafeRestartFailureText, /insufficient balance/i);
assert.doesNotMatch(
  unsafeRestartFailureText,
  /https:\/\/legacy-unsafe-replay\.example|legacy-replay-signature|legacy-replay-token/
);
assert.doesNotMatch(
  readTextTree(unsafeRestartRuntimeDir),
  /https:\/\/legacy-unsafe-replay\.example|legacy-replay-signature|legacy-replay-token/
);
assert.equal(unsafeRestartTransportCalls, 0, "unsafe paid failure replay must not call submission transport after restart");
assert.equal(
  fs.readFileSync(unsafeSlotFile, "utf8"),
  unsafeSlotBeforeRestart,
  "unsafe failed_after_acceptance evidence must remain byte-for-byte unchanged after restart"
);

async function captureProviderFailure(label, fetchImpl) {
  const runtimeDir = path.join(unsafeRestartRoot, `${label}-runtime`);
  const ledgerRoot = path.join(unsafeRestartRoot, `${label}-ledger`);
  let failure;
  globalThis.fetch = fetchImpl;
  try {
    await assert.rejects(async () => {
      try {
        return await generateMainImageAssets({
          runtimeDir,
          taskId: "image-001",
          shopRootDir: unsafeRestartShopRoot,
          sourceImagePath: unsafeRestartSourceImage,
          sellingPointText: "test product",
          brandedGenericName: "test product",
          wordFiles: [unsafeRestartPromptFile],
          imageGenerationProvider: "openai-compatible",
          imageGenerationConfigFile: unsafeRestartConfigFile,
          mainImageExpectedCount: 1,
          mainImageCountStrategy: "exact",
          promptCount: 1,
          shopCodes: ["01"],
          imagesPerShop: 1,
          feishuRecordId: `${label}-record`,
          feishuBatchFingerprint: `${label}-batch`,
          paidImageSubmissionLedgerDir: ledgerRoot,
          simulateOnly: false
        });
      } catch (error) {
        failure = error;
        throw error;
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { failureText: String(failure?.message || failure), runtimeText: readTextTree(runtimeDir) };
}

const downloadFailure = await captureProviderFailure("download-http-secret", async (url, init) => {
  if (init?.method === "POST") {
    return new Response(JSON.stringify({ id: "download-http-secret-task" }), { status: 200 });
  }
  if (String(url).endsWith("/download-http-secret-task")) {
    return new Response(
      JSON.stringify({
        id: "download-http-secret-task",
        status: "completed",
        result_url: "https://cdn.example/result.png?signature=download-signed-secret"
      }),
      { status: 200 }
    );
  }
  if (String(url).startsWith("https://cdn.example/result.png")) {
    return new Response(
      "download denied: api key download-secret-token; signed URL https://cdn.example/private?sig=download-body-secret",
      { status: 403, statusText: "Forbidden" }
    );
  }
  throw new Error(`unexpected download failure transport: ${url}`);
});
assert.match(downloadFailure.failureText, /Image download failed.*HTTP 403.*download denied/i);
assert.doesNotMatch(downloadFailure.failureText, /download-secret-token|download-(?:signed|body)-secret/);
assert.doesNotMatch(downloadFailure.runtimeText, /download-secret-token|download-(?:signed|body)-secret/);

const contentFailure = await captureProviderFailure("content-http-secret", async (url, init) => {
  if (init?.method === "POST") {
    return new Response(JSON.stringify({ id: "content-http-secret-task" }), { status: 200 });
  }
  if (String(url).endsWith("/content-http-secret-task/content")) {
    return new Response(
      "content denied: api key content-secret-token; signed URL https://cdn.example/private?sig=content-signed-secret",
      { status: 403, statusText: "Forbidden" }
    );
  }
  if (String(url).endsWith("/content-http-secret-task")) {
    return new Response(JSON.stringify({ id: "content-http-secret-task", status: "completed" }), { status: 200 });
  }
  throw new Error(`unexpected content failure transport: ${url}`);
});
assert.match(contentFailure.failureText, /content download failed.*HTTP 403.*content denied/i);
assert.doesNotMatch(contentFailure.failureText, /content-secret-token|content-signed-secret/);
assert.doesNotMatch(contentFailure.runtimeText, /content-secret-token|content-signed-secret/);

const malformedSubmitFailure = await captureProviderFailure("malformed-submit-secret", async (_url, init) => {
  if (init?.method === "POST") {
    return new Response(
      "authentication failed: api key malformed-submit-token https://signed.example/submit?sig=malformed-submit-signed",
      { status: 200 }
    );
  }
  throw new Error("malformed submit must fail before status transport");
});
assert.match(malformedSubmitFailure.failureText, /submit response was not JSON.*authentication failed/i);
assert.doesNotMatch(malformedSubmitFailure.failureText, /malformed-submit-token|malformed-submit-signed/);
assert.doesNotMatch(malformedSubmitFailure.runtimeText, /malformed-submit-token|malformed-submit-signed/);

const malformedStatusFailure = await captureProviderFailure("malformed-status-secret", async (url, init) => {
  if (init?.method === "POST") {
    return new Response(JSON.stringify({ id: "malformed-status-secret-task" }), { status: 200 });
  }
  if (String(url).endsWith("/malformed-status-secret-task")) {
    return new Response(
      "authentication failed: api key malformed-status-token https://signed.example/status?sig=malformed-status-signed",
      { status: 200 }
    );
  }
  throw new Error(`unexpected malformed status transport: ${url}`);
});
assert.match(malformedStatusFailure.failureText, /status response was not JSON.*authentication failed/i);
assert.doesNotMatch(malformedStatusFailure.failureText, /malformed-status-token|malformed-status-signed/);
assert.doesNotMatch(malformedStatusFailure.runtimeText, /malformed-status-token|malformed-status-signed/);

const policyRestartLedgerRoot = path.join(unsafeRestartRoot, "policy-retry-ledger");
const policyRestartLedger = initializePaidImageProductLedger({
  rootDir: policyRestartLedgerRoot,
  batchFingerprint: "policy-restart-batch",
  recordId: "policy-restart-record",
  expectedSlotCount: 2,
  providerIdentity: unsafeRestartLedger.providerIdentity,
  sourceImageDigest: sha256File(unsafeRestartSourceImage)
});
const completedPng = path.join(unsafeRestartRoot, "completed.png");
fs.writeFileSync(
  completedPng,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
);
for (const slot of [1, 2]) {
  reservePaidImageSlot({
    productDir: policyRestartLedger.productDir,
    slot,
    requestDigest: sha256Text(unsafeRestartRequestBody),
    promptDigest: sha256Text(unsafeRestartPromptText),
    owner: { runId: "policy-first-process", taskId: "image-001" }
  });
  recordPaidImageSubmitted({
    productDir: policyRestartLedger.productDir,
    slot,
    providerTaskId: `policy-original-task-${slot}`
  });
}
recordPaidImageCompleted({
  productDir: policyRestartLedger.productDir,
  slot: 1,
  providerTaskId: "policy-original-task-1",
  sourceFile: completedPng
});
recordPaidImageFailedAfterAcceptance({
  productDir: policyRestartLedger.productDir,
  slot: 2,
  providerTaskId: "policy-original-task-2",
  reason: 'provider task failed: {"code":"upstream_error","message":"content policy violation"}',
  providerResponse: { id: "policy-original-task-2", status: "failed", code: "upstream_error" }
});
const completedSlotFile = path.join(policyRestartLedger.productDir, "slots", "01.json");
const completedSlotBeforeRestart = fs.readFileSync(completedSlotFile, "utf8");
let policyRestartSubmitCalls = 0;
globalThis.fetch = async (url, init) => {
  if (init?.method === "POST") {
    policyRestartSubmitCalls += 1;
    return new Response(JSON.stringify({ id: "policy-retry-task-2" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  if (String(url).endsWith("/policy-retry-task-2")) {
    return new Response(JSON.stringify({
      id: "policy-retry-task-2",
      status: "completed",
      result_url: "https://provider.example/policy-retry-result.png"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(url) === "https://provider.example/policy-retry-result.png") {
    return new Response(fs.readFileSync(completedPng), { status: 200, headers: { "content-type": "image/png" } });
  }
  throw new Error(`unexpected policy restart transport: ${url}`);
};
try {
  await generateMainImageAssets({
    runtimeDir: path.join(unsafeRestartRoot, "policy-second-process-runtime"),
    taskId: "image-001",
    shopRootDir: unsafeRestartShopRoot,
    sourceImagePath: unsafeRestartSourceImage,
    sellingPointText: "test product",
    brandedGenericName: "test product",
    wordFiles: [unsafeRestartPromptFile],
    imageGenerationProvider: "openai-compatible",
    imageGenerationConfigFile: unsafeRestartConfigFile,
    mainImageExpectedCount: 2,
    mainImageCountStrategy: "exact",
    promptCount: 1,
    shopCodes: ["01"],
    imagesPerShop: 2,
    feishuRecordId: "policy-restart-record",
    feishuBatchFingerprint: "policy-restart-batch",
    paidImageSubmissionLedgerDir: policyRestartLedgerRoot,
    simulateOnly: false
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(policyRestartSubmitCalls, 1, "restart must resubmit exactly the failed content-policy slot");
assert.equal(
  fs.readFileSync(completedSlotFile, "utf8"),
  completedSlotBeforeRestart,
  "content-policy restart must leave an already completed slot unchanged"
);
assert.equal(
  JSON.parse(fs.readFileSync(path.join(policyRestartLedger.productDir, "slots", "02.json"), "utf8")).state,
  "completed",
  "the bounded content-policy retry must complete only its failed fixed slot"
);

for (const [reason, expectedUnsafe] of [
  ["provider task failed: content policy violation", false],
  ["provider task failed: content forbidden by policy", false],
  ["fetch failed before a provider response", false],
  ['HTTP 400: {"code":"fail_to_fetch_task"}', false],
  ["HTTP 403: access forbidden", true],
  ["provider task failed: permission denied", true],
  ["provider task failed: authentication failed", true]
]) {
  assert.equal(isUnsafePaidImageReplayReason(reason), expectedUnsafe, `paid replay safety mismatch: ${reason}`);
}
for (const safeFinancialSubstring of [
  "provider task failed: white balance adjustment failed",
  "provider task failed: unbalanced dimensions",
  "provider task failed: accreditation watermark rejected"
]) {
  assert.equal(
    isUnsafePaidImageReplayReason(safeFinancialSubstring),
    false,
    `non-financial substring must remain bounded retryable: ${safeFinancialSubstring}`
  );
}
for (const unsafeFinancialReason of [
  "provider task failed: insufficient balance",
  "provider task failed: insufficient credit",
  "provider task failed: quota exceeded",
  "provider task failed: billing account disabled",
  "provider task failed: payment required",
  "provider task failed: rate limit exceeded",
  "provider task failed: limit exceeded",
  "provider task failed: account limit exceeded",
  "provider task failed: monthly limit reached",
  "provider task failed: insufficient funds",
  "provider task failed: limit_exceeded",
  "provider task failed: insufficient_funds"
]) {
  assert.equal(
    isUnsafePaidImageReplayReason(unsafeFinancialReason),
    true,
    `explicit financial failure must be non-replayable: ${unsafeFinancialReason}`
  );
}
assert.equal(
  isUnsafePaidImageReplayPayload({
    status: "failed",
    errors: [
      ...Array.from({ length: 140 }, (_, index) => ({ message: `benign diagnostic ${index}` })),
      { code: "invalid_api_key", message: "authentication failed" }
    ]
  }),
  true,
  "evidence traversal must fail closed when the node budget is exceeded before unsafe evidence"
);
let depthBudgetPayload = { code: "invalid_api_key", message: "authentication failed" };
for (let depth = 0; depth < 12; depth += 1) {
  depthBudgetPayload = { error: depthBudgetPayload };
}
assert.equal(
  isUnsafePaidImageReplayPayload({ status: "failed", error: depthBudgetPayload }),
  true,
  "evidence traversal must fail closed when the depth budget is exceeded before unsafe evidence"
);
assert.equal(
  isUnsafePaidImageReplayPayload({
    status: "failed",
    diagnostics: { error: { code: "invalid_api_key", message: "authentication failed" } }
  }),
  true,
  "unsafe evidence nested under an unknown plain-object container must be classified"
);
assert.equal(
  isUnsafePaidImageReplayPayload({
    status: "failed",
    result: { errors: [{ code: "permission_denied", message: "permission denied" }] }
  }),
  true,
  "unsafe evidence nested under unknown object and array containers must be classified"
);
let unknownDepthBudgetPayload = { note: "benign" };
for (let depth = 0; depth < 12; depth += 1) {
  unknownDepthBudgetPayload = { wrapper: unknownDepthBudgetPayload };
}
assert.equal(
  isUnsafePaidImageReplayPayload({ diagnostics: unknownDepthBudgetPayload }),
  true,
  "unknown-container depth budget exhaustion must fail closed"
);
assert.equal(
  isUnsafePaidImageReplayPayload({ diagnostics: Array.from({ length: 140 }, () => ({ note: "benign" })) }),
  true,
  "unknown-container node budget exhaustion must fail closed"
);
let evidenceGetterReads = 0;
const getterBudgetPayload = {};
for (let index = 0; index < 200; index += 1) {
  Object.defineProperty(getterBudgetPayload, `diagnostic${index}`, {
    enumerable: true,
    get() {
      evidenceGetterReads += 1;
      return { note: `benign ${index}` };
    }
  });
}
assert.equal(isUnsafePaidImageReplayPayload(getterBudgetPayload), true);
assert.ok(
  evidenceGetterReads <= 128,
  `evidence traversal must stop reading getters at its node budget; reads=${evidenceGetterReads}`
);
assert.equal(
  isUnsafePaidImageReplayPayload({ diagnostics: { note: "small benign diagnostic" }, status: "failed" }),
  false,
  "small fully inspected unknown-container diagnostics must not become unsafe"
);
assert.equal(
  isUnsafePaidImageReplayPayload({
    status: "failed",
    diagnostics: { Error: { Code: "invalid_api_key", error_description: "authentication failed" } }
  }),
  true,
  "structured unsafe evidence keys and aliases must be matched case-insensitively"
);
assert.equal(
  isUnsafePaidImageReplayPayload({ status: 401, error_description: "provider rejected credentials" }),
  true,
  "numeric 401 status evidence must be non-replayable"
);
assert.equal(
  isUnsafePaidImageReplayPayload({ data: { Status: 403, Message: "request rejected" } }),
  true,
  "nested numeric 403 status evidence must be non-replayable"
);
for (const payload of [
  { Code: 401 },
  { diagnostics: { error_code: 403 } },
  { data: { Status_Code: 401 } }
]) {
  assert.equal(
    isUnsafePaidImageReplayPayload(payload),
    true,
    `numeric authorization code alias must be non-replayable: ${JSON.stringify(payload)}`
  );
}
for (const payload of [{ code: 200 }, { error_code: 500 }, { status_code: 429 }]) {
  assert.equal(
    isUnsafePaidImageReplayPayload(payload),
    false,
    `arbitrary numeric code evidence must remain replayable: ${JSON.stringify(payload)}`
  );
}

const unsafeBeforeLedgerRoot = path.join(unsafeRestartRoot, "unsafe-before-ledger");
const unsafeBeforeLedger = initializePaidImageProductLedger({
  rootDir: unsafeBeforeLedgerRoot,
  batchFingerprint: "unsafe-before-batch",
  recordId: "unsafe-before-record",
  expectedSlotCount: 1,
  providerIdentity: unsafeRestartLedger.providerIdentity,
  sourceImageDigest: sha256File(unsafeRestartSourceImage)
});
reservePaidImageSlot({
  productDir: unsafeBeforeLedger.productDir,
  slot: 1,
  requestDigest: sha256Text(unsafeRestartRequestBody),
  promptDigest: sha256Text(unsafeRestartPromptText),
  owner: { runId: "unsafe-before-first-process", taskId: "image-001" }
});
recordPaidImageFailedBeforeAcceptance({
  productDir: unsafeBeforeLedger.productDir,
  slot: 1,
  reason: "HTTP 401: authentication failed"
});
const unsafeBeforeSlotFile = path.join(unsafeBeforeLedger.productDir, "slots", "01.json");
const unsafeBeforeSlotBeforeRestart = fs.readFileSync(unsafeBeforeSlotFile, "utf8");
let unsafeBeforeTransportCalls = 0;
globalThis.fetch = async () => {
  unsafeBeforeTransportCalls += 1;
  throw new Error("unsafe failed-before-acceptance restart must not reach transport");
};
try {
  await assert.rejects(
    () => generateMainImageAssets({
      runtimeDir: path.join(unsafeRestartRoot, "unsafe-before-second-process-runtime"),
      taskId: "image-001",
      shopRootDir: unsafeRestartShopRoot,
      sourceImagePath: unsafeRestartSourceImage,
      sellingPointText: "test product",
      brandedGenericName: "test product",
      wordFiles: [unsafeRestartPromptFile],
      imageGenerationProvider: "openai-compatible",
      imageGenerationConfigFile: unsafeRestartConfigFile,
      mainImageExpectedCount: 1,
      mainImageCountStrategy: "exact",
      promptCount: 1,
      shopCodes: ["01"],
      imagesPerShop: 1,
      feishuRecordId: "unsafe-before-record",
      feishuBatchFingerprint: "unsafe-before-batch",
      paidImageSubmissionLedgerDir: unsafeBeforeLedgerRoot,
      simulateOnly: false
    }),
    /authentication failed/i
  );
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(unsafeBeforeTransportCalls, 0, "unsafe failed-before restart must not call submission transport");
assert.equal(
  fs.readFileSync(unsafeBeforeSlotFile, "utf8"),
  unsafeBeforeSlotBeforeRestart,
  "unsafe failed-before ledger evidence must remain byte-for-byte unchanged"
);

const submitHttpLedgerRoot = path.join(unsafeRestartRoot, "submit-http-ledger");
const submitHttpRuntimeDir = path.join(unsafeRestartRoot, "submit-http-runtime");
const submitHttpSecret = "submit-http-secret-token";
let submitHttpFailure;
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({ code: "invalid_api_key", message: `authentication failed: api key ${submitHttpSecret}` }),
    { status: 401, statusText: "Unauthorized" }
  );
try {
  await assert.rejects(
    async () => {
      try {
        return await generateMainImageAssets({
          runtimeDir: submitHttpRuntimeDir,
          taskId: "image-001",
          shopRootDir: unsafeRestartShopRoot,
          sourceImagePath: unsafeRestartSourceImage,
          sellingPointText: "test product",
          brandedGenericName: "test product",
          wordFiles: [unsafeRestartPromptFile],
          imageGenerationProvider: "openai-compatible",
          imageGenerationConfigFile: unsafeRestartConfigFile,
          mainImageExpectedCount: 1,
          mainImageCountStrategy: "exact",
          promptCount: 1,
          shopCodes: ["01"],
          imagesPerShop: 1,
          feishuRecordId: "submit-http-record",
          feishuBatchFingerprint: "submit-http-batch",
          paidImageSubmissionLedgerDir: submitHttpLedgerRoot,
          simulateOnly: false
        });
      } catch (error) {
        submitHttpFailure = error;
        throw error;
      }
    },
    /HTTP 401|authentication failed/i
  );
} finally {
  globalThis.fetch = originalFetch;
}
assert.match(String(submitHttpFailure?.message || submitHttpFailure), /HTTP 401/i);
assert.doesNotMatch(String(submitHttpFailure?.message || submitHttpFailure), new RegExp(submitHttpSecret));
assert.match(readTextTree(submitHttpRuntimeDir), /invalid_api_key|authentication failed/i);
assert.doesNotMatch(readTextTree(submitHttpRuntimeDir), new RegExp(submitHttpSecret));
const submitHttpLedgerText = readTextTree(submitHttpLedgerRoot);
assert.match(submitHttpLedgerText, /non_replayable/);
assert.doesNotMatch(submitHttpLedgerText, new RegExp(submitHttpSecret));

const submitSignedUrlLedgerRoot = path.join(unsafeRestartRoot, "submit-signed-url-ledger");
const submitSignedUrlRuntimeDir = path.join(unsafeRestartRoot, "submit-signed-url-runtime");
const submitSignedUrl =
  "https://provider.example/help?sig=ledger-signed-value&token=ledger-query-value";
let submitSignedUrlCalls = 0;
globalThis.fetch = async () => {
  submitSignedUrlCalls += 1;
  return new Response(
    JSON.stringify({ code: "request_rejected", message: `details ${submitSignedUrl}` }),
    { status: 401, statusText: "Unauthorized" }
  );
};
try {
  await assert.rejects(
    () => generateMainImageAssets({
      runtimeDir: submitSignedUrlRuntimeDir,
      taskId: "image-001",
      shopRootDir: unsafeRestartShopRoot,
      sourceImagePath: unsafeRestartSourceImage,
      sellingPointText: "test product",
      brandedGenericName: "test product",
      wordFiles: [unsafeRestartPromptFile],
      imageGenerationProvider: "openai-compatible",
      imageGenerationConfigFile: unsafeRestartConfigFile,
      mainImageExpectedCount: 1,
      mainImageCountStrategy: "exact",
      promptCount: 1,
      shopCodes: ["01"],
      imagesPerShop: 1,
      feishuRecordId: "submit-signed-url-record",
      feishuBatchFingerprint: "submit-signed-url-batch",
      paidImageSubmissionLedgerDir: submitSignedUrlLedgerRoot,
      simulateOnly: false
    }),
    /HTTP 401/i
  );
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(submitSignedUrlCalls, 1, "submit HTTP rejection must stop after its single paid POST");
const submitSignedUrlLedgerText = readTextTree(submitSignedUrlLedgerRoot);
assert.match(submitSignedUrlLedgerText, /HTTP 401/, "safe HTTP status context must remain in the ledger");
assert.match(submitSignedUrlLedgerText, /non_replayable/);
assert.doesNotMatch(submitSignedUrlLedgerText, /https:\/\/provider\.example/);
assert.doesNotMatch(submitSignedUrlLedgerText, /ledger-signed-value/);
assert.doesNotMatch(submitSignedUrlLedgerText, /ledger-query-value/);

const statusHttpLedgerRoot = path.join(unsafeRestartRoot, "status-http-ledger");
const statusHttpRuntimeDir = path.join(unsafeRestartRoot, "status-http-runtime");
const statusHttpSecret = "status-http-secret-token";
let statusHttpFailure;
globalThis.fetch = async (url, init) => {
  if (init?.method === "POST") {
    return new Response(JSON.stringify({ id: "status-http-task" }), { status: 200 });
  }
  if (String(url).endsWith("/status-http-task")) {
    return new Response(
      JSON.stringify({ code: "status_query_unauthorized", message: `authentication failed: api key ${statusHttpSecret}` }),
      { status: 401, statusText: "Unauthorized" }
    );
  }
  throw new Error(`unexpected status HTTP transport: ${url}`);
};
try {
  await assert.rejects(
    async () => {
      try {
        return await generateMainImageAssets({
          runtimeDir: statusHttpRuntimeDir,
          taskId: "image-001",
          shopRootDir: unsafeRestartShopRoot,
          sourceImagePath: unsafeRestartSourceImage,
          sellingPointText: "test product",
          brandedGenericName: "test product",
          wordFiles: [unsafeRestartPromptFile],
          imageGenerationProvider: "openai-compatible",
          imageGenerationConfigFile: unsafeRestartConfigFile,
          mainImageExpectedCount: 1,
          mainImageCountStrategy: "exact",
          promptCount: 1,
          shopCodes: ["01"],
          imagesPerShop: 1,
          feishuRecordId: "status-http-record",
          feishuBatchFingerprint: "status-http-batch",
          paidImageSubmissionLedgerDir: statusHttpLedgerRoot,
          simulateOnly: false
        });
      } catch (error) {
        statusHttpFailure = error;
        throw error;
      }
    },
    /HTTP 401|authentication failed/i
  );
} finally {
  globalThis.fetch = originalFetch;
}
assert.match(String(statusHttpFailure?.message || statusHttpFailure), /HTTP 401/i);
assert.doesNotMatch(String(statusHttpFailure?.message || statusHttpFailure), new RegExp(statusHttpSecret));
assert.match(readTextTree(statusHttpRuntimeDir), /status_query_unauthorized|authentication failed/i);
assert.doesNotMatch(readTextTree(statusHttpRuntimeDir), new RegExp(statusHttpSecret));

const legacyRedactedLedgerRoot = path.join(unsafeRestartRoot, "legacy-redacted-ledger");
const legacyRedactedLedger = initializePaidImageProductLedger({
  rootDir: legacyRedactedLedgerRoot,
  batchFingerprint: "legacy-redacted-batch",
  recordId: "legacy-redacted-record",
  expectedSlotCount: 1,
  providerIdentity: unsafeRestartLedger.providerIdentity,
  sourceImageDigest: sha256File(unsafeRestartSourceImage)
});
reservePaidImageSlot({
  productDir: legacyRedactedLedger.productDir,
  slot: 1,
  requestDigest: sha256Text(unsafeRestartRequestBody),
  promptDigest: sha256Text(unsafeRestartPromptText),
  owner: { runId: "legacy-process", taskId: "image-001" }
});
recordPaidImageFailedBeforeAcceptance({
  productDir: legacyRedactedLedger.productDir,
  slot: 1,
  reason: "[redacted]"
});
const legacyRedactedSlotFile = path.join(legacyRedactedLedger.productDir, "slots", "01.json");
const legacyRedactedSlotBeforeRestart = fs.readFileSync(legacyRedactedSlotFile, "utf8");
let legacyRedactedTransportCalls = 0;
globalThis.fetch = async () => {
  legacyRedactedTransportCalls += 1;
  throw new Error("legacy redacted slot must fail closed before transport");
};
try {
  await assert.rejects(
    () => generateMainImageAssets({
      runtimeDir: path.join(unsafeRestartRoot, "legacy-redacted-restart-runtime"),
      taskId: "image-001",
      shopRootDir: unsafeRestartShopRoot,
      sourceImagePath: unsafeRestartSourceImage,
      sellingPointText: "test product",
      brandedGenericName: "test product",
      wordFiles: [unsafeRestartPromptFile],
      imageGenerationProvider: "openai-compatible",
      imageGenerationConfigFile: unsafeRestartConfigFile,
      mainImageExpectedCount: 1,
      mainImageCountStrategy: "exact",
      promptCount: 1,
      shopCodes: ["01"],
      imagesPerShop: 1,
      feishuRecordId: "legacy-redacted-record",
      feishuBatchFingerprint: "legacy-redacted-batch",
      paidImageSubmissionLedgerDir: legacyRedactedLedgerRoot,
      simulateOnly: false
    }),
    /redacted|not safe to replay/i
  );
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(legacyRedactedTransportCalls, 0, "legacy redacted retry evidence must block restart transport");
assert.equal(
  fs.readFileSync(legacyRedactedSlotFile, "utf8"),
  legacyRedactedSlotBeforeRestart,
  "legacy redacted slot must remain byte-for-byte unchanged after restart"
);

const unsafeTerminalLedgerRoot = path.join(unsafeRestartRoot, "unsafe-terminal-ledger");
const unsafeTerminalLedger = initializePaidImageProductLedger({
  rootDir: unsafeTerminalLedgerRoot,
  batchFingerprint: "unsafe-terminal-batch",
  recordId: "unsafe-terminal-record",
  expectedSlotCount: 1,
  providerIdentity: unsafeRestartLedger.providerIdentity,
  sourceImageDigest: sha256File(unsafeRestartSourceImage)
});
let unsafeTerminalSubmitCalls = 0;
globalThis.fetch = async (url, init) => {
  if (init?.method === "POST") {
    unsafeTerminalSubmitCalls += 1;
    return new Response(JSON.stringify({ id: "unsafe-terminal-task" }), { status: 200 });
  }
  if (String(url).endsWith("/unsafe-terminal-task")) {
    return new Response(JSON.stringify({
      id: "unsafe-terminal-task",
      status: "failed",
      code: "insufficient_quota",
      message: "insufficient balance"
    }), { status: 200 });
  }
  throw new Error(`unexpected unsafe terminal transport: ${url}`);
};
try {
  await assert.rejects(
    () => generateMainImageAssets({
      runtimeDir: path.join(unsafeRestartRoot, "unsafe-terminal-runtime"),
      taskId: "image-001",
      shopRootDir: unsafeRestartShopRoot,
      sourceImagePath: unsafeRestartSourceImage,
      sellingPointText: "test product",
      brandedGenericName: "test product",
      wordFiles: [unsafeRestartPromptFile],
      imageGenerationProvider: "openai-compatible",
      imageGenerationConfigFile: unsafeRestartConfigFile,
      mainImageExpectedCount: 1,
      mainImageCountStrategy: "exact",
      promptCount: 1,
      shopCodes: ["01"],
      imagesPerShop: 1,
      feishuRecordId: "unsafe-terminal-record",
      feishuBatchFingerprint: "unsafe-terminal-batch",
      paidImageSubmissionLedgerDir: unsafeTerminalLedgerRoot,
      simulateOnly: false
    }),
    /insufficient.quota|insufficient balance/i
  );
} finally {
  globalThis.fetch = originalFetch;
}
const unsafeTerminalSlot = JSON.parse(
  fs.readFileSync(path.join(unsafeTerminalLedger.productDir, "slots", "01.json"), "utf8")
);
assert.equal(unsafeTerminalSubmitCalls, 1, "unsafe accepted terminal payload must stop before a second paid POST");
assert.equal(unsafeTerminalSlot.state, "failed_after_acceptance");
assert.match(unsafeTerminalSlot.reason, /insufficient.quota/i);
assert.match(unsafeTerminalSlot.reason, /insufficient balance/i);

for (const [label, failedPayload, expectedReason] of [
  [
    "top-level",
    { status: "failed", code: "invalid_api_key", message: "api key test-only-key" },
    "[redacted]"
  ],
  [
    "nested",
    {
      status: "failed",
      diagnostics: "x".repeat(3000),
      data: { error: { code: "invalid_api_key", message: "invalid api key sk-nested-secret-value" } }
    },
    "[redacted]"
  ],
  [
    "aliases",
    {
      status: "failed",
      diagnostics: { Error: { Code: "invalid_api_key", error_description: "authentication failed" } }
    },
    "provider task failed: unknown error"
  ],
  [
    "limit-code",
    { status: "failed", code: "limit_exceeded", message: "account limit exceeded" },
    'provider task failed: {"code":"limit_exceeded","message":"account limit exceeded"}'
  ],
  [
    "numeric-auth-code",
    { status: "failed", diagnostics: { Error: { error_code: 401, Message: "request rejected" } } },
    "provider task failed: unknown error"
  ]
]) {
  const recordId = `unsafe-api-key-${label}-record`;
  const batchFingerprint = `unsafe-api-key-${label}-batch`;
  const ledgerRoot = path.join(unsafeRestartRoot, `unsafe-api-key-${label}-ledger`);
  const ledger = initializePaidImageProductLedger({
    rootDir: ledgerRoot,
    batchFingerprint,
    recordId,
    expectedSlotCount: 1,
    providerIdentity: unsafeRestartLedger.providerIdentity,
    sourceImageDigest: sha256File(unsafeRestartSourceImage)
  });
  const initialRuntimeDir = path.join(unsafeRestartRoot, `unsafe-api-key-${label}-initial-runtime`);
  let initialSubmitCalls = 0;
  let initialFailure;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "POST") {
      initialSubmitCalls += 1;
      if (initialSubmitCalls > 1) {
        throw new Error("invalid_api_key terminal failure must stop before a second POST");
      }
      return new Response(JSON.stringify({ id: `unsafe-api-key-${label}-task` }), { status: 200 });
    }
    if (String(url).endsWith(`/unsafe-api-key-${label}-task`)) {
      return new Response(JSON.stringify({ id: `unsafe-api-key-${label}-task`, ...failedPayload }), { status: 200 });
    }
    throw new Error(`unexpected ${label} invalid_api_key transport: ${url}`);
  };
  try {
    await assert.rejects(
      async () => {
        try {
          return await generateMainImageAssets({
            runtimeDir: initialRuntimeDir,
            taskId: "image-001",
            shopRootDir: unsafeRestartShopRoot,
            sourceImagePath: unsafeRestartSourceImage,
            sellingPointText: "test product",
            brandedGenericName: "test product",
            wordFiles: [unsafeRestartPromptFile],
            imageGenerationProvider: "openai-compatible",
            imageGenerationConfigFile: unsafeRestartConfigFile,
            mainImageExpectedCount: 1,
            mainImageCountStrategy: "exact",
            promptCount: 1,
            shopCodes: ["01"],
            imagesPerShop: 1,
            feishuRecordId: recordId,
            feishuBatchFingerprint: batchFingerprint,
            paidImageSubmissionLedgerDir: ledgerRoot,
            simulateOnly: false
          });
        } catch (error) {
          initialFailure = error;
          throw error;
        }
      },
      /invalid.api.key|unknown error|limit exceeded|not safe to replay|paid submission safety block/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(initialSubmitCalls, 1, `${label} invalid_api_key terminal failure must submit only once`);
  const slotFile = path.join(ledger.productDir, "slots", "01.json");
  const slotAfterInitialFailure = fs.readFileSync(slotFile, "utf8");
  const parsedSlot = JSON.parse(slotAfterInitialFailure);
  assert.equal(parsedSlot.state, "failed_after_acceptance");
  assert.equal(parsedSlot.replayDisposition, "non_replayable");
  assert.equal(parsedSlot.audit.at(-1)?.replayDisposition, "non_replayable");
  assert.equal(parsedSlot.reason, expectedReason);
  const secretTokenPattern = /test-only-key|sk-nested-secret-value/;
  assert.doesNotMatch(slotAfterInitialFailure, secretTokenPattern);
  assert.doesNotMatch(String(initialFailure?.message || initialFailure), secretTokenPattern);
  const runtimeArtifactText = fs
    .readdirSync(initialRuntimeDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
  assert.doesNotMatch(runtimeArtifactText, secretTokenPattern);

  let restartTransportCalls = 0;
  globalThis.fetch = async () => {
    restartTransportCalls += 1;
    throw new Error("persisted non-replayable disposition must stop before restart transport");
  };
  try {
    await assert.rejects(
      () => generateMainImageAssets({
        runtimeDir: path.join(unsafeRestartRoot, `unsafe-api-key-${label}-restart-runtime`),
        taskId: "image-001",
        shopRootDir: unsafeRestartShopRoot,
        sourceImagePath: unsafeRestartSourceImage,
        sellingPointText: "test product",
        brandedGenericName: "test product",
        wordFiles: [unsafeRestartPromptFile],
        imageGenerationProvider: "openai-compatible",
        imageGenerationConfigFile: unsafeRestartConfigFile,
        mainImageExpectedCount: 1,
        mainImageCountStrategy: "exact",
        promptCount: 1,
        shopCodes: ["01"],
        imagesPerShop: 1,
        feishuRecordId: recordId,
        feishuBatchFingerprint: batchFingerprint,
        paidImageSubmissionLedgerDir: ledgerRoot,
        simulateOnly: false
      }),
      /not safe to replay/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(restartTransportCalls, 0, `${label} invalid_api_key restart must not call transport`);
  assert.equal(fs.readFileSync(slotFile, "utf8"), slotAfterInitialFailure);
}

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
