# Shop Switch Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Doudian publishing from stopping when the target shop is already active but the switch menu entry is temporarily unavailable.

**Architecture:** Put shop switch state classification in `publish-rules.ts`; keep Playwright reads/clicks in `publish-from-spu.ts`.

**Tech Stack:** TypeScript, Playwright, existing script regression tests.

---

### Task 1: Add Regression Tests

**Files:**
- Modify: `scripts/test-progress-state.mjs`

- [ ] Add a failing test for `evaluateShopSwitchMenuState` where current shop equals expected shop and switch entry is hidden.
- [ ] Add a failing test for classifying `Shop switch failed: could not find 切换组织/店铺...` as retryable.
- [ ] Run `npm run build && node scripts/test-progress-state.mjs`.

### Task 2: Add Pure Rules

**Files:**
- Modify: `src/business/publish-from-spu/publish-rules.ts`

- [ ] Add `normalizeShopRuleText`.
- [ ] Add `isExpectedShopContext`.
- [ ] Add `evaluateShopSwitchMenuState`.
- [ ] Add `shop_switch_entry_unavailable` classification and retry eligibility.
- [ ] Run `npm run build && node scripts/test-progress-state.mjs`.

### Task 3: Use Rules In Action Layer

**Files:**
- Modify: `src/business/publish-from-spu.ts`

- [ ] Add DOM read helper for switch entry visibility.
- [ ] In `ensureShopContext`, read current shop from the menu before clicking the switch entry.
- [ ] If rules return `already_in_target_shop`, close menu and continue.
- [ ] If rules return `retry_menu`, reload the platform SPU page and retry.
- [ ] Run `npm run build && node scripts/test-progress-state.mjs`.

### Task 4: Verify And Continue

- [ ] Run `npm run rules:check`.
- [ ] Run `npm run doctor:auto-listing`.
- [ ] Commit and push.
- [ ] Run `npm run auto-listing:hermes-start` to resume the failed real run through the project launcher.
