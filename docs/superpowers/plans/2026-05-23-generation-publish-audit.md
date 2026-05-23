# Generation Publish Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `audit:auto-listing` so generation output and publish coverage are audited with pure rules.

**Architecture:** Keep audit decisions in `src/autolist/audit-rules.ts`; keep filesystem reads and CLI formatting in `src/cli/audit-auto-listing.ts`. Existing auto-listing execution remains unchanged.

**Tech Stack:** TypeScript, Node.js, existing script-based regression tests.

---

### Task 1: Add Failing Audit Tests

**Files:**
- Modify: `scripts/test-progress-state.mjs`

- [ ] Add tests for generation audit:
  - A task with 2 prompts and 4 images each passes.
  - A task with prompt 2 missing one image fails with `main_image_prompt_count_mismatch`.
  - Duplicate output file fails with `main_image_duplicate_file`.

- [ ] Add tests for publish audit:
  - A distributed folder with manifest `published + publish_signal_confirmed` passes.
  - A distributed folder without safe result fails with `publish_result_missing`.

- [ ] Run: `npm run build && node scripts/test-progress-state.mjs`
  - Expected before implementation: failure because new functions are not exported.

### Task 2: Implement Pure Rules

**Files:**
- Modify: `src/autolist/audit-rules.ts`

- [ ] Add `auditMainImageGeneration`.
- [ ] Add `auditPublishCoverage`.
- [ ] Keep functions pure: no `fs`, no process, no CLI formatting.
- [ ] Run: `npm run build && node scripts/test-progress-state.mjs`
  - Expected: pass.

### Task 3: Wire CLI

**Files:**
- Modify: `src/cli/audit-auto-listing.ts`

- [ ] Read latest `state.json`.
- [ ] Read latest run `publish-manifest.json` if it exists.
- [ ] Include runtime, shop, main-image work, Feishu image, and qualification files in the existing file set.
- [ ] Merge continuity, generation, and publish errors into one output.
- [ ] Run: `npm run audit:auto-listing`
  - Expected: exits 0 when only warnings exist.

### Task 4: Verify And Ship

**Files:**
- Modify docs only if command behavior changes.

- [ ] Run `npm run build`.
- [ ] Run `node scripts/test-progress-state.mjs`.
- [ ] Run `npm run rules:check`.
- [ ] Run `npm run doctor:auto-listing`.
- [ ] Run `npm run audit:auto-listing`.
- [ ] Run `git status --short`.
- [ ] Commit and push to GitHub.
