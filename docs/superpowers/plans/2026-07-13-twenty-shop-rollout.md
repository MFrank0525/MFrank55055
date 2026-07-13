# Twenty-Shop Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the canonical Doudian shop sequence to 20 shops, preserve exactly 20 publish targets per Feishu product for all supported categories, and prove all shops are accessible through a read-only browser audit that cannot publish products.

**Architecture:** Keep canonical shop identity and category allocation in pure rule modules. Add a pure shop-access evidence validator, a dependency-injected read-only browser orchestrator that reuses only the existing shop-context action, and a dedicated CLI. All downstream distribution, progress, documentation, and deep-audit consumers continue to derive counts from the shared category plan.

**Tech Stack:** TypeScript 5.9, Node.js ESM, Playwright, Node `assert` rule tests, existing npm build/doctor/audit commands.

---

## File map

- Modify `src/autolist/shop-rules.ts`: canonical 20-shop ordered catalog and shared target-count validation.
- Modify `src/autolist/product-category.ts`: category allocations derived from the catalog.
- Create `src/autolist/shop-access-audit-rules.ts`: pure report and side-effect validation.
- Create `src/business/shop-access-audit.ts`: sequential, fail-closed, dependency-injected read-only audit orchestration.
- Create `src/cli/audit-shop-access.ts`: CLI and runtime evidence output.
- Modify `package.json`: expose `audit:shop-access` and include focused rules in `rules:check`.
- Modify `scripts/test-shop-category-rules.mjs`: exact ordered catalog and 20-target category tests.
- Modify `scripts/test-main-image-shop-distribution-rule.mjs`: exact distribution sequences for all categories.
- Create `scripts/test-shop-access-audit-rule.mjs`: report validation and sequential orchestration tests.
- Create `scripts/test-shop-access-module-boundaries.mjs`: no publishing/form dependency guard.
- Modify progress/deep-audit tests where fixtures encode the superseded 10/5 plan.
- Modify the authoritative auto-listing step docs, project contracts, SOP, Feishu setup, and project skill to remove contradictory old rules.

### Task 1: Canonical shop catalog and allocation closure

**Files:**
- Modify: `scripts/test-shop-category-rules.mjs`
- Modify: `src/autolist/shop-rules.ts`
- Modify: `src/autolist/product-category.ts`

- [ ] **Step 1: Write the failing catalog and allocation test**

Replace the expected catalog with all 20 exact names and assert these plans:

```js
assert.deepEqual(getProductCategoryPlan("医疗器械").shopCodes, allShopCodes);
assert.equal(getProductCategoryPlan("医疗器械").imagesPerShop, 1);
assert.deepEqual(getProductCategoryPlan("保健食品").shopCodes, allShopCodes);
assert.equal(getProductCategoryPlan("保健食品").imagesPerShop, 1);
assert.deepEqual(getProductCategoryPlan("非处方药").shopCodes, allShopCodes.slice(0, 10));
assert.equal(getProductCategoryPlan("非处方药").imagesPerShop, 2);
for (const category of ["医疗器械", "非处方药", "保健食品"]) {
  const plan = getProductCategoryPlan(category);
  assert.equal(plan.shopCodes.length * plan.imagesPerShop, 20);
}
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run build && node scripts/test-shop-category-rules.mjs`

Expected: FAIL because the catalog has 10 shops and the old allocations are 10×2/5×4/10×2.

- [ ] **Step 3: Implement the canonical catalog and derived plans**

Add shops 06–20 exactly as specified. Export a helper that derives ordered codes without duplicating literals:

```ts
export function getOrderedShopCodes(limit = SHOP_SPECS.length): string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > SHOP_SPECS.length) {
    throw new Error(`Shop code limit must be between 1 and ${SHOP_SPECS.length}, got ${limit}.`);
  }
  return SHOP_SPECS.slice(0, limit).map((item) => item.shopCode);
}
```

Use `getOrderedShopCodes()` for medical devices and health food, and `getOrderedShopCodes(10)` for OTC. Set per-shop counts to 1, 1, and 2 respectively. Add a module-load closure assertion that each category plan has unique known shops and exactly 20 targets.

- [ ] **Step 4: Run focused test and confirm GREEN**

Run: `npm run build && node scripts/test-shop-category-rules.mjs`

Expected: `shop category rules passed`.

- [ ] **Step 5: Commit**

```bash
git add src/autolist/shop-rules.ts src/autolist/product-category.ts scripts/test-shop-category-rules.mjs
git commit -m "feat: expand canonical publishing plan to twenty shops"
```

### Task 2: Distribution and representative simulation regression

**Files:**
- Modify: `scripts/test-main-image-shop-distribution-rule.mjs`
- Modify: `scripts/run-representative-auto-listing-simulation.mjs` only if a fixture hard-codes old shop counts.

- [ ] **Step 1: Write failing distribution assertions**

Assert medical-device and health-food shop codes are `01` through `20` once each, and OTC codes are `01` through `10` twice each. Assert generated file count remains 20 for every category.

- [ ] **Step 2: Confirm RED against stale assertions**

Run: `npm run build && node scripts/test-main-image-shop-distribution-rule.mjs`

Expected: FAIL on the old repeated 01–10 or 01–05 sequence.

- [ ] **Step 3: Update fixtures without changing production distribution mechanics**

Generate expected sequences from explicit test expectations:

```js
const twentyShopCodes = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, "0"));
const otcCodes = Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(2, "0"))
  .flatMap((code) => [code, code]);
```

- [ ] **Step 4: Verify focused distribution and representative simulation**

Run: `npm run build && node scripts/test-main-image-shop-distribution-rule.mjs && npm run simulate:representative`

Expected: both commands pass and every category still produces 20 targets.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-main-image-shop-distribution-rule.mjs scripts/run-representative-auto-listing-simulation.mjs
git commit -m "test: cover twenty-shop target distribution"
```

### Task 3: Pure shop-access audit rules

**Files:**
- Create: `src/autolist/shop-access-audit-rules.ts`
- Create: `scripts/test-shop-access-audit-rule.mjs`

- [ ] **Step 1: Write failing pure-rule tests**

Test a complete ordered report and separate failures for missing entries, duplicate shop codes, out-of-order codes, expected/actual name mismatch, `publishAttempted=true`, and `formMutationAttempted=true`.

- [ ] **Step 2: Confirm RED**

Run: `npm run build`

Expected: FAIL because `shop-access-audit-rules.ts` does not exist.

- [ ] **Step 3: Implement the report contract and validator**

Define `ShopAccessAuditEntry`, `ShopAccessSideEffects`, `ShopAccessAuditReport`, and:

```ts
export function validateShopAccessAuditReport(
  report: ShopAccessAuditReport,
  expected: readonly ShopSpec[] = getShopSpecs()
): { ok: boolean; errors: string[] };
```

Validation must require 20 exact ordered entries, each `passed=true`, normalized exact name equality, unique codes, `publishAttempted=false`, and `formMutationAttempted=false`.

- [ ] **Step 4: Confirm GREEN**

Run: `npm run build && node scripts/test-shop-access-audit-rule.mjs`

Expected: `shop access audit rules passed`.

- [ ] **Step 5: Commit**

```bash
git add src/autolist/shop-access-audit-rules.ts scripts/test-shop-access-audit-rule.mjs
git commit -m "feat: add fail-closed shop access audit rules"
```

### Task 4: Read-only browser audit orchestration

**Files:**
- Modify: `scripts/test-shop-access-audit-rule.mjs`
- Create: `src/business/shop-access-audit.ts`
- Create: `scripts/test-shop-access-module-boundaries.mjs`

- [ ] **Step 1: Add failing orchestration tests**

Inject a fake `ensureShopContext` function and assert calls are exactly `01`–`20`. Inject a failure at `07` and assert calls stop at `07`, the report is failed, later shops are absent, and evidence is written.

- [ ] **Step 2: Confirm RED**

Run: `npm run build`

Expected: FAIL because the orchestrator module is missing.

- [ ] **Step 3: Implement dependency-injected sequential orchestration**

Export:

```ts
export interface ShopAccessAuditDependencies {
  openPage(): Promise<Page>;
  ensureShopContext(page: Page, runtimeDir: string, shopFolder: string): Promise<string>;
  now(): Date;
}

export async function runShopAccessAudit(input: {
  runtimeDir: string;
  dependencies?: Partial<ShopAccessAuditDependencies>;
}): Promise<ShopAccessAuditReport>;
```

Default `openPage` uses `launchPersistentBrowser()` and `getWorkspacePage(context, "shop")`; default switching calls only `ensureShopContext`. Persist `shop-access-audit.json` after every entry and after failures. Never import `publish-flow`, submit actions, form actions, or the auto-listing controller.

- [ ] **Step 4: Add and run the module-boundary guard**

The guard reads `src/business/shop-access-audit.ts` and asserts forbidden imports/text are absent, including `publish-flow`, `submit-action`, `fill(`, `runPublish`, and `/ffa/g/create`.

Run: `npm run build && node scripts/test-shop-access-audit-rule.mjs && node scripts/test-shop-access-module-boundaries.mjs`

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/business/shop-access-audit.ts scripts/test-shop-access-audit-rule.mjs scripts/test-shop-access-module-boundaries.mjs
git commit -m "feat: add read-only sequential shop access audit"
```

### Task 5: Dedicated CLI and rule-suite integration

**Files:**
- Create: `src/cli/audit-shop-access.ts`
- Modify: `package.json`
- Modify: `scripts/test-shop-access-audit-rule.mjs`

- [ ] **Step 1: Add failing CLI contract assertions**

Assert the CLI requires no publish confirmation flag, accepts `--runtime-root`, prints JSON with `ok`, `status`, `runtimeDir`, and `resultFile`, and exits nonzero for a failed report.

- [ ] **Step 2: Confirm RED**

Run: `npm run build`

Expected: FAIL because the CLI file does not exist.

- [ ] **Step 3: Implement CLI and npm command**

Add:

```json
"audit:shop-access": "npm run build && node dist/src/cli/audit-shop-access.js --json"
```

Default evidence root is `data/auto-listing/shop-access-audits/<timestamp>`. The CLI must never accept `--allow-publish` and must set exit code 1 when the report validator fails.

- [ ] **Step 4: Integrate focused tests into `rules:check` and verify**

Run: `npm run build && node scripts/test-shop-access-audit-rule.mjs && node scripts/test-shop-access-module-boundaries.mjs`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/audit-shop-access.ts package.json scripts/test-shop-access-audit-rule.mjs
git commit -m "feat: expose shop access audit command"
```

### Task 6: Contradiction-free docs, audit fixtures, and progress fixtures

**Files:**
- Modify: `docs/auto-listing/steps/03-main-image-generation.md`
- Modify: `docs/auto-listing/steps/04-product-folders.md`
- Modify: `docs/auto-listing/steps/09-shop-distribution.md`
- Modify: `docs/auto-listing/steps/10-publish.md`
- Modify: `docs/auto-listing/FLOW_NODE_CONTRACT.md`
- Modify: `docs/auto-listing/README.md`
- Modify: `docs/auto-listing/PROJECT-STRUCTURE.md`
- Modify: `docs/FEISHU_BITABLE_SETUP.md`
- Modify: `docs/PUBLISH_FLOW_SOP.md`
- Modify: `scripts/test-deep-auto-listing-audit.mjs`
- Modify: `scripts/test-progress-state.mjs`
- Modify: `/Users/mfrank/.codex/skills/douyin-auto-listing-project/SKILL.md`

- [ ] **Step 1: Update failing audit/progress expectations first**

Change category fixtures to medical 20 shops, health food 20 shops, OTC 10 shops. Change current medical examples from `店铺 x/10` to `店铺 x/20` where they represent the canonical current plan; keep deliberately synthetic fixtures only when the test explicitly supplies a ten-shop plan.

- [ ] **Step 2: Run tests and confirm old rule sources fail contradiction checks**

Run: `npm run build && node scripts/test-deep-auto-listing-audit.mjs && node scripts/test-progress-state.mjs`

Expected: at least one failure until authoritative Markdown rules are updated.

- [ ] **Step 3: Update all authoritative rule text**

Document exact 01–20 sequence and category allocations. State that all categories remain 20 targets and document `npm run audit:shop-access`. Remove superseded claims rather than adding compatibility notes.

- [ ] **Step 4: Run contradiction scan and focused tests**

Run:

```bash
rg -n "10 个店铺|前 5 个店铺|前五个店铺|店铺 y/10" docs src scripts /Users/mfrank/.codex/skills/douyin-auto-listing-project/SKILL.md
npm run build
node scripts/test-deep-auto-listing-audit.mjs
node scripts/test-progress-state.mjs
```

Expected: remaining search hits are either absent or demonstrably synthetic historical test inputs; both tests pass.

- [ ] **Step 5: Commit project files and skill separately**

```bash
git add docs scripts/test-deep-auto-listing-audit.mjs scripts/test-progress-state.mjs
git commit -m "docs: align auto-listing rules with twenty shops"
```

The personal project skill is outside the repository commit but must be updated before final audit.

### Task 7: Full verification and real read-only shop operation audit

**Files:**
- Runtime only: `data/auto-listing/shop-access-audits/<run-id>/shop-access-audit.json`
- No source changes unless a test exposes a defect; any defect fix restarts at a focused failing test.

- [ ] **Step 1: Run fresh static and simulated gates**

Run:

```bash
npm run build
npm run rules:check
npm run doctor
npm run doctor:feishu
npm run doctor:auto-listing
npm run doctor:all
npm run audit:auto-listing -- --json
npm run simulate:representative
```

Expected: all required gates pass. A real-state audit may report a pre-existing runtime condition only if separately investigated; it cannot be counted as a pass.

- [ ] **Step 2: Verify Feishu read-only API/fields**

Run: `npm run feishu:fields` and the existing read-only record check appropriate to the configured base.

Expected: required current fields and supported category values are present; no writes occur.

- [ ] **Step 3: Run the real Doudian 20-shop read-only audit**

Run: `npm run audit:shop-access`

Expected: 20 exact ordered entries, overall `passed`, `publishAttempted=false`, `formMutationAttempted=false`. Do not run `auto-listing:hermes-start`, `publish:spu`, or any real publishing command.

- [ ] **Step 4: Run two independent audits**

First audit: rule/contradiction/residue scan plus `npm run rules:check`.

Second audit: validate the real `shop-access-audit.json`, run `npm run audit:auto-listing -- --json`, and inspect browser evidence for any failed entry.

- [ ] **Step 5: Inspect repository hygiene**

Run:

```bash
git diff --check
git status --short
git ls-files data input/feishu-bitable.config.json input/image-generation.config.json
rg -n "page\.mouse\.click|elementFromPoint|touchscreen|dispatchEvent\(new MouseEvent" src/business/publish-from-spu src/business/shop-access-audit.ts
```

Expected: no secrets/runtime artifacts staged, no coordinate-click implementation, and only intentional source/doc changes remain.

### Task 8: Final review, requirement closure, and GitHub delivery

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-twenty-shop-rollout-design.md` requirement statuses.

- [ ] **Step 1: Update requirement trace with verified evidence**

Change each critical status from `待实现` to `已验证` and name the exact passing command or runtime report.

- [ ] **Step 2: Re-run final verification after the trace update**

Run: `npm run build && npm run rules:check && git diff --check`

Expected: pass.

- [ ] **Step 3: Commit final audit closure**

```bash
git add docs/superpowers/specs/2026-07-13-twenty-shop-rollout-design.md
git commit -m "docs: close twenty-shop rollout audit"
```

- [ ] **Step 4: Verify branch and push**

Run: `git status --short`, `git log --oneline --decorate -12`, then `git push origin master`.

Expected: clean worktree and `origin/master` advances to the verified final commit.

- [ ] **Step 5: Verify remote parity**

Run: `git rev-parse HEAD` and `git rev-parse origin/master`.

Expected: identical commit IDs.
