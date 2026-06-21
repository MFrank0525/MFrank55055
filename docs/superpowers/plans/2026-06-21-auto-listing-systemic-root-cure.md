# Auto-Listing Systemic Root Cure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove obsolete providers and make Feishu intake, publish identity, auditing, runtime closure, failure handling, and DOM click policy fail closed with representative verification.

**Architecture:** Introduce small rule modules for cache contracts, publish identity, deep audit, and circuit breaking. Existing orchestrator and publisher actions consume these rules; runtime artifacts carry canonical identity instead of relying on display paths.

**Tech Stack:** TypeScript 5.9, Node.js ESM, Playwright, existing `.mjs` regression scripts, JSON runtime artifacts.

---

### Task 1: Remove obsolete provider paths and rename current main-image code

**Files:**
- Create: `src/utils/path-names.ts`
- Rename: `src/autolist/jimeng-assets.ts` -> `src/autolist/main-image-assets.ts`
- Modify: `src/autolist/config.ts`
- Modify: `src/autolist/types.ts`
- Modify: `src/autolist/orchestrator.ts`
- Modify: `src/autolist/cleanup.ts`
- Modify: `src/autolist/prepare-test-run.ts`
- Modify: `src/autolist/deepseek-word-docs.ts`
- Modify: `src/autolist/title-rules.ts`
- Modify: `src/autolist/title-sheets.ts`
- Modify: `src/autolist/archive-main-images.ts`
- Modify: `src/autolist/deepseek-prompts.ts`
- Modify: `src/autolist/resume.ts`
- Modify: `src/feishu/assets.ts`
- Modify: `src/cli/audit-auto-listing.ts`
- Modify: `src/cli/doctor.ts`
- Delete: `src/doubao/**`
- Delete: `src/browser/doubao.ts`
- Delete: `src/cli/doubao-*.ts`
- Delete: `scripts/dreamina-cli/**`
- Delete: `input/doubao-job.example.json`
- Delete: `schemas/doubao-job.schema.json`
- Delete: `schemas/legacy-task.schema.json`
- Test: `scripts/test-obsolete-provider-removal-rule.mjs`

- [ ] **Step 1: Write the failing obsolete-path test**

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" });
for (const forbidden of ["src/doubao/", "src/browser/doubao.ts", "dreamina-cli", "doubao-job", "jimeng-assets.ts"]) {
  assert.equal(tracked.includes(forbidden), false, `obsolete path remains: ${forbidden}`);
}
const packageJson = fs.readFileSync("package.json", "utf8");
assert.doesNotMatch(packageJson, /business:doubao|dreamina|jimeng/i);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-obsolete-provider-removal-rule.mjs`
Expected: FAIL because tracked obsolete paths and npm entries still exist.

- [ ] **Step 3: Move shared path helpers and rename symbols**

```ts
// src/utils/path-names.ts
export function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
}

export function formatTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
```

Rename all current-path identifiers to `mainImageWorkDir`, `mainImageAssets`, `mainImagePromptFile`, and `normalizeTitleForDoudian`. Remove legacy step aliases and removed provider configuration fields instead of retaining compatibility branches.

- [ ] **Step 4: Delete obsolete code and migrate operational paths**

Use `input/auto-listing/main-images` as the only work directory. Update current jobs, docs, imports, test imports, and cleanup rules. Delete obsolete source trees, scripts, schemas, examples, and tests that only exercise removed behavior.

- [ ] **Step 5: Run focused and full checks**

Run: `node scripts/test-obsolete-provider-removal-rule.mjs && npm run build && npm run rules:check`
Expected: PASS with no removed provider path imported or exposed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Remove obsolete listing providers"
```

### Task 2: Make Feishu configuration and cache fail closed

**Files:**
- Create: `src/feishu/cache-contract.ts`
- Modify: `src/feishu/types.ts`
- Modify: `src/feishu/product-records.ts`
- Modify: `src/feishu/assets.ts`
- Modify: `src/autolist/feishu-products.ts`
- Modify: `src/cli/doctor.ts`
- Modify: `src/cli/audit-auto-listing.ts`
- Modify: `src/autolist/preflight.ts`
- Test: `scripts/test-feishu-cache-contract.mjs`

- [ ] **Step 1: Write failing cache-contract tests**

```js
import assert from "node:assert/strict";
import { validateFeishuProductPayload } from "../dist/src/feishu/cache-contract.js";

const completeRecord = {
  recordId: "rec-1", userCognitionName: "A", genericName: "B", brand: "C", spu: "D",
  sellingPointText: "E", deepseekPromptText: "1\n2\n3\n4\n5",
  mainImageInstructionText: "F", positivePromptText: "G", negativePromptText: "H",
  titleKeywordText: "I,J", titleSuffixText: "K", productPriceText: "4,3,2,1",
  shortTitle: "L", productCategory: "医疗器械", qualificationImages: [{}], whiteBackgroundImages: [{}]
};
assert.throws(() => validateFeishuProductPayload({ records: [completeRecord] }), /schemaVersion/);
assert.throws(() => validateFeishuProductPayload({ schemaVersion: 2, fieldMapVersion: 2, records: [{ ...completeRecord, titleSuffixText: "" }] }), /titleSuffixText/);
assert.equal(validateFeishuProductPayload({ schemaVersion: 2, fieldMapVersion: 2, records: [completeRecord] }).records.length, 1);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run build && node scripts/test-feishu-cache-contract.mjs`
Expected: FAIL because `cache-contract.js` does not exist.

- [ ] **Step 3: Implement shared cache validation**

```ts
export const FEISHU_CACHE_SCHEMA_VERSION = 2;
export const FEISHU_FIELD_MAP_VERSION = 2;

export function validateFeishuProductPayload(input: unknown): FeishuProductPayload {
  const payload = parsePayloadObject(input);
  if (payload.schemaVersion !== FEISHU_CACHE_SCHEMA_VERSION) throw new Error("Feishu cache schemaVersion mismatch");
  if (payload.fieldMapVersion !== FEISHU_FIELD_MAP_VERSION) throw new Error("Feishu cache fieldMapVersion mismatch");
  const invalid = payload.records.flatMap((record) => validateFeishuProductRecord(record).map((field) => `${record.recordId}:${field}`));
  if (invalid.length) throw new Error(`Feishu cache record validation failed: ${invalid.join(", ")}`);
  return payload;
}
```

Make asset refresh write schema/version/fingerprint. Make all cache readers call this function.

- [ ] **Step 4: Make doctor parse real config and cache**

`doctor:feishu` must call `loadFeishuBitableConfig()` and `validateFeishuProductPayload()` and report missing mappings or fields as failures. Preflight and zero-task simulation must run the same checks.

- [ ] **Step 5: Verify focused behavior**

Run: `npm run build && node scripts/test-feishu-cache-contract.mjs && npm run doctor:feishu`
Expected: test PASS; doctor FAIL against stale local config until local configuration is migrated in Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/feishu src/autolist/feishu-products.ts src/autolist/preflight.ts src/cli/doctor.ts src/cli/audit-auto-listing.ts scripts/test-feishu-cache-contract.mjs
git commit -m "Fail closed on stale Feishu data"
```

### Task 3: Introduce canonical publish identity and collision-proof folders

**Files:**
- Create: `src/autolist/publish-identity.ts`
- Modify: `src/autolist/types.ts`
- Modify: `src/autolist/main-image-assets.ts`
- Modify: `src/autolist/publish-manifest.ts`
- Modify: `src/autolist/publish.ts`
- Modify: `src/autolist/orchestrator.ts`
- Modify: `src/autolist/audit-rules.ts`
- Test: `scripts/test-publish-canonical-identity.mjs`

- [ ] **Step 1: Write failing canonical-identity test**

```js
import assert from "node:assert/strict";
import { buildPublishTargetIdentity, publishTargetKey } from "../dist/src/autolist/publish-identity.js";

const a = buildPublishTargetIdentity({ batchFingerprint: "batch", recordId: "cold", taskId: "image-005", shopCode: "01", watermarkNo: 1 });
const b = buildPublishTargetIdentity({ batchFingerprint: "batch", recordId: "warm", taskId: "image-006", shopCode: "01", watermarkNo: 1 });
assert.notEqual(publishTargetKey(a), publishTargetKey(b));
assert.throws(() => buildPublishTargetIdentity({ batchFingerprint: "", recordId: "cold", taskId: "image-005", shopCode: "01", watermarkNo: 1 }), /batchFingerprint/);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run build && node scripts/test-publish-canonical-identity.mjs`
Expected: FAIL because the identity module does not exist.

- [ ] **Step 3: Implement canonical identity**

```ts
export interface PublishTargetIdentity {
  batchFingerprint: string;
  recordId: string;
  taskId: string;
  shopCode: string;
  watermarkNo: number;
}

export function publishTargetKey(value: PublishTargetIdentity): string {
  return [value.batchFingerprint, value.recordId, value.taskId, value.shopCode, String(value.watermarkNo).padStart(2, "0")].map(encodeURIComponent).join("__");
}
```

Add identity to plan, manifest, result, checkpoint-facing metadata, and publish artifacts. Manifest upsert and lookup must use `targetKey`.

- [ ] **Step 4: Make visible product folders collision proof**

Use a readable stable suffix such as `-<recordId>-水印NN`; keep workbook-visible titles unchanged. Add a pre-distribution assertion that all target keys and folder paths are unique within a batch.

- [ ] **Step 5: Add the 120-vs-100 regression**

Create two same-display-name tasks with 20 folders each and assert 40 unique target keys and manifest entries. Create a 120-target audit with 100 manifest entries and assert `publish_manifest_identity_missing`.

- [ ] **Step 6: Verify and commit**

Run: `npm run build && node scripts/test-publish-canonical-identity.mjs && npm run rules:check`
Expected: PASS.

```bash
git add src/autolist scripts/test-publish-canonical-identity.mjs
git commit -m "Use canonical publish target identity"
```

### Task 4: Replace shallow audit with eight-dimensional deep audit

**Files:**
- Create: `src/autolist/deep-audit-rules.ts`
- Modify: `src/autolist/audit-rules.ts`
- Modify: `src/cli/audit-auto-listing.ts`
- Modify: `package.json`
- Test: `scripts/test-deep-auto-listing-audit.mjs`

- [ ] **Step 1: Write failing dimension and contradiction tests**

```js
import assert from "node:assert/strict";
import { runDeepAuditRules } from "../dist/src/autolist/deep-audit-rules.js";

const result = runDeepAuditRules({
  rules: { ok: true }, contradictions: [{ code: "shop_count_mismatch" }], runtime: { ok: true },
  identities: { ok: true }, recovery: { ok: true }, sideEffects: { ok: true }, artifacts: { ok: true }, residue: { ok: true }
});
assert.equal(result.ok, false);
assert.deepEqual(result.dimensions.map((item) => item.name), ["rules", "contradictions", "runtime", "identities", "recovery", "sideEffects", "artifacts", "residue"]);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run build && node scripts/test-deep-auto-listing-audit.mjs`
Expected: FAIL because the deep audit module does not exist.

- [ ] **Step 3: Implement dimension aggregation and evidence**

Each dimension returns `{ name, ok, errors, warnings, evidence }`. The CLI must include Feishu config/cache validation, category plan/document contracts, controller state, canonical publish identity coverage, resume fingerprint checks, uncertain-submit checks, artifact counts, and cleanup residue.

- [ ] **Step 4: Make current discoveries reproducible**

Tests must prove non-zero exit semantics for stale config, stale cache, 100/120 manifest coverage, dead-PID running job, and completed-batch residue. Zero-task simulation evidence must be marked `not_representative` rather than full-flow success.

- [ ] **Step 5: Verify and commit**

Run: `npm run build && node scripts/test-deep-auto-listing-audit.mjs && npm run audit:auto-listing -- --json`
Expected: test PASS; local audit may remain FAIL until cleanup and local config migration tasks complete.

```bash
git add src/autolist/deep-audit-rules.ts src/autolist/audit-rules.ts src/cli/audit-auto-listing.ts scripts/test-deep-auto-listing-audit.mjs package.json
git commit -m "Add evidence-based deep listing audit"
```

### Task 5: Close controller and completed-batch runtime state

**Files:**
- Modify: `src/cli/auto-listing-controller.ts`
- Modify: `src/cli/auto-listing-supervisor.ts`
- Modify: `src/autolist/maintenance-rules.ts`
- Modify: `src/autolist/cleanup.ts`
- Test: `scripts/test-controller-terminal-cleanup.mjs`

- [ ] **Step 1: Write failing stale-running-job test**

```js
import assert from "node:assert/strict";
import { resolveControllerJobClosure } from "../dist/src/autolist/maintenance-rules.js";

assert.deepEqual(resolveControllerJobClosure({ declaredStatus: "running", processAlive: false, terminalResult: "completed" }), {
  action: "write_terminal", status: "completed"
});
assert.deepEqual(resolveControllerJobClosure({ declaredStatus: "running", processAlive: false, terminalResult: undefined }), {
  action: "clear_stale", status: "failed"
});
```

- [ ] **Step 2: Run RED, implement closure, run GREEN**

Run: `npm run build && node scripts/test-controller-terminal-cleanup.mjs`
Expected RED before implementation and PASS after adding the pure rule and controller integration.

- [ ] **Step 3: Enforce completed-batch residue cleanup**

Keep one authoritative real run plus explicitly retained audit evidence; remove empty simulation runs, stale control logs according to retention, stale generated jobs, paid ledgers, and intermediate inputs. Cleanup failure keeps result non-terminal.

- [ ] **Step 4: Verify and commit**

Run: `npm run build && node scripts/test-controller-terminal-cleanup.mjs && node scripts/test-maintenance-residue-rule.mjs`
Expected: PASS.

```bash
git add src/cli/auto-listing-controller.ts src/cli/auto-listing-supervisor.ts src/autolist/maintenance-rules.ts src/autolist/cleanup.ts scripts/test-controller-terminal-cleanup.mjs
git commit -m "Close terminal controller runtime state"
```

### Task 6: Add systemic publish failure circuit breaking

**Files:**
- Create: `src/autolist/failure-circuit-breaker.ts`
- Modify: `src/autolist/publish.ts`
- Modify: `src/autolist/types.ts`
- Test: `scripts/test-publish-failure-circuit-breaker.mjs`

- [ ] **Step 1: Write failing circuit-breaker tests**

```js
import assert from "node:assert/strict";
import { recordPublishFailure } from "../dist/src/autolist/failure-circuit-breaker.js";

let state = { consecutive: 0, signature: "" };
state = recordPublishFailure(state, { stage: "detail", errorClass: "detail_image_count_mismatch", threshold: 3 });
state = recordPublishFailure(state, { stage: "detail", errorClass: "detail_image_count_mismatch", threshold: 3 });
state = recordPublishFailure(state, { stage: "detail", errorClass: "detail_image_count_mismatch", threshold: 3 });
assert.equal(state.open, true);
assert.equal(recordPublishFailure(state, { stage: "image_provider", errorClass: "external_service_unavailable", threshold: 3 }).open, false);
```

- [ ] **Step 2: Run RED, implement rule, run GREEN**

Use normalized `stage:errorClass` signatures. Three consecutive deterministic publish failures open the product-group circuit. External image-service waits and final-submit uncertainty retain their existing special handling.

- [ ] **Step 3: Integrate before each pending folder**

When open, stop remaining folders, write a structured circuit-breaker event/result, and preserve resume evidence. Do not mark unattempted folders failed or published.

- [ ] **Step 4: Verify and commit**

Run: `npm run build && node scripts/test-publish-failure-circuit-breaker.mjs && npm run rules:check`
Expected: PASS.

```bash
git add src/autolist/failure-circuit-breaker.ts src/autolist/publish.ts src/autolist/types.ts scripts/test-publish-failure-circuit-breaker.mjs
git commit -m "Stop repeated systemic publish failures"
```

### Task 7: Enforce DOM-only click policy across browser actions

**Files:**
- Create: `scripts/check-dom-click-policy.mjs`
- Modify: `package.json`
- Modify: `scripts/test-publish-no-coordinate-clicks-rule.mjs`
- Test: `scripts/fixtures/dom-click-policy/coordinate-click.ts`

- [ ] **Step 1: Write the policy checker test fixture**

```ts
export async function forbidden(page: any): Promise<void> {
  await page.mouse.click(100, 200);
}
```

The checker test invokes policy analysis on the fixture and asserts an error naming `page.mouse.click` and the source location.

- [ ] **Step 2: Run RED**

Run: `node scripts/check-dom-click-policy.mjs --self-test`
Expected: FAIL because the policy checker does not exist.

- [ ] **Step 3: Implement project-wide structural checks**

Scan browser action TypeScript sources and reject `mouse.click`, `touchscreen.tap`, `elementFromPoint`, `clientX/clientY` click synthesis, coordinate-based helper calls, and bounding-box-to-click flows. Allow scrolling without allowing scroll coordinates to feed clicks.

- [ ] **Step 4: Add the checker to `rules:check`**

The existing no-coordinate test remains as a focused regression; the new checker is the mandatory full-source gate.

- [ ] **Step 5: Verify and commit**

Run: `node scripts/check-dom-click-policy.mjs --self-test && node scripts/check-dom-click-policy.mjs && npm run rules:check`
Expected: PASS for production sources and expected rejection of the fixture during self-test.

```bash
git add scripts/check-dom-click-policy.mjs scripts/fixtures/dom-click-policy/coordinate-click.ts scripts/test-publish-no-coordinate-clicks-rule.mjs package.json
git commit -m "Enforce DOM-only browser clicks"
```

### Task 8: Add representative simulation and finish operational cleanup

**Files:**
- Create: `scripts/fixtures/representative-feishu-products.json`
- Create: `input/auto-listing.job.representative-simulate.json`
- Create: `scripts/test-representative-auto-listing-simulation.mjs`
- Modify: `docs/auto-listing/**`
- Modify: `README.md`
- Modify: `README.ai.md`
- Modify: `input/feishu-bitable.config.example.json`
- Modify: `/Users/mfrank/.codex/skills/douyin-auto-listing-project/SKILL.md`
- Modify locally, do not commit: `input/feishu-bitable.config.json`

- [ ] **Step 1: Write representative simulation assertion**

```js
import assert from "node:assert/strict";
import fs from "node:fs";
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(result.ok, true);
assert.equal(result.taskCount, 1);
assert.deepEqual(result.completedSteps, [
  "source_images_discovered", "selling_points_loaded", "poster_prompts_generated", "main_images_generated",
  "product_folders_built", "titles_generated", "titles_distributed", "metadata_enriched",
  "qualifications_attached", "shop_distributed", "published", "cleaned"
]);
```

- [ ] **Step 2: Run RED**

Run the representative job and assertion.
Expected: FAIL until fixture-mode deterministic artifacts and complete result evidence are supported.

- [ ] **Step 3: Implement isolated representative simulation**

Use temporary fixture roots, one valid pending product, deterministic placeholder image files only in simulate mode, no provider request, no browser submit, and full node/state/artifact transitions. Explicitly mark evidence `representativeSimulation: true`.

- [ ] **Step 4: Remove operational documentation residue**

Delete obsolete specs/plans that teach removed paths. Rewrite current docs and project skill to contain only current names and the deep-audit definition. Keep the explicit DOM-only click rule and the user-approved exclusion for image-content quality gates.

- [ ] **Step 5: Migrate local Feishu config and refresh cache**

Add the five new local field mappings without exposing credentials. Run `feishu:check`, `feishu:fields`, and refresh assets only after the field list confirms all mappings exist.

- [ ] **Step 6: Run full verification**

```bash
npm run build
npm run rules:check
npm run doctor
npm run doctor:feishu
npm run doctor:auto-listing
npm run doctor:all
npm run audit:auto-listing -- --json
npm run business:auto-listing -- --job ./input/auto-listing.job.representative-simulate.json
```

Expected: all commands exit 0; representative task count is 1 and all business steps are evidenced. Real Feishu read-only checks and Doudian DOM login-state checks pass.

- [ ] **Step 7: Perform two final audits**

Audit A: requirement trace against the design, obsolete-name search, identity cardinality, runtime residue, and secret staging.

Audit B: independent fresh rerun of build, rules, doctors, deep audit, representative simulation, Git diff review, and source scan for prohibited clicks.

- [ ] **Step 8: Commit and push**

```bash
git add -A
git commit -m "Complete auto-listing systemic root cure"
git push origin master
```
