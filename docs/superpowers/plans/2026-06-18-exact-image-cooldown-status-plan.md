# Exact Image Cooldown and Status Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the supervisor honor the paid-image slot's exact cooldown and make Hermes status show the remaining wait and retry timestamp without changing any image prompt or paid-ledger behavior.

**Architecture:** Keep cooldown calculation in the existing image action. Add pure rule helpers in `batch-continuation-rules.ts` to parse a bounded `retry after <ms>ms` value and format a deterministic countdown. The supervisor consumes the parsed delay; the controller passes the formatted wait summary to the existing compact status formatter, which prioritizes it only while `external_service_wait` is active.

**Tech Stack:** TypeScript, Node.js ESM, existing script-based rule regression suite.

---

## File Structure

- Modify `src/autolist/batch-continuation-rules.ts`: pure retry-delay parsing, countdown formatting, and compact wait-status precedence.
- Modify `src/cli/auto-listing-controller.ts`: build the active wait summary with a remaining-time countdown.
- Modify `scripts/test-progress-state.mjs`: focused red/green regression coverage for scheduling and status behavior.
- Modify `docs/auto-listing/stability-checklist.md`: add the exact scheduling and visible countdown invariant.

### Task 1: Honor the Exact Slot Cooldown

**Files:**
- Modify: `scripts/test-progress-state.mjs`
- Modify: `src/autolist/batch-continuation-rules.ts:99-108`

- [ ] **Step 1: Write failing scheduling tests**

Add next to the existing `videosBase64ProviderCircuitOpen` assertions:

```js
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: videosBase64ProviderCircuitOpen,
    externalServiceWaitAttempts: 0
  }),
  1740000,
  "The supervisor must honor a valid slot cooldown instead of waking on the generic 10-minute delay"
);
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: "paid image provider timeout circuit open for slot 17; retry after invalidms.",
    externalServiceWaitAttempts: 0
  }),
  600000,
  "Malformed slot cooldown text must fall back to the normal external-service delay"
);
assert.equal(
  resolveSupervisorRecoveryDelayMs({
    failureMessage: "paid image provider timeout circuit open for slot 17; retry after 999999999ms.",
    externalServiceWaitAttempts: 0
  }),
  600000,
  "Out-of-range slot cooldown text must not create an unbounded supervisor sleep"
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node scripts/test-progress-state.mjs
```

Expected: FAIL because the valid circuit returns the generic `600000` delay.

- [ ] **Step 3: Implement bounded exact-delay parsing**

Replace `resolveSupervisorRecoveryDelayMs` with:

```ts
export function resolveSupervisorRecoveryDelayMs(input: {
  failureMessage: string;
  externalServiceWaitAttempts: number;
}): number {
  if (!isRetryableExternalServiceAvailabilityFailure(input.failureMessage)) {
    return 10000;
  }
  const normalDelayMs = Math.min(
    30 * 60 * 1000,
    10 * 60 * 1000 * Math.pow(2, Math.max(0, input.externalServiceWaitAttempts))
  );
  const retryMatch = /paid image provider timeout circuit open[\s\S]*?retry after\s+(\d+)ms/i.exec(
    input.failureMessage
  );
  const slotDelayMs = retryMatch ? Number(retryMatch[1]) : Number.NaN;
  const validSlotDelay = slotDelayMs >= 1000 && slotDelayMs <= 6 * 60 * 60 * 1000;
  return validSlotDelay ? Math.max(normalDelayMs, slotDelayMs) : normalDelayMs;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run build && node scripts/test-progress-state.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the scheduling rule**

```bash
git add src/autolist/batch-continuation-rules.ts scripts/test-progress-state.mjs
git commit -m "Honor paid image slot cooldown deadlines"
```

### Task 2: Show the Active Countdown Instead of Stale Progress

**Files:**
- Modify: `scripts/test-progress-state.mjs`
- Modify: `src/autolist/batch-continuation-rules.ts:764-783,1208-1255`
- Modify: `src/cli/auto-listing-controller.ts:1-45,1210-1285`

- [ ] **Step 1: Write failing countdown and precedence tests**

Import `formatAutoListingControllerExternalServiceWaitSummary` from the compiled rule module, then add:

```js
const externalWaitSummary = formatAutoListingControllerExternalServiceWaitSummary({
  retryAt: "2026-06-18T06:30:00.000Z",
  nowMs: Date.parse("2026-06-18T06:10:29.000Z"),
  reason: "paid image provider timeout circuit open for slot 17; retry after 1171000ms."
});
assert.match(externalWaitSummary, /19分31秒后/);
assert.match(externalWaitSummary, /2026-06-18T06:30:00.000Z/);
assert.match(externalWaitSummary, /槽位 17/);

const compactExternalWait = formatAutoListingControllerCompactStatusText({
  status: "external_service_wait",
  summary: externalWaitSummary,
  productName: "李时珍膝盖部位凝胶",
  imageGenerationProgress: "Prompt 4/5: staged 4 image(s).",
  mainImageCompleted: 19,
  feishuCompleted: 5,
  feishuTotal: 7
});
assert.match(compactExternalWait, /19分31秒后/);
assert.doesNotMatch(compactExternalWait, /staged 4 image/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node scripts/test-progress-state.mjs
```

Expected: FAIL because the countdown helper is not exported and compact status still prefers stale image progress.

- [ ] **Step 3: Implement the pure countdown formatter**

Add to `batch-continuation-rules.ts`:

```ts
export function formatAutoListingControllerExternalServiceWaitSummary(input: {
  retryAt?: string;
  nowMs: number;
  reason?: string;
}): string {
  const retryAtMs = Date.parse(input.retryAt || "");
  const remainingSeconds = Number.isFinite(retryAtMs)
    ? Math.max(0, Math.ceil((retryAtMs - input.nowMs) / 1000))
    : undefined;
  const countdown =
    remainingSeconds === undefined
      ? "供应商恢复后"
      : `${Math.floor(remainingSeconds / 60)}分${remainingSeconds % 60}秒后`;
  const slot = /timeout circuit open for slot\s+(\d+)/i.exec(input.reason || "")?.[1];
  const slotText = slot ? `槽位 ${slot}；` : "";
  return `图片服务冷却中：${slotText}${countdown}（${input.retryAt || "时间待定"}）自动重试。`;
}
```

- [ ] **Step 4: Prioritize the wait summary in compact status**

In `formatAutoListingControllerCompactStatusText`, select progress with:

```ts
  const latestProgress =
    input.status === "external_service_wait"
      ? input.summary
      : preferPublishProgress
        ? input.latestProgress
        : input.imageGenerationProgress || input.latestProgress;
```

This keeps the existing first line, product line, and `mainImageCompleted` ledger count unchanged.

- [ ] **Step 5: Wire the controller to the pure formatter**

Import `formatAutoListingControllerExternalServiceWaitSummary` in `auto-listing-controller.ts` and replace the external-wait summary expression with:

```ts
      (resolvedStatus === "external_service_wait"
        ? formatAutoListingControllerExternalServiceWaitSummary({
            retryAt: activeWaitState?.retryAt,
            nowMs: Date.now(),
            reason: externalWaitReason
          })
```

Remove the now-unused `externalRetryAt` local.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
npm run build && node scripts/test-progress-state.mjs
```

Expected: PASS, including existing failed-status and publish-progress formatting assertions.

- [ ] **Step 7: Commit countdown status behavior**

```bash
git add src/autolist/batch-continuation-rules.ts src/cli/auto-listing-controller.ts scripts/test-progress-state.mjs
git commit -m "Show exact image cooldown countdown"
```

### Task 3: Rule Documentation and Full Verification

**Files:**
- Modify: `docs/auto-listing/stability-checklist.md:237-245`

- [ ] **Step 1: Add the rule-layer invariant**

Append after external-service wait rule 40:

```md
40.1 图片固定槽熔断错误已携带有效 `retry after <ms>ms` 时，supervisor 必须按该槽位期限与通用外部服务退避两者中的较长时间调度，禁止在槽位冷却到期前固定每 10 分钟空唤醒。等待状态必须优先展示剩余倒计时、准确重试时间和固定槽位，禁止继续展示终态前的旧生图进度。此规则只调整调度和状态展示，不得修改提示词、requestDigest、promptDigest 或付费槽位重试资格。
```

- [ ] **Step 2: Run full rule and doctor verification**

Run:

```bash
npm run rules:check
npm run doctor
npm run doctor:feishu
npm run doctor:auto-listing
```

Expected: all commands exit 0.

- [ ] **Step 3: Run deep audit pass 1**

Run `npm run audit:auto-listing`, then independently read all current product slot JSON files and verify:

- exactly 20 slots;
- every completed `resultFile` exists and matches `resultDigest` by SHA-256;
- no `reserved` or `ambiguous` state;
- no duplicate active provider task ID.

Expected: project audit passes and ledger invariants hold.

- [ ] **Step 4: Run deep audit pass 2**

Re-run:

```bash
npm run build
node scripts/test-progress-state.mjs
npm run audit:auto-listing
git diff --check
git status --short
```

Re-read the slot files from disk and repeat the digest/state/task-ID checks. Expected: the same safe result with no audit-induced mutation.

- [ ] **Step 5: Commit documentation and verification boundary**

```bash
git add docs/auto-listing/stability-checklist.md
git commit -m "Document exact paid image cooldown scheduling"
```

- [ ] **Step 6: Push without interrupting active publishing**

Run:

```bash
git status --short
git push origin master
npm run auto-listing:hermes-status
```

Expected: only intended commits are pushed; the active supervisor is not restarted; status continues from the existing publishing flow.
