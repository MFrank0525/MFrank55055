# Exactly-Once Paid Image Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep 20 concurrent `videos-base64` submissions while preventing any image slot from being automatically submitted more than once across crashes, supervisor recovery, and new runtime directories.

**Architecture:** Add a focused persistent-ledger module that owns stable slot identity, atomic reservation, state transitions, validation, and result reuse. Pass the Feishu batch fingerprint and record ID explicitly from the orchestrator into image generation, then make the `videos-base64` provider path consult the ledger before every paid submission and report ledger state through existing progress events. Ambiguous or stale reservations fail closed and are classified as a safety pause rather than a retryable provider outage.

**Tech Stack:** TypeScript, Node.js filesystem APIs, SHA-256 digests, existing `scripts/*.mjs` rule tests, existing auto-listing orchestration and Hermes supervisor.

---

## File Structure

- Create `src/autolist/paid-image-submission-ledger.ts`: stable identity, ledger paths, atomic slot reservation, validation, transitions, result persistence, and summaries.
- Create `scripts/test-paid-image-submission-ledger.mjs`: behavioral regression tests for reservation races, transitions, hard limits, conflicts, and batch isolation.
- Modify `src/autolist/types.ts`: configure and resolve the shared ledger root.
- Modify `src/autolist/config.ts`: default the ledger root to `data/auto-listing/paid-image-submissions`.
- Modify `src/autolist/orchestrator.ts`: pass batch fingerprint, record ID, and ledger root into main-image generation.
- Modify `src/autolist/jimeng-assets.ts`: integrate the ledger into `videos-base64`, retain 20 concurrency, use all-settled coordination, and reuse shared results.
- Modify `src/autolist/batch-continuation-rules.ts`: classify ambiguous/stale reservations as non-retryable paid-submission safety blocks.
- Modify `src/cli/hermes-auto-listing-runner.ts`: surface paid-ledger counts and safety-block status.
- Modify `src/autolist/cleanup.ts`: explicitly protect the shared ledger from cleanup targeting.
- Modify `src/autolist/orchestrator.ts`: pass the configured ledger root into cleanup protection.
- Modify `docs/auto-listing/steps/03-main-image-generation.md`: make the exactly-once ledger the business rule source.
- Modify `scripts/test-image-provider-videos-base64-rule.mjs`: enforce integration and continued 20-way concurrency.
- Modify `scripts/test-progress-state.mjs`: enforce supervisor and Hermes status behavior.
- Modify `scripts/test-maintenance-residue-rule.mjs`: enforce cleanup retention.
- Modify `package.json`: include the new ledger test in `rules:check`.

### Task 1: Build The Persistent Ledger State Machine

**Files:**
- Create: `src/autolist/paid-image-submission-ledger.ts`
- Create: `scripts/test-paid-image-submission-ledger.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for stable identity and product-ledger validation**

In `scripts/test-paid-image-submission-ledger.mjs`, import the compiled ledger module and create temporary ledger roots. Test that:

```js
const identity = {
  batchFingerprint: "batch-a",
  recordId: "record-a",
  expectedSlotCount: 20,
  providerIdentity: "https://provider.example/v1/videos|model-a",
  sourceImageDigest: "source-a"
};

const initialized = initializePaidImageProductLedger({ rootDir, ...identity });
assert.equal(initialized.expectedSlotCount, 20);
assert.throws(
  () => initializePaidImageProductLedger({ rootDir, ...identity, sourceImageDigest: "source-conflict" }),
  /ledger identity conflict/i
);
assert.notEqual(
  paidImageProductLedgerDir(rootDir, "batch-a", "record-a"),
  paidImageProductLedgerDir(rootDir, "batch-b", "record-a")
);
```

- [ ] **Step 2: Write failing tests for atomic reservation, transitions, and hard limit**

Add tests proving:

```js
const first = reservePaidImageSlot({ productDir, slot: 1, requestDigest: "request-1", promptDigest: "prompt-1", owner: ownerA });
assert.equal(first.action, "submit");

const second = reservePaidImageSlot({ productDir, slot: 1, requestDigest: "request-1", promptDigest: "prompt-1", owner: ownerB });
assert.equal(second.action, "blocked_reserved");

recordPaidImageSubmitted({ productDir, slot: 1, providerTaskId: "task-1", providerResponse: { id: "task-1" } });
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 1 }).action, "poll");

recordPaidImageCompleted({ productDir, slot: 1, sourceFile: resultFile });
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 1 }).action, "reuse");

assert.throws(() => reservePaidImageSlot({ productDir, slot: 21, requestDigest: "x", promptDigest: "x", owner: ownerA }), /outside expected range/i);
```

Also test that `recordPaidImageAmbiguous` permanently blocks automatic submission and only `failed_before_acceptance` may transition back through a new atomic reservation.

- [ ] **Step 3: Run the new test and verify RED**

Run:

```bash
npm run build
node scripts/test-paid-image-submission-ledger.mjs
```

Expected: FAIL because `src/autolist/paid-image-submission-ledger.ts` and its exports do not exist.

- [ ] **Step 4: Implement the minimal ledger module**

Implement these exported types and functions in `src/autolist/paid-image-submission-ledger.ts`:

```ts
export type PaidImageSlotState =
  | "reserved"
  | "submitted"
  | "completed"
  | "failed_before_acceptance"
  | "ambiguous";

export function paidImageProductLedgerDir(rootDir: string, batchFingerprint: string, recordId: string): string;
export function initializePaidImageProductLedger(input: InitializePaidImageProductLedgerInput): PaidImageProductLedger;
export function reservePaidImageSlot(input: ReservePaidImageSlotInput): PaidImageSlotAction;
export function resolvePaidImageSlotAction(input: ResolvePaidImageSlotActionInput): PaidImageSlotAction;
export function recordPaidImageSubmitted(input: RecordPaidImageSubmittedInput): PaidImageSlotRecord;
export function recordPaidImageCompleted(input: RecordPaidImageCompletedInput): PaidImageSlotRecord;
export function recordPaidImageAmbiguous(input: RecordPaidImageAmbiguousInput): PaidImageSlotRecord;
export function recordPaidImageFailedBeforeAcceptance(input: RecordPaidImageFailedBeforeAcceptanceInput): PaidImageSlotRecord;
export function summarizePaidImageProductLedger(productDir: string): PaidImageLedgerSummary;
export function sha256File(file: string): string;
export function sha256Text(text: string): string;
```

Implementation requirements:

- sanitize path segments;
- write JSON through temporary file plus rename;
- reserve missing slots with `fs.openSync(slotFile, "wx")`;
- validate every existing product and slot record before use;
- copy completed results into `<productDir>/results/<slot>.png` before marking `completed`;
- never store secrets, authorization headers, or Base64 payloads;
- never delete or silently reset a slot.

- [ ] **Step 5: Add the test to `rules:check` and verify GREEN**

Add `node scripts/test-paid-image-submission-ledger.mjs` to `package.json` `rules:check`.

Run:

```bash
npm run build
node scripts/test-paid-image-submission-ledger.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/autolist/paid-image-submission-ledger.ts scripts/test-paid-image-submission-ledger.mjs package.json
git commit -m "Add persistent paid image submission ledger"
```

### Task 2: Pass Stable Batch And Product Identity Into Image Generation

**Files:**
- Modify: `src/autolist/types.ts`
- Modify: `src/autolist/config.ts`
- Modify: `src/autolist/orchestrator.ts`
- Modify: `src/autolist/jimeng-assets.ts`
- Modify: `scripts/test-image-provider-videos-base64-rule.mjs`

- [ ] **Step 1: Write failing integration assertions**

Extend `scripts/test-image-provider-videos-base64-rule.mjs` to require:

```js
assert.match(orchestratorSource, /feishuBatchFingerprint:\s*state\.feishuBatchFingerprint/);
assert.match(orchestratorSource, /paidImageSubmissionLedgerDir/);
assert.match(source, /feishuBatchFingerprint\?: string/);
assert.match(source, /paidImageSubmissionLedgerDir\?: string/);
assert.match(source, /initializePaidImageProductLedger/);
```

Also assert that real `videos-base64` generation rejects missing `feishuBatchFingerprint`, `feishuRecordId`, or ledger root before provider submission.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build
node scripts/test-image-provider-videos-base64-rule.mjs
```

Expected: FAIL because stable ledger identity is not passed into main-image generation.

- [ ] **Step 3: Add the resolved ledger-root configuration**

Add `paidImageSubmissionLedgerDir?: string` to `AutoListingJobInput`, and its required resolved form to `AutoListingResolvedJob`.

In `withDefaults`, resolve:

```ts
paidImageSubmissionLedgerDir: path.resolve(
  input.paidImageSubmissionLedgerDir || path.join(process.cwd(), "data", "auto-listing", "paid-image-submissions")
)
```

Create the ledger root in `resolveAutoListingJob`.

- [ ] **Step 4: Pass identity through the orchestrator**

Extend `generateMainImageAssets` options with:

```ts
feishuBatchFingerprint?: string;
paidImageSubmissionLedgerDir?: string;
```

In `orchestrator.ts`, pass:

```ts
feishuBatchFingerprint: state.feishuBatchFingerprint,
feishuRecordId: current.feishuProductRecord?.recordId,
paidImageSubmissionLedgerDir: input.paidImageSubmissionLedgerDir
```

Before any real `videos-base64` submission, fail closed when any required identity field is missing.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm run build
node scripts/test-image-provider-videos-base64-rule.mjs
node scripts/test-paid-image-submission-ledger.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/autolist/types.ts src/autolist/config.ts src/autolist/orchestrator.ts src/autolist/jimeng-assets.ts scripts/test-image-provider-videos-base64-rule.mjs
git commit -m "Pass stable identity to paid image generation"
```

### Task 3: Enforce Exactly-Once Submission While Keeping 20 Concurrency

**Files:**
- Modify: `src/autolist/jimeng-assets.ts`
- Modify: `src/autolist/paid-image-submission-ledger.ts`
- Modify: `scripts/test-paid-image-submission-ledger.mjs`
- Modify: `scripts/test-image-provider-videos-base64-rule.mjs`

- [ ] **Step 1: Write failing tests for provider action resolution**

Add ledger tests for this action table:

```text
missing                  -> reserve and submit
reserved                 -> block
submitted + task ID      -> poll
completed + valid result -> reuse
ambiguous                -> block
failed_before_acceptance -> reserve and submit
```

Add source assertions requiring `Promise.allSettled` for both slot workers and prompt rounds, while retaining creation of all 20 workers before awaiting results.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run build
node scripts/test-paid-image-submission-ledger.mjs
node scripts/test-image-provider-videos-base64-rule.mjs
```

Expected: FAIL because `videos-base64` still reads only runtime-local response files and uses `Promise.all`.

- [ ] **Step 3: Integrate the ledger at the paid-submit boundary**

In the `videos-base64` path:

1. Initialize the product ledger once using batch fingerprint, record ID, expected total slot count, provider/model identity, and source-image digest.
2. Compute stable absolute slot numbers `01` through `20`.
3. Before `sendRequest`, call `reservePaidImageSlot`.
4. For `submit`, send one provider request and immediately persist `submitted` when the response contains a task ID.
5. For `poll`, use the stored provider task ID.
6. For `reuse`, copy the ledger result into the current runtime raw directory.
7. For `blocked_reserved` or `blocked_ambiguous`, throw a paid-submission safety-block error.
8. Persist `completed` before watermarking or staging.

The provider body and progress messages remain slot-specific.

- [ ] **Step 4: Mark uncertain submits ambiguous and explicit rejections retryable**

Wrap only the initial paid submit:

```ts
try {
  const response = await sendRequest(...);
  if (!response.ok) {
    if (providerExplicitlyProvesNotAccepted(response.status, text)) {
      recordPaidImageFailedBeforeAcceptance(...);
    } else {
      recordPaidImageAmbiguous(...);
    }
    throw ...;
  }
  recordPaidImageSubmitted(...);
} catch (error) {
  if (slot is still reserved) {
    recordPaidImageAmbiguous(...);
  }
  throw error;
}
```

Treat transport errors, timeouts, malformed success responses, and missing task IDs as ambiguous. Keep the explicit pre-acceptance classification narrow: authentication/authorization, invalid request, unsupported parameter, and provider-declared validation rejection only.

- [ ] **Step 5: Replace early-reject concurrency with all-settled coordination**

Use `Promise.allSettled` for the 20 slot workers and concurrent prompt rounds. After all workers settle:

- return all successful results when every slot completed;
- otherwise throw one aggregate error containing affected slots and states;
- do not let the parent image step exit while paid workers remain unobserved.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm run build
node scripts/test-paid-image-submission-ledger.mjs
node scripts/test-image-provider-videos-base64-rule.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/autolist/jimeng-assets.ts src/autolist/paid-image-submission-ledger.ts scripts/test-paid-image-submission-ledger.mjs scripts/test-image-provider-videos-base64-rule.mjs
git commit -m "Prevent duplicate concurrent paid image submissions"
```

### Task 4: Fail Closed In Supervisor Recovery And Report Ledger Status

**Files:**
- Modify: `src/autolist/batch-continuation-rules.ts`
- Modify: `src/cli/hermes-auto-listing-runner.ts`
- Modify: `scripts/test-progress-state.mjs`

- [ ] **Step 1: Write failing supervisor classification tests**

Add tests proving:

```js
const ambiguous = "failed at main_images_generated: paid image submission safety block: slot=07 state=ambiguous";
assert.equal(isRetryableExternalServiceAvailabilityFailure(ambiguous), false);
assert.equal(shouldResumeFeishuBatchAfterRetryableChildFailure({
  exitCode: 1,
  batchComplete: false,
  retryableFailureMessage: ambiguous,
  recoveryAttempts: 0,
  maxRecoveryAttempts: 12
}), false);
```

Add equivalent coverage for stale `reserved`. Assert Hermes status text contains ledger counts such as `completed=8 submitted=11 ambiguous=1`.

- [ ] **Step 2: Run progress-state tests and verify RED**

Run:

```bash
npm run build
node scripts/test-progress-state.mjs
```

Expected: FAIL because safety-block messages are currently classified by generic main-image retry rules and ledger counts are not reported.

- [ ] **Step 3: Add fail-closed rule-layer classification**

Add:

```ts
export function isPaidImageSubmissionSafetyBlock(message: string): boolean {
  return /paid image submission safety block/i.test(message);
}
```

Check it before generic image-generation retry patterns in:

- `isRetryableExternalServiceAvailabilityFailure`;
- `shouldResumeFeishuBatchAfterRetryableChildFailure`;
- `shouldRecoverFullFlowAfterChildFailure`;
- runtime status selection.

Safety blocks must stop automatic recovery and report a blocked/failed status with a clear reconciliation message.

- [ ] **Step 4: Surface ledger summary in Hermes status**

Use the current run state batch fingerprint and task record ID to locate the shared product ledger. Add a summary object containing:

```ts
{
  expected: 20,
  reserved: number,
  submitted: number,
  completed: number,
  failedBeforeAcceptance: number,
  ambiguous: number
}
```

Include it in JSON status and concise Chinese text output without exposing provider payloads or secrets.

- [ ] **Step 5: Run progress-state tests and verify GREEN**

Run:

```bash
npm run build
node scripts/test-progress-state.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/autolist/batch-continuation-rules.ts src/cli/hermes-auto-listing-runner.ts scripts/test-progress-state.mjs
git commit -m "Block unsafe paid image resubmission recovery"
```

### Task 5: Protect Ledger Retention And Update Business Rules

**Files:**
- Modify: `src/autolist/cleanup.ts`
- Modify: `src/autolist/orchestrator.ts`
- Modify: `docs/auto-listing/steps/03-main-image-generation.md`
- Modify: `docs/auto-listing/stability-checklist.md`
- Modify: `scripts/test-maintenance-residue-rule.mjs`
- Modify: `scripts/test-image-provider-videos-base64-rule.mjs`

- [ ] **Step 1: Write failing retention and rule assertions**

Add tests requiring:

```js
assert.doesNotMatch(cleanupSource, /paid-image-submissions.*rmSync/s);
assert.match(ruleDoc, /20 张并发.*每个图片槽位.*最多一次付费提交/s);
assert.match(ruleDoc, /ambiguous.*禁止自动重提/s);
assert.match(ruleDoc, /共享付费提交账本.*不得由自动清理删除/s);
```

- [ ] **Step 2: Run rule tests and verify RED**

Run:

```bash
npm run build
node scripts/test-maintenance-residue-rule.mjs
node scripts/test-image-provider-videos-base64-rule.mjs
```

Expected: FAIL because the exactly-once and retention rules are not yet documented or asserted.

- [ ] **Step 3: Make retention explicit**

Add `paidImageSubmissionLedgerDir?: string` to cleanup options and pass `input.paidImageSubmissionLedgerDir` from the orchestrator. In cleanup target collection and safety checks, explicitly exclude any path inside the configured shared paid-submission ledger root. The ledger must not be included in automatic runtime cleanup, stale-run cleanup, or maintenance residue cleanup.

- [ ] **Step 4: Update the rule source**

Update step 03 and the stability checklist to state:

- retain 20 concurrent async submissions;
- stable identity is `batchFingerprint + recordId + imageSlot`;
- every slot gets at most one automated paid-submit permission;
- submitted slots only poll;
- completed slots only reuse;
- reserved/ambiguous slots stop automation;
- automatic cleanup never deletes the shared ledger.

- [ ] **Step 5: Run rule tests and verify GREEN**

Run:

```bash
npm run build
node scripts/test-maintenance-residue-rule.mjs
node scripts/test-image-provider-videos-base64-rule.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/autolist/cleanup.ts src/autolist/orchestrator.ts docs/auto-listing/steps/03-main-image-generation.md docs/auto-listing/stability-checklist.md scripts/test-maintenance-residue-rule.mjs scripts/test-image-provider-videos-base64-rule.mjs
git commit -m "Document and retain paid image submission ledger"
```

### Task 6: Verify The Full Workflow

**Files:**
- Modify only if verification reveals a defect in the files already listed above.

- [ ] **Step 1: Run focused exactly-once tests**

Run:

```bash
npm run build
node scripts/test-paid-image-submission-ledger.mjs
node scripts/test-image-provider-videos-base64-rule.mjs
node scripts/test-progress-state.mjs
node scripts/test-maintenance-residue-rule.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run required project verification**

Run:

```bash
npm run build
npm run doctor
npm run rules:check
npm run doctor:feishu
npm run doctor:auto-listing
```

Expected: all commands exit successfully.

- [ ] **Step 3: Run the simulated full flow**

Run:

```bash
npm run business:auto-listing -- --job ./input/auto-listing.job.mac-feishu-flow.json
```

Expected: simulated flow completes without paid provider submissions and without ledger conflicts.

- [ ] **Step 4: Inspect repository state**

Run:

```bash
git status --short
git diff --check
```

Expected: only intended source, test, and documentation changes; no secrets, generated runtime data, or local provider configuration staged.

- [ ] **Step 5: Commit final verification fixes if needed**

If verification required source fixes, stage only the already-listed implementation, test, or documentation files changed by those fixes, then run:

```bash
git commit -m "Verify exactly-once paid image submissions"
```
