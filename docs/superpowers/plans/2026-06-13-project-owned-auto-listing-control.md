# Project-Owned Auto-Listing Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the auto-listing project own all execution, resume, continuation, and status behavior while Hermes remains a thin compatible command entry.

**Architecture:** Rename the current execution-bearing Hermes runner and supervisor into project-owned controller modules. Keep package-level Hermes commands as thin aliases, and enforce the boundary with a focused rule test.

**Tech Stack:** TypeScript, Node.js child processes/filesystem, existing rule-check scripts.

---

### Task 1: Lock The Hermes Boundary With A Failing Rule Test

**Files:**
- Create: `scripts/test-hermes-thin-entry-rule.mjs`
- Modify: `package.json`

- [x] Add assertions that Hermes package commands only invoke `auto-listing-controller.js`.
- [x] Add assertions that no `src/cli/hermes-auto-listing-*.ts` execution implementation remains.
- [x] Add the test to `rules:check`.
- [x] Run the focused test and verify it fails before migration.

### Task 2: Move Execution Into Project-Owned Controller Modules

**Files:**
- Move: `src/cli/hermes-auto-listing-runner.ts` to `src/cli/auto-listing-controller.ts`
- Move: `src/cli/hermes-auto-listing-supervisor.ts` to `src/cli/auto-listing-supervisor.ts`
- Modify: `src/cli/auto-listing-controller.ts`
- Modify: `src/cli/auto-listing-supervisor.ts`
- Modify: `package.json`

- [x] Change controller-spawned supervisor paths to the project-owned supervisor.
- [x] Rename canonical control artifacts from Hermes-specific names to project control names.
- [x] Keep existing start/status/rerun Hermes commands as thin package aliases.
- [x] Run the focused boundary test and build until both pass.

### Task 3: Update Rule Tests And Operational Documentation

**Files:**
- Modify: `scripts/test-progress-state.mjs`
- Modify: `scripts/test-hermes-publish-progress-artifact-rule.mjs`
- Modify: `docs/FEISHU_BITABLE_SETUP.md`
- Modify: `docs/PUBLISH_FLOW_SOP.md`
- Modify: `docs/auto-listing/stability-checklist.md`
- Modify: `docs/auto-listing/script-map.md`

- [x] Point execution behavior tests at project-owned controller modules.
- [x] Document Hermes as a thin compatible launcher and project controller as the executor.
- [x] Remove instructions implying Hermes performs refresh, recovery, continuation, or status decisions.
- [x] Run `rules:check`.

### Task 4: Verify Full Project Behavior

**Files:**
- Modify only if verification reveals a regression.

- [x] Run `npm run build`.
- [x] Run `npm run rules:check`.
- [x] Run `npm run doctor`.
- [x] Run `npm run doctor:feishu`.
- [x] Run `npm run doctor:auto-listing`.
- [x] Run the simulated auto-listing flow.
- [x] Inspect `git status --short` for secrets or generated runtime artifacts.
