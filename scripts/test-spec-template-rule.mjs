import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluatePriceInventoryEntryRule,
  evaluateSpecTemplateCompletion
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
