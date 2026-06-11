# Short Title Prefill Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover Doudian publishing by reopening the product page from the platform SPU row when the expected short-title field is missing.

**Architecture:** Add a rule-layer decision for basic prefill completeness, read the field state in the browser action layer, and route incomplete SPU-prefilled pages through the existing `queryPlatformSpu()` recovery path. Keep ordinary network/page health reload behavior unchanged.

**Tech Stack:** TypeScript, Playwright, Node.js rule-check scripts

---

### Task 1: Add the failing rule and flow regression checks

**Files:**
- Modify: `scripts/test-publish-create-page-readiness-rule.mjs`
- Modify: `scripts/test-publish-module-sequence-rule.mjs`

- [ ] **Step 1: Write the failing rule test**

Add an assertion that a page requiring a short title but lacking its field returns `reopen_from_platform_spu`, while a visible field returns `ready`.

- [ ] **Step 2: Write the failing action-flow test**

Assert that the publish and graphic basic-info catch paths recognize the prefill-reopen error and call `queryPlatformSpu()`, and that the first basic-info attempt still does not navigate to the existing create URL.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node scripts/test-publish-create-page-readiness-rule.mjs && node scripts/test-publish-module-sequence-rule.mjs`

Expected: FAIL because the prefill completeness rule and recovery branch do not exist.

### Task 2: Implement short-title prefill recovery

**Files:**
- Modify: `src/business/publish-from-spu/publish-rules.ts`
- Modify: `src/business/publish-from-spu.ts`

- [ ] **Step 1: Add the rule-layer decision**

Add `evaluateBasicPrefillReadiness({ shortTitleRequired, shortTitleFieldVisible })`, returning `ready` or `reopen_from_platform_spu`.

- [ ] **Step 2: Add the browser field-state reader**

Read whether an editable input/textarea exists inside the `attr-field-id="导购短标题"` field container. Do not reload from this reader.

- [ ] **Step 3: Route missing-field failures through SPU query recovery**

Before filling basic information, throw the existing `PublishCreatePageReopenRequiredError` when the rule requires reopening. In both publish and graphic flows, catch that error on the first basic attempt, call `queryPlatformSpu()`, replace `createPageUrl`, and retry.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `node scripts/test-publish-create-page-readiness-rule.mjs && node scripts/test-publish-module-sequence-rule.mjs`

Expected: both scripts print their passed messages and exit 0.

### Task 3: Document, verify, and resume

**Files:**
- Modify: `docs/auto-listing/steps/10-publish.md`

- [ ] **Step 1: Add the durable publishing rule**

Document that an expected but missing short-title field is an incomplete SPU-prefill page and must be reopened from the platform SPU row instead of refreshing the create URL.

- [ ] **Step 2: Run project verification**

Run: `npm run build && npm run doctor && npm run rules:check && npm run doctor:feishu && npm run doctor:auto-listing`

Expected: all commands exit 0.

- [ ] **Step 3: Run the simulated flow**

Run: `npm run business:auto-listing -- --job ./input/auto-listing.job.mac-feishu-flow.json`

Expected: simulation exits 0 without real publishing side effects.

- [ ] **Step 4: Resume Hermes and inspect status**

Run: `npm run auto-listing:hermes-start`, then `npm run auto-listing:hermes-status`.

Expected: Hermes resumes the remaining failed product instead of stopping on the missing short-title field.
