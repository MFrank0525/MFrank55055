# Health Food Publish Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and prove a category-isolated, DOM-only, fail-closed Doudian publish flow for health-food products using the new Feishu fields.

**Architecture:** Extend the Feishu record contract with category-specific source fields, centralize health-food policy in a focused rule module, and place health-food browser behavior in a focused action module. The existing publisher remains the orchestrator and injects shared page/upload helpers into the category action module. Medical-device behavior remains unchanged.

**Tech Stack:** TypeScript, Node.js, Playwright, Feishu Bitable API, existing JSON/checkpoint/audit infrastructure.

---

### Task 1: Extend the Feishu contract by category

**Files:**
- Modify: `src/feishu/types.ts`
- Modify: `src/feishu/config.ts`
- Modify: `src/feishu/product-records.ts`
- Modify: `src/autolist/feishu-products.ts`
- Modify: `src/feishu/cache-contract.ts`
- Modify: `input/feishu-bitable.config.example.json`
- Modify: `input/feishu-bitable.config.json` locally, never stage credentials
- Modify: `docs/FEISHU_BITABLE_SETUP.md`
- Test: `scripts/test-feishu-config-source-fields-rule.mjs`
- Test: `scripts/test-feishu-source-fields-rule.mjs`
- Test: `scripts/test-feishu-cache-contract.mjs`

- [ ] **Step 1: Write failing contract tests**

Add assertions that `FeishuBitableFieldMap` and normalized records support:

```text
manufacturerName -> 生产企业名称
manufacturerAddress -> 生产企业地址
netContent -> 净含量
productStandardCode -> 产品标准代码
ingredients -> 配料表
healthFunction -> 保健功能
specification -> 规格
```

Add a health-food fixture where `titleSuffixText` is empty and all seven health-food fields are present; `validateFeishuProductRecord` must return no errors. Add missing-field cases for each health-food field. Keep the suffix required for a medical-device fixture.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run build
node scripts/test-feishu-config-source-fields-rule.mjs
node scripts/test-feishu-source-fields-rule.mjs
node scripts/test-feishu-cache-contract.mjs
```

Expected: failures for missing map/type/normalization support and the unconditional suffix requirement.

- [ ] **Step 3: Implement the category-aware contract**

Add the seven fields to `FeishuBitableFieldMap` and `FeishuProductRecord`. Normalize them in `normalizeFeishuProductRecord`.

Change validation to:

```typescript
const category = normalizeProductCategory(record.productCategory);
if (category !== "保健食品" && !record.titleSuffixText) {
  missing.push("titleSuffixText");
}
if (category === "保健食品") {
  for (const [key, value] of [
    ["manufacturerName", record.manufacturerName],
    ["manufacturerAddress", record.manufacturerAddress],
    ["netContent", record.netContent],
    ["productStandardCode", record.productStandardCode],
    ["ingredients", record.ingredients],
    ["healthFunction", record.healthFunction],
    ["specification", record.specification]
  ] as const) {
    if (!value.trim()) missing.push(key);
  }
}
```

Update config examples and local mapping. Bump the Feishu field-map/cache contract version because cached records without these fields must not resume as current health-food records.

- [ ] **Step 4: Verify GREEN**

Run the three tests and `npm run doctor:feishu`.

- [ ] **Step 5: Commit**

```bash
git add src/feishu src/autolist/feishu-products.ts input/feishu-bitable.config.example.json docs/FEISHU_BITABLE_SETUP.md scripts/test-feishu-*.mjs
git commit -m "Add health food Feishu contract"
```

Do not stage `input/feishu-bitable.config.json`.

### Task 2: Add the health-food title policy

**Files:**
- Modify: `src/autolist/title-sheets.ts`
- Modify: `src/autolist/rule-contracts.ts`
- Modify: `docs/auto-listing/steps/05-title-generation.md`
- Modify: `docs/PUBLISH_FLOW_SOP.md`
- Test: `scripts/test-feishu-title-keywords-rule.mjs`
- Test: `scripts/test-rule-closure-audit.mjs`

- [ ] **Step 1: Write failing title tests**

Add a health-food case asserting:

```typescript
const titles = buildTitlesFromFeishuKeywords({
  keywordText: "苦瓜荞麦桑叶胶囊,辅助降血糖,金奥力牌,官方正品,保健食品,蓝帽认证,真品",
  fixedSuffixText: "",
  productCategory: "保健食品",
  titleCount: 20
});
```

Every title must be unique, contain only whole source tokens, have no suffix, and have `countTitleCharacters(title) <= 60`. Add a medical-device regression proving its suffix behavior remains unchanged.

- [ ] **Step 2: Verify RED**

Run `npm run build && node scripts/test-feishu-title-keywords-rule.mjs`.

Expected: current code rejects empty suffix and uses the 120-character limit.

- [ ] **Step 3: Implement category title policy**

Introduce a rule resolver:

```typescript
type TitleCompositionPolicy = {
  maxCharacters: number;
  requireSuffix: boolean;
};
```

Return `{ maxCharacters: 60, requireSuffix: false }` for `保健食品`; preserve the existing policy for other categories. Make all error messages report the resolved limit.

- [ ] **Step 4: Verify GREEN and rule closure**

Run:

```bash
npm run build
node scripts/test-feishu-title-keywords-rule.mjs
node scripts/test-rule-closure-audit.mjs
```

- [ ] **Step 5: Commit**

```bash
git add src/autolist/title-sheets.ts src/autolist/rule-contracts.ts docs/auto-listing/steps/05-title-generation.md docs/PUBLISH_FLOW_SOP.md scripts/test-feishu-title-keywords-rule.mjs scripts/test-rule-closure-audit.mjs
git commit -m "Add health food title policy"
```

### Task 3: Propagate category-specific publish metadata

**Files:**
- Modify: `src/business/publish-from-spu/types.ts`
- Modify: `src/autolist/publish.ts`
- Modify: `src/autolist/types.ts` if artifact types require extension
- Test: `scripts/test-publish-canonical-identity.mjs`
- Create: `scripts/test-health-food-publish-metadata-rule.mjs`

- [ ] **Step 1: Write failing metadata test**

Assert that publish jobs carry:

```typescript
{
  productCategory,
  manufacturerName,
  manufacturerAddress,
  netContent,
  productStandardCode,
  ingredients,
  healthFunction,
  specification
}
```

from the exact current `FeishuProductRecord`, not workbook inference or folder names.

- [ ] **Step 2: Verify RED**

Run the new test; expect missing metadata fields.

- [ ] **Step 3: Implement metadata propagation**

Extend `PublishFromSpuJobInput.metadata`. In `publishDistributedProducts`, add the exact fields from `productIdentityFields.feishuProductRecord` or extend `PublishProductIdentity` with a typed source snapshot referenced by record ID. Prefer passing the current normalized Feishu record from the orchestrator to publishing without duplicating raw attachment URLs.

- [ ] **Step 4: Verify GREEN**

Run the new test and canonical identity test.

- [ ] **Step 5: Commit**

```bash
git add src/business/publish-from-spu/types.ts src/autolist scripts/test-health-food-publish-metadata-rule.mjs scripts/test-publish-canonical-identity.mjs
git commit -m "Propagate health food publish metadata"
```

### Task 4: Create health-food business rules

**Files:**
- Create: `src/business/publish-from-spu/health-food-rules.ts`
- Modify: `src/business/publish-from-spu/publish-rules.ts`
- Create: `scripts/test-health-food-publish-rules.mjs`
- Modify: `scripts/test-progress-state.mjs`

- [ ] **Step 1: Write failing rule tests**

Cover:

- fixed food-safety values: `国产预包装食品`, shelf life `2`, storage `常温`;
- exact health-function matching only;
- nutrition table excluded;
- flavor category excluded;
- optional graphic areas and main video excluded;
- qualification images required for outer packaging, detail, and packaging label;
- controlled spec-template aliases;
- only the first numeric spec input may change to Feishu `规格`;
- second numeric input must remain `1`;
- four prices and stock `2000`;
- any missing field or non-exact option returns a blocking decision.

- [ ] **Step 2: Verify RED**

Run `npm run build && node scripts/test-health-food-publish-rules.mjs`.

- [ ] **Step 3: Implement pure rules**

Export focused types and functions such as:

```typescript
export function buildHealthFoodPublishRequirements(metadata): HealthFoodPublishRequirements;
export function evaluateHealthFoodSafetyReadback(input): PublishRuleCheck;
export function selectExactHealthFunctionOption(options, expected): string;
export function evaluateHealthFoodSpecReadback(input): PublishRuleCheck;
export function evaluateHealthFoodPackagingUploads(input): PublishRuleCheck;
```

No Playwright, filesystem or network imports are allowed in this module.

- [ ] **Step 4: Verify GREEN**

Run the rule tests and progress-state tests.

- [ ] **Step 5: Commit**

```bash
git add src/business/publish-from-spu/health-food-rules.ts src/business/publish-from-spu/publish-rules.ts scripts/test-health-food-publish-rules.mjs scripts/test-progress-state.mjs
git commit -m "Define health food publish rules"
```

### Task 5: Implement DOM-only health-food actions

**Files:**
- Create: `src/business/publish-from-spu/health-food-actions.ts`
- Modify: `src/business/publish-from-spu.ts` only to expose/inject shared helpers
- Create: `scripts/test-health-food-dom-actions-rule.mjs`
- Modify: `scripts/check-dom-click-policy.mjs` only if the new file is not already scanned
- Modify: `scripts/test-publish-no-coordinate-clicks-rule.mjs`

- [ ] **Step 1: Write failing source/behavior tests**

Require the action module to:

- locate field roots by visible labels and DOM ancestry;
- fill exact text inputs and read back values;
- open selects and choose exact visible options;
- find the checkbox structurally associated with exact `保健功能` text;
- upload files through `input[type=file]` inside the correct field root;
- never use `page.mouse.click`, coordinate-derived clicks, `elementFromPoint`, touchscreen coordinates, or synthetic coordinate events;
- produce typed readback results for every action.

- [ ] **Step 2: Verify RED**

Run the new source test and DOM policy checker; expect missing module/actions.

- [ ] **Step 3: Implement action adapters**

Create actions:

```typescript
fillHealthFoodSafetyAttributesOnPage(...)
fillHealthFoodCategoryAttributesOnPage(...)
uploadHealthFoodOuterPackagingOnPage(...)
applyHealthFoodSpecificationOnPage(...)
uploadHealthFoodPackagingLabelOnPage(...)
```

Use Playwright locators and DOM relationships. Inject shared screenshot, section-tab, overlay-dismissal and qualification-image preparation helpers instead of duplicating browser lifecycle code.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm run build
node scripts/test-health-food-dom-actions-rule.mjs
node scripts/check-dom-click-policy.mjs
node scripts/test-publish-no-coordinate-clicks-rule.mjs
```

- [ ] **Step 5: Commit**

```bash
git add src/business/publish-from-spu/health-food-actions.ts src/business/publish-from-spu.ts scripts/test-health-food-dom-actions-rule.mjs scripts/check-dom-click-policy.mjs scripts/test-publish-no-coordinate-clicks-rule.mjs
git commit -m "Add health food DOM actions"
```

### Task 6: Orchestrate the category-specific module sequence

**Files:**
- Modify: `src/business/publish-from-spu.ts`
- Modify: `src/business/publish-from-spu/publish-rule-text.ts`
- Modify: `docs/auto-listing/steps/10-publish.md`
- Modify: `docs/auto-listing/publish-rule-action-separation.md`
- Create: `scripts/test-health-food-publish-sequence-rule.mjs`
- Modify: `scripts/test-publish-module-sequence-rule.mjs`
- Modify: `scripts/test-md-rule-source-separation.mjs`

- [ ] **Step 1: Write failing sequence test**

Assert the health-food branch executes:

```text
query platform SPU
basic info
food safety
category attributes
graphic info
48-hour shipping + spec template + manual spec + spec replacement
price/inventory
service/fulfillment
packaging label
publish check
final submit
```

Assert medical-device certificate logic is not invoked for health food, and health-food actions are not invoked for medical devices.

- [ ] **Step 2: Verify RED**

Run the sequence tests; expect no health-food branch.

- [ ] **Step 3: Implement orchestration**

Resolve the normalized category once at the start of `runPublishFlow`. For health food:

- do not require/fill `modelSpec=盒装` in basic info;
- execute food safety and health-function gates before graphics;
- execute the health-food spec action before price rows;
- execute packaging-label upload instead of medical-device certificate;
- add explicit stages and progress messages for each module;
- keep all final-submit uncertainty behavior unchanged.

- [ ] **Step 4: Verify GREEN**

Run all sequence, markdown-source, and publish-rule tests.

- [ ] **Step 5: Commit**

```bash
git add src/business/publish-from-spu.ts src/business/publish-from-spu/publish-rule-text.ts docs/auto-listing/steps/10-publish.md docs/auto-listing/publish-rule-action-separation.md scripts/test-health-food-publish-sequence-rule.mjs scripts/test-publish-module-sequence-rule.mjs scripts/test-md-rule-source-separation.mjs
git commit -m "Orchestrate health food publishing"
```

### Task 7: Fail closed through Hermes and deep audit

**Files:**
- Modify: `src/autolist/batch-continuation-rules.ts`
- Modify: `src/business/publish-from-spu/publish-rules.ts`
- Modify: `src/cli/audit-auto-listing.ts`
- Modify: `scripts/test-progress-state.mjs`
- Modify: `scripts/test-deep-auto-listing-audit.mjs`
- Modify: `scripts/test-rule-closure-audit.mjs`
- Modify: `docs/auto-listing/stability-checklist.md`

- [ ] **Step 1: Write failing failure/reporting tests**

Add deterministic messages for missing health-food Feishu fields, missing exact health function, food-safety readback failure, spec replacement failure and packaging-label upload failure. Assert they stop the current batch, remain `not_checked`, preserve resume identity and appear in compact Hermes status.

- [ ] **Step 2: Verify RED**

Run progress and deep-audit tests.

- [ ] **Step 3: Implement classifications and audit dimensions**

Add health-food field/sequence checks to rules, contradictions, runtime and artifact dimensions. Do not classify deterministic configuration failures as retryable system faults.

- [ ] **Step 4: Verify GREEN**

Run the affected tests and `npm run audit:auto-listing -- --json`.

- [ ] **Step 5: Commit**

```bash
git add src/autolist/batch-continuation-rules.ts src/business/publish-from-spu/publish-rules.ts src/cli/audit-auto-listing.ts scripts/test-progress-state.mjs scripts/test-deep-auto-listing-audit.mjs scripts/test-rule-closure-audit.mjs docs/auto-listing/stability-checklist.md
git commit -m "Audit health food publish failures"
```

### Task 8: Verify software gates before changing runtime state

**Files:**
- No production changes unless verification exposes a defect

- [ ] **Step 1: Run full static and simulated gates**

```bash
npm run build
npm run rules:check
npm run doctor
npm run doctor:feishu
npm run doctor:auto-listing
npm run doctor:all
npm run simulate:representative
node scripts/check-dom-click-policy.mjs
```

- [ ] **Step 2: Run read-only real Feishu verification**

Run `feishu:fields` and `feishu:records` using the local config. Expected: one valid health-food record and no missing field.

- [ ] **Step 3: Run read-only Doudian DOM verification**

Attach to the current authenticated browser, inspect the platform SPU page and the target health-food create page, and save field-root evidence without modifying or submitting.

- [ ] **Step 4: Fix any mismatch through a new RED/GREEN cycle**

No workaround or coordinate fallback is allowed.

### Task 9: Retire the old batch and lock the new one

**Files:**
- Runtime-only changes under `data/auto-listing`, `input/auto-listing`; never commit them
- Test existing cleanup rules before destructive runtime cleanup

- [ ] **Step 1: Confirm no active controller/child process**

Run controller status and process checks. Stop if a real child is active.

- [ ] **Step 2: Inventory old batch artifacts**

Record old run ID, fingerprint, processed records, paid ledger state and archive locations.

- [ ] **Step 3: Preserve final archives and remove old runtime/intermediate artifacts**

Use project cleanup functions or a dedicated reviewed cleanup command. Remove the old pause signal, run/checkpoint/result/manifest/ledger and stale generated intermediates. Do not remove final unwatermarked archives.

- [ ] **Step 4: Start a new batch**

Run `npm run auto-listing:hermes-start`. It must refresh Feishu and lock exactly one health-food record with a new fingerprint.

- [ ] **Step 5: Audit runtime isolation**

Verify the previous six records do not appear in plan, manifest, resume candidates or status.

### Task 10: Perform the required real Doudian publish

**Files:**
- Runtime artifacts and evidence only

- [ ] **Step 1: Run the real one-product flow**

Use the newly locked batch. Do not manually substitute values. Allow the project to generate/reuse valid current-batch assets and publish according to the new category strategy.

- [ ] **Step 2: Inspect evidence per module**

Check DOM readback and screenshots for:

- title and short title;
- outer packaging;
- all food-safety values;
- exact health function;
- main/detail images and untouched excluded slots;
- template/manual-spec/specification result;
- prices and stock;
- service/fulfillment;
- packaging label;
- final submit result.

- [ ] **Step 3: Verify Hermes status matches runtime**

No stale progress or false completion is allowed.

- [ ] **Step 4: Run two independent deep audits**

```bash
npm run audit:auto-listing -- --json
npm run audit:auto-listing -- --json
```

- [ ] **Step 5: Final repository verification and push**

```bash
git diff --check
git status --short
rg -n 'Doubao|豆包|Jimeng|即梦|elementFromPoint|page\\.mouse\\.click|touchscreen' src scripts docs
git push origin master
```

Only tracked source, tests and docs may be pushed. Runtime data, credentials, browser profiles, cookies, generated images and archives remain untracked.
