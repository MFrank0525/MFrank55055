# Resume Batch Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a successful single-product resume does not mark the whole Feishu batch completed when pending products remain.

**Architecture:** Put Feishu batch completion rules in `audit-rules.ts`; keep Hermes file reads, status text, and stale resume cleanup in `hermes-auto-listing-runner.ts`.

**Tech Stack:** TypeScript, Node.js, existing script regression tests.

---

### Task 1: Add Batch Progress Rule Test

- [x] Modify `scripts/test-progress-state.mjs`.
- [x] Add a test with 3 Feishu records and 2 processed source images.
- [x] Assert pending count is 1 and `batchComplete=false`.
- [x] Run `npm run build && node scripts/test-progress-state.mjs`; expect failure before implementation.

### Task 2: Implement Pure Rule

- [x] Modify `src/autolist/audit-rules.ts`.
- [x] Add `summarizeFeishuBatchProgress`.
- [x] Run `npm run build && node scripts/test-progress-state.mjs`; expect pass.

### Task 3: Use Rule In Hermes Runner

- [x] Modify `src/cli/hermes-auto-listing-runner.ts`.
- [x] Read Feishu product cache and processed manifest.
- [x] Add `feishuProgress` to status output.
- [x] Block `completed` when `batchComplete=false`.
- [x] Remove stale successful resume job before command selection.

### Task 4: Verify And Continue

- [x] Run `npm run build`.
- [x] Run `node scripts/test-progress-state.mjs`.
- [x] Run `npm run rules:check`.
- [x] Run `npm run doctor:auto-listing`.
- [x] Run `npm run auto-listing:hermes-status -- --text`.
- [ ] Commit and push.
- [ ] Run `npm run auto-listing:hermes-start` to continue remaining products.
