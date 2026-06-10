import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluatePriceInventoryEntryRule,
  evaluateSpecTemplateCompletion,
  resolvePriceInventoryRowInputRoles
} from "../src/business/publish-from-spu/publish-rules.ts";

assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 4,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 0
  }),
  { passed: true, issue: "" }
);

assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 4,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 1
  }),
  { passed: true, issue: "" }
);

assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 3,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 1
  }),
  { passed: true, issue: "" },
  "template-generated price rows are the authoritative signal; blank placeholder spec inputs must not block"
);

assert.deepEqual(
  evaluateSpecTemplateCompletion({
    filledSpecValues: 3,
    expectedSpecValues: 4,
    priceRows: 3,
    blankSpecValueInputs: 1
  }),
  {
    passed: false,
    issue: "Spec template left 1 blank required spec value input(s)."
  }
);

assert.deepEqual(
  evaluatePriceInventoryEntryRule({
    specIssue: "Spec template left 1 blank required spec value input(s)."
  }),
  {
    action: "block_until_spec_template_complete",
    issue: "Spec template left 1 blank required spec value input(s)."
  }
);

assert.deepEqual(
  resolvePriceInventoryRowInputRoles([
    {
      placeholder: "请输入",
      context: "￥ 请输入",
      centerX: 620
    },
    {
      placeholder: "请输入库存",
      context: "现货库存 请输入库存",
      centerX: 780
    },
    {
      placeholder: "请输入erp编码",
      context: "商家编码 请输入erp编码",
      centerX: 1330
    }
  ]),
  { priceIndex: 0, stockIndex: 1 },
  "price/inventory rows must treat the first editable non-code input as price even when its placeholder is only 请输入"
);

const publishSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
for (const obsoleteAction of [
  "createFixedSpecTypeAndValues",
  "fillSpecEditorText",
  "openSpecTypeDropdown",
  "FIXED_SPEC_NAME"
]) {
  assert.equal(
    publishSource.includes(obsoleteAction),
    false,
    `obsolete manual spec editing action must be removed: ${obsoleteAction}`
  );
}

assert.match(
  publishSource,
  /rect\.left >= 420[\s\S]*rect\.top >= 240/,
  "publish section visibility must be scoped to the main form, not sidebar errors or top tabs"
);
assert.match(
  publishSource,
  /readVisiblePriceInventoryRowTargets[\s\S]*fillVisiblePriceInventoryRowByTableDom/,
  "price/inventory action must read and write through the same visible table-row target model"
);
assert.match(
  publishSource,
  /fillVisiblePriceInventoryRowByTableDom[\s\S]*scrollIntoView\(\{ block: "center"/,
  "price/inventory action must center each target row before filling so sticky footers do not cover bottom rows"
);
assert.equal(
  /rowRect\.top >= window\.innerHeight/.test(publishSource),
  false,
  "price/inventory row discovery must not use viewport visibility as the SKU row count; offscreen rows must still be filled"
);

assert.match(
  publishSource,
  /if \(activeTab === text\) \{\s*return;\s*\}/,
  "publish section activation should not fail when the exact target tab is already active"
);

assert.match(
  publishSource,
  /clickVisibleText\(page, "\\u5c55\\u5f00\\u66f4\\u591a"\)[\s\S]*findModelSpecInputCenter/,
  "model spec filling must expand hidden category attributes before locating the input"
);

const findModelSpecStart = publishSource.indexOf("async function findModelSpecInputCenter");
const findModelSpecEnd = publishSource.indexOf("async function clearAndTypeAtCenter", findModelSpecStart);
const findModelSpecSource = publishSource.slice(findModelSpecStart, findModelSpecEnd);
assert.match(
  findModelSpecSource,
  /scrollIntoView/,
  "model spec input must be scrolled into the viewport before returning a click center"
);

assert.match(
  publishSource,
  /if \(!modelSpecCenter\) \{\s*throw new Error\("Model spec input not found on publish page\."\);\s*\}/,
  "model spec filling must not silently continue when the required model spec input is absent"
);

assert.match(
  publishSource,
  /async function readBasicPublishCompletionOnPage/,
  "publish flow must read back basic-info completion from the page, not only remember attempted fill actions"
);

assert.match(
  publishSource,
  /assertBasicPublishCompletionOnPage\([\s\S]*before_graphic_module/,
  "publish flow must gate entry into graphic/image module on completed basic info"
);

assert.match(
  publishSource,
  /assertBasicPublishCompletionOnPage\([\s\S]*before_price_inventory_module/,
  "publish flow must re-check earlier basic info before entering price/inventory"
);

assert.doesNotMatch(
  publishSource,
  /async function readSpecModuleErrorOnPage[\s\S]*document\.body\.innerText[\s\S]*knownErrors/,
  "spec module error detection must be scoped to the goods spec module, not global sidebar/basic-info errors"
);

assert.match(
  publishSource,
  /const initialRule = evaluateSpecTemplateCompletion[\s\S]*if \(initialRule\.passed[\s\S]*\)/,
  "template verification must accept a completed template before deleting blank placeholder spec inputs"
);

assert.match(
  publishSource,
  /async function isManualSpecTemplateEntryModeVisible[\s\S]*商品规格[\s\S]*规格模板[\s\S]*添加规格类型[\s\S]*规格预览[\s\S]*价格与库存[\s\S]*现货库存/,
  "price/inventory spec setup must structurally detect the current manual goods-spec module, not depend only on legacy switch text"
);
assert.match(
  publishSource,
  /scrollLabelIntoView\(page, "商品规格"\)[\s\S]*scrollLabelIntoView\(page, "规格模板"\)/,
  "manual spec setup must scroll by current goods-spec structure labels"
);

assert.match(
  publishSource,
  /ensureManualSpecTemplateEntryModeOnPage\(page\)[\s\S]*applySpecTemplateWithVerificationOnPage/,
  "spec template application must wait for manual spec template mode before choosing a template"
);

for (const forbiddenSpecTypeAction of [
  "ensureProductSpecTypeNameOnPage",
  "clickProductSpecTypeControlOnPage",
  "Required goods spec type",
  "REQUIRED_PRODUCT_SPEC_TYPE_NAME"
]) {
  assert.equal(
    publishSource.includes(forbiddenSpecTypeAction),
    false,
    `goods spec template flow must not override or require the template spec type name: ${forbiddenSpecTypeAction}`
  );
}

console.log("spec template rule passed");
