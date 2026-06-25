import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluatePriceInventoryEntryRule,
  evaluateSpecTemplateCompletion,
  isMatchingSpecTemplateValue,
  resolveSpecTemplateKeywordCandidates,
  resolvePriceInventoryRowInputRoles
} from "../dist/src/business/publish-from-spu/publish-rules.js";

assert.deepEqual(resolveSpecTemplateKeywordCandidates("买二送一"), ["买二送一", "买2送1", "2送1"]);
assert.equal(isMatchingSpecTemplateValue("2送1", "买二送一"), true);
assert.equal(isMatchingSpecTemplateValue("买2送1四规格", "买二送一"), true);
assert.equal(isMatchingSpecTemplateValue("粉丝专享----买三送二", "买二送一"), false);

assert.deepEqual(
  evaluateSpecTemplateCompletion({
    selectedTemplate: "2送1",
    expectedTemplateKeyword: "买二送一",
    filledSpecValues: 4,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 0
  }),
  { passed: true, issue: "" }
);

assert.deepEqual(
  evaluateSpecTemplateCompletion({
    selectedTemplate: "单规格默认模板",
    expectedTemplateKeyword: "买二送一",
    filledSpecValues: 4,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 0
  }),
  {
    passed: false,
    issue: 'Spec template selection did not match required keyword. expectedKeyword=买二送一; selectedTemplate=单规格默认模板'
  },
  "template identity must block continuation even when SKU rows look complete"
);

assert.deepEqual(
  evaluateSpecTemplateCompletion({
    selectedTemplate: "",
    expectedTemplateKeyword: "买二送一",
    filledSpecValues: 0,
    expectedSpecValues: 4,
    priceRows: 4,
    blankSpecValueInputs: 1
  }),
  { passed: true, issue: "" },
  "empty selected-template readback must not block when template-generated price rows prove completion"
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
    selectedTemplate: "久光小泽",
    expectedTemplateKeyword: "久光小泽",
    filledSpecValues: 3,
    expectedSpecValues: 4,
    priceRows: 3,
    blankSpecValueInputs: 1
  }),
  { passed: true, issue: "" },
  "selected spec templates are authoritative; blank placeholder spec-value inputs must not be filled or deleted"
);

assert.deepEqual(
  evaluateSpecTemplateCompletion({
    selectedTemplate: "久光小泽",
    expectedTemplateKeyword: "久光小泽",
    filledSpecValues: 0,
    expectedSpecValues: 4,
    priceRows: 0,
    blankSpecValueInputs: 1
  }),
  { passed: true, issue: "" },
  "a selected required spec template must not fail solely because Doudian keeps a blank placeholder spec-value input"
);

assert.deepEqual(
  evaluatePriceInventoryEntryRule({
    specIssue: ""
  }),
  {
    action: "apply_price_inventory",
    issue: ""
  },
  "blank placeholder spec-value inputs must not become a price-inventory blocking issue"
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

const publishSource = [
  fs.readFileSync("src/business/publish-from-spu.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/basic-info-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/spec-service-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/service-fulfillment-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/price-inventory-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/publish-section-navigation.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/spec-template-mode.ts", "utf8")
].join("\n");
const publishActionSource = [
  publishSource,
  fs.readFileSync("src/business/publish-from-spu/actions/basic-info-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/actions/graphic-info-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/actions/spec-price-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/actions/service-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/actions/submit-action.ts", "utf8")
].join("\n");
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
  /const detachedRows = allRows[\s\S]*placeholder\.includes\("请输入库存"\)[\s\S]*placeholder\.includes\("请输入erp编码"\)[\s\S]*return detachedRows;/,
  "price/inventory row discovery must support Doudian's split table DOM where header and SKU rows are not in the same table"
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
  /clickVisibleText\(page, "\\u5c55\\u5f00\\u66f4\\u591a"\)[\s\S]*setBasicPublishFieldValue\(page, "modelSpec"/,
  "model spec filling must expand hidden category attributes before setting the input through DOM field structure"
);

assert.match(
  publishSource,
  /async function setBasicPublishFieldValue[\s\S]*document\.querySelector\(`\[attr-field-id="\$\{fieldId\}"\]`\)[\s\S]*fieldAliases\.some/,
  "basic-info fields must be selected by attr-field-id or visible label structure, not viewport coordinates"
);

assert.match(
  publishSource,
  /if \(!\(await setBasicPublishFieldValue\(page, "modelSpec", metadata\.modelSpec\)\)\) \{\s*throw new Error\("Model spec input not found on publish page\."\);\s*\}/,
  "model spec filling must not silently continue when the required model spec input is absent"
);

assert.match(
  publishSource,
  /async function readBasicPublishCompletionOnPage/,
  "publish flow must read back basic-info completion from the page, not only remember attempted fill actions"
);
assert.match(
  publishSource,
  /setBasicPublishFieldValue[\s\S]*const labels = Array\.from\(document\.querySelectorAll\("body \*"\)\)[\s\S]*fieldAliases\.some/,
  "basic-info input location must fall back to visible label structure when attr-field-id is missing"
);

assert.match(
  publishActionSource,
  /assertBasicPublishCompletionOnPage\([\s\S]*before_graphic_module/,
  "publish flow must gate entry into graphic/image module on completed basic info"
);

assert.match(
  publishActionSource,
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
  /evaluateSpecTemplateCompletion\(\{\s*selectedTemplate,\s*expectedTemplateKeyword: keyword,/,
  "template verification must pass the selected template text and required keyword into the rule layer"
);
assert.match(
  publishSource,
  /async function readSpecTemplateSelectedValue/,
  "spec template verification must use a dedicated selected-template readback instead of freight-template dropdown heuristics"
);
assert.match(
  publishSource,
  /readSpecTemplateSelectedValue\(page, keyword\)/,
  "spec template application must read back the selected spec-template control text after choosing"
);
assert.match(
  publishSource,
  /function resolveSpecTemplateKeyword\(title\?: string\)[\s\S]*SPEC_TEMPLATE_KEYWORD_JIUGUANG[\s\S]*SPEC_TEMPLATE_KEYWORD_DEFAULT/,
  "spec template target keyword must keep the current title rule: 久光小泽 titles use 久光小泽, all others use 买二送一"
);
assert.match(
  publishSource,
  /async function chooseSpecTemplateKeywordFromDropdown/,
  "spec template selection must use a dedicated goods-spec template dropdown path"
);
assert.match(
  publishSource,
  /async function findSpecTemplateFieldRootOnPage[\s\S]*商品规格[\s\S]*规格模板/,
  "spec template input discovery must be scoped by DOM structure from 商品规格 to the 规格模板 field root"
);
assert.match(
  publishSource,
  /async function findSpecTemplateInputInFieldRootOnPage[\s\S]*input\[type='search'\], input\[role='combobox'\], input\[type='text'\], input:not\(\[type\]\)/,
  "spec template input discovery must search inside the field root DOM instead of relying on a global input index"
);
assert.match(
  publishSource,
  /async function isSpecTemplateSmartFillUploadModeVisible[\s\S]*智能填写助手[\s\S]*切换手动填写[\s\S]*点击 或 拖动 文件到虚线框内上传/,
  "spec template readiness must explicitly detect the AI smart-fill upload mode before looking for template controls"
);
const autoListPublishSource = fs.readFileSync("src/autolist/publish.ts", "utf8");
const specTemplateModeSource = fs.readFileSync("src/business/publish-from-spu/spec-template-mode.ts", "utf8");
assert.doesNotMatch(
  autoListPublishSource,
  /quarantinedShopFailures|shouldQuarantineShopAfterPublishFailure/,
  "A missing shop template must stop and report the batch instead of silently skipping later targets in that shop"
);
assert.match(
  publishSource,
  /async function clickSpecTemplateOptionByDomStructure/,
  "spec template option clicking must use the currently opened dropdown/menu DOM structure"
);
assert.match(
  publishSource,
  /const specTemplateOptionMarker[\s\S]*setAttribute\(markerName, "true"\)[\s\S]*page\.locator\(`\[\$\{specTemplateOptionMarker\}="true"\]`\)\.first\(\)\.click/,
  "spec template option clicking must mark the currently visible dropdown option before Playwright clicks it"
);
assert.match(
  publishSource,
  /async function clickSpecTemplateOptionByDomStructure[\s\S]*const text = await markVisibleSpecTemplateOption\(page, keywords\)[\s\S]*if \(text\) \{[\s\S]*click\(\{ timeout: 1000 \}\)[\s\S]*return text;[\s\S]*return "";/,
  "spec template option clicking must immediately click a visible matching option without pre-click polling hesitation"
);
assert.doesNotMatch(
  publishSource.slice(
    publishSource.indexOf("async function clickSpecTemplateOptionByDomStructure"),
    publishSource.indexOf("async function chooseSpecTemplateKeywordFromDropdown")
  ),
  /for \(let attempt|waitForTimeout/,
  "visible spec template option clicking must not poll or sleep before clicking"
);
assert.match(
  publishSource,
  /const visibleClickedText = await clickSpecTemplateOptionByDomStructure\(page, candidates\)[\s\S]*if \(isMatchingSpecTemplateValue\(visibleClickedText, keyword\)\) \{[\s\S]*return visibleClickedText;[\s\S]*const input = await findSpecTemplateInputInFieldRootOnPage\(page\)/,
  "spec template selection must atomically click an already visible matching template option before typing into the search input"
);
assert.match(
  publishSource.slice(
    publishSource.indexOf("async function chooseSpecTemplateKeywordFromDropdown"),
    publishSource.indexOf("async function scrollMainFormContainerToBottom")
  ),
  /const candidates = resolveSpecTemplateKeywordCandidates\(keyword\);[\s\S]*const visibleClickedText = await clickSpecTemplateOptionByDomStructure\(page, candidates\);[\s\S]*const input = await findSpecTemplateInputInFieldRootOnPage\(page\);/,
  "spec template selection must try the already-visible dropdown option before searching for the template input"
);
assert.doesNotMatch(
  publishSource,
  /innerText\(\{ timeout: 3000 \}\)[\s\S]*click\(\{ timeout: 3000 \}\)/,
  "spec template option clicking must not wait on broad hidden locator candidates before clicking a visible option"
);
assert.match(
  publishSource,
  /const clickedText = await clickSpecTemplateOptionByDomStructure\(page, candidates\)[\s\S]*if \(!isMatchingSpecTemplateValue\(clickedText, keyword\)\) \{[\s\S]*continue;[\s\S]*return clickedText;/,
  "spec template selection must return the clicked matching option text without waiting for template expansion"
);
assert.match(
  publishSource,
  /async function ensureManualPriceInventoryRowsAfterSpecTemplateOnPage[\s\S]*clickSwitchManualSpecEntryMode\(page\)[\s\S]*countVisiblePriceInventoryRows\(page\)[\s\S]*readCurrentSpecValuesStrict\(page\)/,
  "spec template expansion evidence must be checked only after clicking the post-template manual-fill switch"
);
assert.doesNotMatch(
  publishSource.slice(
    publishSource.indexOf("async function chooseSpecTemplateKeywordFromDropdown"),
    publishSource.indexOf("async function scrollMainFormContainerToBottom")
  ),
  /waitForTimeout\(3000\)/,
  "spec template dropdown selection must not impose a fixed 3 second delay after clicking a matching option"
);
assert.doesNotMatch(
  publishSource,
  /async function waitForSpecTemplateSelectionConfirmation|waitForSpecTemplateReadback\(page\)|Spec template readback did not match keyword after selection/,
  "spec template selection must not add confirmation/readback polling or fail solely because selected-value readback is empty"
);
assert.match(
  specTemplateModeSource,
  /function clickSwitchManualSpecEntryMode[\s\S]*智能填写助手[\s\S]*切换手动填写[\s\S]*点击 或 拖动 文件到虚线框内上传[\s\S]*querySelectorAll\("button, \[role='button'\], a, body \*"\)/,
  "switching out of Doudian smart-fill mode must target the smart-fill DOM structure, not a generic global text click"
);
assert.match(
  specTemplateModeSource,
  /const switchManualSpecEntryMarker[\s\S]*page\.locator\(`\[\$\{switchManualSpecEntryMarker\}="true"\]`\)\.first\(\)[\s\S]*click\(\{ timeout: 3000 \}\)/,
  "manual-mode switching must mark the real switch control and click it through Playwright locator action"
);
assert.doesNotMatch(
  specTemplateModeSource.slice(specTemplateModeSource.indexOf("function clickSwitchManualSpecEntryMode")),
  /\.click\(\);|getByText/,
  "manual-mode switching must not use synthetic DOM click or Playwright global text lookup"
);
const applySpecTemplateSource = publishSource.slice(
  publishSource.indexOf("async function applySpecTemplateWithVerificationOnPage"),
  publishSource.indexOf("async function readSpecModuleErrorOnPage")
);
const chooseSpecTemplateSource = publishSource.slice(
  publishSource.indexOf("async function findSpecTemplateFieldRootOnPage"),
  publishSource.indexOf("async function scrollMainFormContainerToBottom")
);
assert.doesNotMatch(
  chooseSpecTemplateSource,
  /getByText|chooseKeywordFromSearchDropdown/,
  "spec template selection must not fall back to global text search or the generic dropdown helper"
);
assert.doesNotMatch(
  chooseSpecTemplateSource,
  /score|dispatchDomClickAtPoint|findSpecTemplateSearchInputIndex|getBoundingClientRect\(\)\.x|getBoundingClientRect\(\)\.y/,
  "spec template selection must not use coordinate clicks, scoring, or global input indexes"
);
assert.doesNotMatch(
  applySpecTemplateSource,
  /chooseDynamicSpecTemplateOnPage\(page, title\)\.catch/,
  "spec template selection failures must not be swallowed and deferred to price/inventory checks"
);
assert.doesNotMatch(
  fs.readFileSync("src/business/publish-from-spu/actions/spec-price-action.ts", "utf8"),
  /gotoWithTolerance\(page, createPageUrl, 3500\)[\s\S]*shouldRetryFromSpecTemplate: true/,
  "spec-template failures must not reload the create page and replay basic-info entry from the beginning"
);
assert.doesNotMatch(
  applySpecTemplateSource,
  /removeBlankSpecValueInputsFromTemplate|removeOneBlankSpecValueInput/,
  "spec template flow must not fill or delete blank placeholder spec values; template content is authoritative"
);

assert.match(
  publishSource,
  /scrollLabelIntoView\(page, "商品规格"\)[\s\S]*scrollLabelIntoView\(page, "规格模板"\)/,
  "spec template and manual switch setup must scroll by current goods-spec structure labels"
);

assert.match(
  publishSource,
  /applySpecTemplateWithVerificationOnPage[\s\S]*chooseDynamicSpecTemplateOnPage\(page, title\)[\s\S]*ensureManualPriceInventoryRowsAfterSpecTemplateOnPage\(page\)/,
  "spec template application must choose the dropdown template first, then switch manual mode and expand price/inventory rows"
);
const switchManualSpecEntrySource = fs.readFileSync("src/business/publish-from-spu/spec-template-mode.ts", "utf8");
assert.match(
  switchManualSpecEntrySource,
  /clickSwitchManualSpecEntryMode[\s\S]*page\.locator\(`\[\$\{switchManualSpecEntryMarker\}="true"\]`\)\.first\(\)\.click[\s\S]*isSpecTemplateSmartFillUploadModeVisible\(page\)/,
  "manual spec switch action must verify the smart-fill upload surface disappears after clicking"
);
assert.match(
  switchManualSpecEntrySource,
  /return !\(await isSpecTemplateSmartFillUploadModeVisible\(page\)\.catch\(\(\) => true\)\)/,
  "manual spec switch action must return false when click does not leave smart-fill upload mode"
);
assert.match(
  publishSource,
  /async function ensurePriceInventorySectionReady[\s\S]*isSpecTemplateSmartFillUploadModeVisible\(page\)[\s\S]*clickSwitchManualSpecEntryMode\(page\)[\s\S]*countVisiblePriceInventoryRows\(page\)/,
  "price/inventory entry must switch out of Doudian smart-fill upload mode before looking for price/stock rows"
);
assert.match(
  publishSource,
  /async function ensureManualPriceInventoryRowsAfterSpecTemplateOnPage[\s\S]*isSpecTemplateSmartFillUploadModeVisible\(page\)[\s\S]*clickSwitchManualSpecEntryMode\(page\)[\s\S]*countVisiblePriceInventoryRows\(page\)/,
  "after selecting the spec template, the action must immediately switch smart-fill to manual mode and wait for price/inventory rows"
);
assert.match(
  publishSource,
  /async function ensureManualPriceInventoryRowsAfterSpecTemplateOnPage[\s\S]*for \(let attempt = 0; attempt < 20; attempt \+= 1\)[\s\S]*countVisiblePriceInventoryRows\(page\)[\s\S]*await page\.waitForTimeout\(250\)/,
  "after selecting the spec template, the action must wait in-place for Doudian to expand template price/inventory rows instead of failing into whole-flow retry"
);
assert.match(
  applySpecTemplateSource,
  /chooseDynamicSpecTemplateOnPage\(page, title\)[\s\S]*ensureManualPriceInventoryRowsAfterSpecTemplateOnPage\(page\)[\s\S]*const visiblePriceRows = await countVisiblePriceInventoryRows\(page\)/,
  "spec template application must not evaluate completion until manual price/inventory rows are visible after template selection"
);
assert.doesNotMatch(
  applySpecTemplateSource,
  new RegExp(`${"ensureManual"}${"SpecTemplateEntryModeOnPage"}\\(page\\)[\\s\\S]*chooseDynamicSpecTemplateOnPage\\(page, title\\)`),
  "spec template application must not require manual-entry mode before selecting the spec-template dropdown"
);
assert.doesNotMatch(
  applySpecTemplateSource,
  /ensureManualPriceInventoryRowsAfterSpecTemplateOnPage\(page\)[\s\S]*catch[\s\S]*continue;/,
  "after a spec template is selected, manual-mode readiness must not loop back and click the spec template again"
);
assert.doesNotMatch(
  applySpecTemplateSource,
  /for \(let attempt = 0; attempt < 2; attempt \+= 1\)[\s\S]*chooseDynamicSpecTemplateOnPage\(page, title\)/,
  "spec template application must choose the template once, then switch manual mode and proceed to price/stock entry"
);
assert.doesNotMatch(
  publishSource,
  /throw new Error\("Manual spec template entry mode was not visible after clicking 切换手动填写\."\)/,
  "manual spec setup failures must be classified as spec-template control readiness, not hard-coded to a legacy switch click"
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
