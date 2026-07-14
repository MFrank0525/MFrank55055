# Paid Image Status-Driven Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three-minute paid-task replay with status-driven observation capped at 30 minutes, preserve fixed-slot prompt identity, expose partial paid-image artifacts in audits, and safely resume the current locked 17/20 batch.

**Architecture:** Keep provider timing and recovery decisions as pure rules in `image-generation-rules.ts`; make `main-image-assets.ts` execute those decisions by polling the persisted task ID before any stale transition. Keep the three-minute external-service notification/backoff separate from the 30-minute accepted-task observation ceiling. Extend deep audit with a ledger-based artifact dimension so failed runs cannot appear as zero-work successes.

**Tech Stack:** TypeScript, Node.js ESM, filesystem-backed JSON ledgers, existing `.mjs` assertion tests, npm scripts.

---

## File Map

- Modify `src/autolist/image-generation-rules.ts`: define separate three-minute slow/wait threshold and 30-minute accepted-task ceiling; normalize accepted-task timeout classification.
- Modify `src/autolist/main-image-assets.ts`: poll persisted task IDs before stale transition, perform the final query at the ceiling, and reuse the authoritative prompt variant.
- Modify `src/cli/auto-listing-supervisor.ts`: prevent the no-progress watchdog from terminating accepted-task observation before 30 minutes.
- Modify `src/autolist/batch-continuation-rules.ts`: retain three-minute external wait/backoff without treating it as paid replay authority.
- Modify `src/autolist/deep-audit-rules.ts`: audit partial paid-image ledger counts.
- Modify `src/cli/audit-auto-listing.ts`: load the current batch/product ledger even when the run task failed.
- Modify `docs/auto-listing/steps/03-main-image-generation.md`: state the separate 3-minute operational threshold and 30-minute paid-task ceiling without contradiction.
- Modify `docs/auto-listing/stability-checklist.md`: align operator expectations with the executable timing rules.
- Modify `input/image-generation.config.videos-base64.example.json`: publish the 30-minute `maxPollMs` and `acceptedQueueStaleMs` contract.
- Modify `scripts/test-image-provider-videos-base64-rule.mjs`: unit and source-contract regressions for timing, final query, and prompt identity.
- Modify `scripts/test-progress-state.mjs`: supervisor and status regressions.
- Modify `scripts/test-deep-auto-listing-audit.mjs`: partial-ledger audit regressions.

### Task 1: Separate Operational Waiting From Paid-Task Observation

**Files:**
- Modify: `src/autolist/image-generation-rules.ts:1-38,224-292`
- Modify: `scripts/test-image-provider-videos-base64-rule.mjs:1-145,300-330`

- [ ] **Step 1: Write failing timing and timeout-classification tests**

Add `resolveVideosBase64AcceptedTaskPollCeilingMs` to the test import and add these assertions before the existing provider-timeout tests:

```js
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(undefined), 30 * 60 * 1000);
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(3 * 60 * 1000), 30 * 60 * 1000);
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(60 * 60 * 1000), 30 * 60 * 1000);

assert.deepEqual(
  resolvePaidImageFixedSlotRecovery({
    failureReason: "videos-base64 accepted task stayed queued/pending beyond 1800000ms; retrying fixed slot 11.",
    audit: [{
      state: "failed_after_acceptance",
      at: "2026-07-14T06:40:00.000Z",
      reason: "videos-base64 accepted task stayed queued/pending beyond 1800000ms; retrying fixed slot 11."
    }],
    recordedPromptDigest: "policy-digest",
    policyCompatiblePromptDigest: "policy-digest",
    nowMs: Date.parse("2026-07-14T06:44:00.000Z")
  }),
  { action: "retry_fixed_slot_now", usePolicyCompatiblePrompt: true, deferMs: 0 }
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node scripts/test-image-provider-videos-base64-rule.mjs
```

Expected: the build fails because `resolveVideosBase64AcceptedTaskPollCeilingMs` is not exported, or the stale-queue assertion returns `bubble`.

- [ ] **Step 3: Implement separate timing constants and one timeout predicate**

In `src/autolist/image-generation-rules.ts`, keep `imageServiceWaitCeilingMs` as the three-minute external-service retry delay and add:

```ts
export const videosBase64AcceptedTaskPollCeilingMs = 30 * 60 * 1000;

export function resolveVideosBase64AcceptedTaskPollCeilingMs(configuredMaxPollMs: number | undefined): number {
  const configured = Number.isFinite(configuredMaxPollMs || NaN)
    ? Number(configuredMaxPollMs)
    : videosBase64AcceptedTaskPollCeilingMs;
  return Math.min(videosBase64AcceptedTaskPollCeilingMs, Math.max(videosBase64AcceptedTaskPollCeilingMs, configured));
}

export function isAcceptedPaidImageTaskTimeoutReason(reason: string): boolean {
  return /task_timeout|timeout|timed out|did not finish within|queued\/pending beyond|超时/i.test(reason);
}
```

Use `isAcceptedPaidImageTaskTimeoutReason` in both `resolvePaidImageProviderTimeoutRetry` and `resolvePaidImageFixedSlotRecovery`. Preserve the unsafe replay guard, but remove the additional requirement that the reason contain `provider task failed`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run build && node scripts/test-image-provider-videos-base64-rule.mjs
```

Expected: `videos-base64 image provider rules passed`.

- [ ] **Step 5: Commit the rule change**

```bash
git add src/autolist/image-generation-rules.ts scripts/test-image-provider-videos-base64-rule.mjs
git commit -m "fix: separate paid image polling ceiling"
```

### Task 2: Query Persisted Tasks Before Stale Replay

**Files:**
- Modify: `src/autolist/main-image-assets.ts:42-60,772-782,1148-1501`
- Modify: `scripts/test-image-provider-videos-base64-rule.mjs:175-250`
- Modify: `scripts/test-paid-image-submission-ledger.mjs:597-666`

- [ ] **Step 1: Write failing source-contract and ledger-identity tests**

Add source assertions that enforce this order inside `generateVideosBase64ImageAttempt`:

```js
assert.match(
  source,
  /slotAction\.action === "poll"[\s\S]*taskId = slotAction\.providerTaskId[\s\S]*fetchVideosBase64TaskWithTransportRetries[\s\S]*recordPaidImageFailedAfterAcceptance/s,
  "A persisted accepted task must be queried before it can become failed_after_acceptance"
);
assert.doesNotMatch(
  source,
  /slotAction\.action === "poll"[\s\S]*expireSubmittedPaidImageQueue[\s\S]*fetchVideosBase64TaskWithTransportRetries/s,
  "Age alone must not expire an accepted task before a final provider query"
);
assert.match(
  source,
  /isAcceptedPaidImageTaskTimeoutReason[\s\S]*shouldKeepPaidImagePolicyCompatiblePrompt[\s\S]*reservePaidImageSlot/s,
  "All timeout recovery paths must select the persisted prompt variant before reserving the fixed slot"
);
```

Extend the ledger test with a slot whose failed audit retains a compatibility digest, then reserve it with the same request and prompt digests and assert `action === "submit"`; repeat with a different original digest and assert `slot identity conflict`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm run build && node scripts/test-image-provider-videos-base64-rule.mjs && node scripts/test-paid-image-submission-ledger.mjs
```

Expected: the source-order test fails because the current code calls `expireSubmittedPaidImageQueue` before querying the provider.

- [ ] **Step 3: Implement status-first observation and final query**

Import `resolveVideosBase64AcceptedTaskPollCeilingMs` and `isAcceptedPaidImageTaskTimeoutReason`. Remove the pre-query `expireSubmittedPaidImageQueue` block. For `slotAction.action === "poll"`, retain the persisted task ID and provider response, then enter the normal polling loop immediately.

Calculate the observation start from the latest `submitted` audit entry so restarts do not reset the 30-minute budget:

```ts
const submittedTimes = (slotAction.action === "poll" ? slotAction.record.audit : [])
  .filter((entry) => entry.state === "submitted")
  .map((entry) => Date.parse(entry.at || ""))
  .filter(Number.isFinite);
const submittedAtMs = submittedTimes.length > 0 ? Math.max(...submittedTimes) : Date.now();
```

Use a `queryProviderStatus` helper that performs the existing retried fetch, writes the status response artifact, parses JSON, and emits progress. Query immediately for resumed tasks. For newly submitted tasks, sleep once before the first status query.

After each provider query:

```ts
if (videosBase64Succeeded(statusPayload) || videosBase64Failed(statusPayload)) {
  break;
}
if (Date.now() - submittedAtMs >= maxPollMs) {
  recordPaidImageFailedAfterAcceptance({
    productDir: videosBase64Ledger.productDir,
    slot: ledgerSlot,
    reason: `videos-base64 accepted task stayed queued/pending beyond ${maxPollMs}ms; retrying fixed slot ${ledgerSlot}.`,
    providerResponse: statusPayload
  });
  throw normalizeImageGenerationError(
    `videos-base64 accepted task ${taskId} stayed queued/pending beyond ${maxPollMs}ms.`
  );
}
```

Set `maxPollMs` with `resolveVideosBase64AcceptedTaskPollCeilingMs(config.maxPollMs)`. In the retry loop, compute the authoritative prompt variant before `reservePaidImageSlot`: keep the compatibility prompt whenever the persisted digest already equals the compatibility digest or the unified timeout recovery decision requests it. Allow a digest change only when moving from the original digest to the compatibility digest.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npm run build && node scripts/test-image-provider-videos-base64-rule.mjs && node scripts/test-paid-image-submission-ledger.mjs
```

Expected: both scripts pass, and the source-order assertion proves provider query precedes stale transition.

- [ ] **Step 5: Commit status-first recovery**

```bash
git add src/autolist/main-image-assets.ts scripts/test-image-provider-videos-base64-rule.mjs scripts/test-paid-image-submission-ledger.mjs
git commit -m "fix: query paid image tasks before replay"
```

### Task 3: Align Supervisor Timing And User-Visible Status

**Files:**
- Modify: `src/cli/auto-listing-supervisor.ts:62,284-342`
- Modify: `src/autolist/batch-continuation-rules.ts:340-370,1300-1340`
- Modify: `src/cli/auto-listing-controller.ts:1258-1285,1656-1685,1980-2015`
- Modify: `scripts/test-progress-state.mjs:2091-2105,3830-3920,2280-2340`

- [ ] **Step 1: Write failing supervisor and status tests**

Update the poll ceiling assertion to 30 minutes and add:

```js
assert.equal(resolveVideosBase64AcceptedTaskPollCeilingMs(180000), 1800000);
assert.equal(
  resolveEffectiveChildStallTimeoutMs({
    configuredStallTimeoutMs: 12 * 60 * 1000,
    activeStep: "main_images_generated",
    activeMessage: "Prompt 5/5: Image 2: videos-base64 task task_abc status queued 0."
  }),
  30 * 60 * 1000
);
```

Add a controller fixture with `completed: 17`, `submitted: 3`, and active provider wait. Assert its text contains `主图 17/20` and `等待生图服务`, and that the retry decision does not increment the generic recovery counter.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node scripts/test-progress-state.mjs
```

Expected: the timeout assertion reports the existing 3- or 12-minute value instead of 30 minutes.

- [ ] **Step 3: Implement accepted-task-aware supervisor timeout**

Export a pure `resolveEffectiveChildStallTimeoutMs` from `auto-listing-supervisor.ts`. When the active step is `main_images_generated` and the message contains a persisted `videos-base64 task ... status queued|pending`, return at least `videosBase64AcceptedTaskPollCeilingMs`; otherwise return the configured stall timeout. Use it in the watchdog comparison.

Keep `imageServiceWaitCeilingMs` at three minutes in `batch-continuation-rules.ts` for the delay between external-service retries. Remove any condition that interprets that delay as permission to expire or resubmit a paid task.

In the controller text formatter, render ledger `completed/expectedSlotCount` and show `等待生图服务` whenever `submitted > 0` or the supervisor classified the child as an external image wait. Do not use the ordinal of the actively polled slot as completed progress.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run build && node scripts/test-progress-state.mjs
```

Expected: `progress state rules passed`.

- [ ] **Step 5: Commit supervisor and status changes**

```bash
git add src/cli/auto-listing-supervisor.ts src/autolist/batch-continuation-rules.ts src/cli/auto-listing-controller.ts scripts/test-progress-state.mjs
git commit -m "fix: protect accepted image task observation"
```

### Task 4: Make Partial Paid Images Fail The Deep Audit Truthfully

**Files:**
- Modify: `src/autolist/deep-audit-rules.ts:1-215`
- Modify: `src/cli/audit-auto-listing.ts:1-300`
- Modify: `scripts/test-deep-auto-listing-audit.mjs:1-145`

- [ ] **Step 1: Write a failing pure audit test**

Import and test a new `auditPaidImageLedgerArtifacts` rule:

```js
const partialPaidImages = auditPaidImageLedgerArtifacts({
  expectedSlotCount: 20,
  completed: 17,
  missing: 0,
  reserved: 0,
  submitted: 0,
  failedBeforeAcceptance: 0,
  failedAfterAcceptance: 3,
  ambiguous: 0
});
assert.equal(partialPaidImages.ok, false);
assert.deepEqual(partialPaidImages.errors.map((item) => item.code), ["paid_image_slots_incomplete"]);
assert.deepEqual(partialPaidImages.evidence, [
  "expected=20",
  "completed=17",
  "missing=0",
  "reserved=0",
  "submitted=0",
  "failedBeforeAcceptance=0",
  "failedAfterAcceptance=3",
  "ambiguous=0"
]);
```

Add a source assertion proving `audit-auto-listing.ts` calls `summarizePaidImageProductLedger` for the exact current batch and record even when `runStatus === "failed"`.

- [ ] **Step 2: Run the audit test and verify RED**

Run:

```bash
npm run build && node scripts/test-deep-auto-listing-audit.mjs
```

Expected: the build fails because `auditPaidImageLedgerArtifacts` does not exist.

- [ ] **Step 3: Implement ledger-backed artifact audit**

Add this pure rule to `deep-audit-rules.ts`:

```ts
export function auditPaidImageLedgerArtifacts(input: PaidImageLedgerFailureSummary): DeepAuditDimensionInput {
  const incomplete = input.expectedSlotCount - input.completed;
  return {
    errors: incomplete > 0
      ? [{ code: "paid_image_slots_incomplete", message: `Paid image ledger is incomplete: ${input.completed}/${input.expectedSlotCount}.`, count: incomplete }]
      : [],
    warnings: [],
    evidence: [
      `expected=${input.expectedSlotCount}`,
      `completed=${input.completed}`,
      `missing=${input.missing}`,
      `reserved=${input.reserved}`,
      `submitted=${input.submitted}`,
      `failedBeforeAcceptance=${input.failedBeforeAcceptance}`,
      `failedAfterAcceptance=${input.failedAfterAcceptance}`,
      `ambiguous=${input.ambiguous}`
    ]
  };
}
```

In `audit-auto-listing.ts`, resolve each pending current Feishu record through `paidImageProductLedgerDir`, call `summarizePaidImageProductLedger` when its ledger exists, and merge `auditPaidImageLedgerArtifacts` into the deep-audit artifact dimension. Also expose the current ledger summary in top-level `generation.summary` so the incident reports `expectedImageCount: 20` and `generatedImageCount: 17` rather than zero and zero.

- [ ] **Step 4: Run focused and real read-only audits**

Run:

```bash
npm run build && node scripts/test-deep-auto-listing-audit.mjs
npm run audit:auto-listing -- --json
```

Expected: the test passes; the real audit remains `ok: false`, reports 20 expected and 17 completed paid images, and includes `paid_image_slots_incomplete` rather than a misleading generation pass.

- [ ] **Step 5: Commit audit truthfulness**

```bash
git add src/autolist/deep-audit-rules.ts src/cli/audit-auto-listing.ts scripts/test-deep-auto-listing-audit.mjs
git commit -m "fix: audit partial paid image ledgers"
```

### Task 5: Align Rules, Examples, And Contradiction Checks

**Files:**
- Modify: `docs/auto-listing/steps/03-main-image-generation.md:110-145`
- Modify: `docs/auto-listing/stability-checklist.md`
- Modify: `input/image-generation.config.videos-base64.example.json:1-15`
- Modify: `scripts/test-image-provider-videos-base64-rule.mjs:33-43,275-310`
- Modify: `scripts/test-deep-auto-listing-audit.mjs:130-145`

- [ ] **Step 1: Write failing documentation/config contract tests**

Change the example assertion to:

```js
assert.equal(example.maxPollMs, 30 * 60 * 1000);
assert.equal(example.acceptedQueueStaleMs, 30 * 60 * 1000);
assert.match(ruleDoc, /3\s*分钟.*外部服务等待[\s\S]*不得.*重新提交/s);
assert.match(ruleDoc, /30\s*分钟.*已受理.*任务.*观察上限/s);
assert.match(stabilityChecklist, /30\s*分钟.*最终状态查询/s);
```

Extend contradiction coverage so a rule source that says three minutes is the paid-task ceiling fails, while a source containing both “3 分钟外部服务等待” and “30 分钟已受理任务观察上限” passes.

- [ ] **Step 2: Run focused rule tests and verify RED**

Run:

```bash
npm run build && node scripts/test-image-provider-videos-base64-rule.mjs && node scripts/test-deep-auto-listing-audit.mjs
```

Expected: the example remains 180000 and the documentation patterns are absent or contradictory.

- [ ] **Step 3: Update executable examples and rule sources**

Set these tracked example values:

```json
"maxPollMs": 1800000,
"acceptedQueueStaleMs": 1800000
```

Rewrite sections 25.1, 25.2, and 29.2 of the main-image rule so three minutes is only the operational external-wait threshold and 30 minutes is the accepted-task hard ceiling. Require an immediate/final provider query before stale classification and forbid paid replay at the three-minute threshold. Mirror those exact meanings in the stability checklist.

- [ ] **Step 4: Run focused rule tests and verify GREEN**

Run:

```bash
npm run build && node scripts/test-image-provider-videos-base64-rule.mjs && node scripts/test-deep-auto-listing-audit.mjs
```

Expected: both scripts pass and contradiction evidence contains both timing concepts.

- [ ] **Step 5: Commit rule alignment**

```bash
git add docs/auto-listing/steps/03-main-image-generation.md docs/auto-listing/stability-checklist.md input/image-generation.config.videos-base64.example.json scripts/test-image-provider-videos-base64-rule.mjs scripts/test-deep-auto-listing-audit.mjs
git commit -m "docs: align paid image observation rules"
```

### Task 6: Verify, Inspect The Recovery Plan, And Continue The Locked Batch

**Files:**
- Inspect only: `data/auto-listing/paid-image-submissions/33df3ab3e3e2a2a9fe6a5d2d-3d51997f88d4/recvpkd8PT1R7z-d2653150224d/`
- Local untracked config: `input/image-generation.config.json`
- Runtime outputs: `data/auto-listing/runs/`, `data/auto-listing/control/`

- [ ] **Step 1: Run all fresh static and simulation gates**

```bash
npm run build
npm run rules:check
npm run doctor
npm run doctor:feishu
npm run doctor:auto-listing
npm run doctor:all
npm run simulate:representative
```

Expected: every command exits zero.

- [ ] **Step 2: Update only the local secret-bearing runtime config**

Change `input/image-generation.config.json` without staging it:

```json
"maxPollMs": 1800000,
"acceptedQueueStaleMs": 1800000
```

Run `git status --short` and verify this ignored file is absent from tracked changes.

- [ ] **Step 3: Perform read-only external checks**

Run `npm run doctor:feishu` and the project’s Doudian login/DOM preflight through `npm run doctor:all`. Query the persisted provider task IDs for slots 11, 17, and 18 without changing ledger state; verify their returned status and retain only sanitized status/error evidence.

- [ ] **Step 4: Prove the exact recovery scope before real side effects**

Run:

```bash
npm run auto-listing:hermes-status
npm run audit:auto-listing -- --json
```

Inspect the ledger and require: expected 20, completed 17, failed-after-acceptance 3, ambiguous 0, reserved 0. Abort continuation if the plan would submit any slot outside 11, 17, and 18.

- [ ] **Step 5: Continue the locked batch**

```bash
npm run auto-listing:hermes-continue
```

Expected: the command preserves batch fingerprint `33df3ab3e3e2a2a9fe6a5d2d`, reuses 17 completed slots, and processes only fixed slots 11, 17, and 18 before proceeding to titles and publishing. Do not use `hermes-start`.

- [ ] **Step 6: Monitor to a terminal state**

Poll with:

```bash
npm run auto-listing:hermes-status
```

Expected during generation: truthful `主图 17/20` or higher plus provider-wait status. Expected terminal state: `completed`, or a precise external/provider failure that preserves the same batch and paid ledger without identity conflicts.

- [ ] **Step 7: Run delivery gates and two independent audits**

```bash
npm run build
npm run rules:check
npm run doctor:all
npm run simulate:representative
npm run audit:auto-listing -- --json
npm run audit:auto-listing -- --json
rg -n "media-generate|images/edits|coordinate|elementFromPoint|mouse\.click|touchscreen" src scripts docs input --glob '!input/image-generation.config.json'
git status --short
```

Expected: all static gates pass; the completed real batch audit is `ok: true`; obsolete-provider and coordinate-click searches contain no active prohibited implementation; no secrets, runtime data, generated images, cookies, or browser profiles are staged.

- [ ] **Step 8: Commit any final verified adjustments and push**

```bash
git add src scripts docs input/image-generation.config.videos-base64.example.json
git commit -m "fix: harden paid image status recovery"
git push origin master
```

If earlier task commits already contain every tracked change, skip the empty commit and push the verified commit series. Report the final controller status, 20-slot ledger outcome, audit outcome, commit hashes, and pushed branch.
