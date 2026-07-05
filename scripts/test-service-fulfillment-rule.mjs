import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluateServiceFulfillmentCompletion,
  evaluateShippingBeforePriceInventoryCompletion,
  resolvePublishCheckBlockingFields
} from "../dist/src/business/publish-from-spu/publish-rules.js";

const publishSource = [
  fs.readFileSync("src/business/publish-from-spu/spec-service-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/service-fulfillment-page-action.ts", "utf8")
].join("\n");
const navigationSource = fs.readFileSync("src/business/publish-from-spu/publish-section-navigation.ts", "utf8");
const serviceActionSource = fs.readFileSync("src/business/publish-from-spu/actions/service-action.ts", "utf8");
const freightTemplateOptionClickSource = publishSource.slice(
  publishSource.indexOf("async function clickFreightTemplateDropdownOption"),
  publishSource.indexOf("async function waitForFreightTemplateReadback")
);
const chooseFreightTemplateSource = publishSource.slice(
  publishSource.indexOf("export async function chooseKeywordFreightTemplate"),
  publishSource.indexOf("function resolveSpecTemplateKeyword")
);
const radioOptionClickSource = publishSource.slice(
  publishSource.indexOf("async function clickRadioOptionNearFieldLabel"),
  publishSource.indexOf("async function isRadioOptionSelectedNearFieldLabel")
);
const beforeFirstFreightDropdownClick = chooseFreightTemplateSource.slice(0, chooseFreightTemplateSource.indexOf("clickTarget.click"));

assert.match(
  serviceActionSource,
  /before_service_module/,
  "publish flow must re-check basic info before entering service fulfillment"
);
assert.match(
  publishSource,
  /readVisibleFreightTemplateOptionTexts[\s\S]*slice\(0, 6\)/,
  "freight-template failure feedback must show a short option summary, not the whole page text"
);
assert.match(
  publishSource,
  /const freightTemplateOptionMarker[\s\S]*setAttribute\(markerName, "true"\)[\s\S]*page\.locator\(`\[\$\{freightTemplateOptionMarker\}="true"\]`\)\.first\(\)\.click/,
  "freight-template option clicking must mark a visible option and click it through Playwright"
);
assert.match(
  publishSource,
  /async function waitForFreightTemplateReadback[\s\S]*readLabeledSelectValue\(page, "\\u8fd0\\u8d39\\u6a21\\u677f"\)[\s\S]*readServiceFreightTemplateValue\(page\)/,
  "freight-template selection must wait on concrete selected-value readback instead of stacked fixed delays"
);
assert.doesNotMatch(
  publishSource.slice(
    publishSource.indexOf("async function revealFreightTemplateControl"),
    publishSource.indexOf("async function readFreightTemplateValue")
  ),
  /for \(let attempt|scrollMainFormContainerToTop|scrollPublishSectionContentIntoView|scrollLabelIntoView\(page, "\\u8fd0\\u8d39\\u6a21\\u677f"\)|waitForTimeout/,
  "freight-template reveal must not loop through page up/down positioning before clicking the service-field DOM control"
);
assert.doesNotMatch(
  navigationSource.slice(
    navigationSource.indexOf("export async function ensureServiceSectionReady"),
    navigationSource.length
  ),
  /findLabelAbsoluteTop|scrollLabelIntoView\(page, "\\u8fd0\\u8d39\\u6a21\\u677f"\)|waitForTimeout\(500\)/,
  "service section readiness must not do extra freight-label positioning or fixed waits before the dropdown click"
);
assert.match(
  publishSource,
  /async function findFreightTemplateFieldRootOnPage[\s\S]*服务与履约[\s\S]*运费模板[\s\S]*setAttribute\(attributeName, "true"\)/,
  "freight-template selection must anchor to the 服务与履约/运费模板 field root"
);
assert.match(
  publishSource,
  /async function findFreightTemplateDropdownClickTargetOnPage[\s\S]*findFreightTemplateFieldRootOnPage[\s\S]*\.ecom-g-select-selector/,
  "freight-template dropdown opening must use the field-root control instead of global label scoring"
);
assert.doesNotMatch(
  chooseFreightTemplateSource,
  /clickDropdownControlByLabelDirect|clickLabeledSelect|chooseNonFreeShippingTemplate/,
  "freight-template keyword selection must not fall back to global label-scored dropdown clicks"
);
assert.doesNotMatch(
  beforeFirstFreightDropdownClick,
  /dismissTransientOverlays|readLabeledSelectValue|waitForFreightTemplateReadback/,
  "freight-template selection must open the field-root dropdown immediately before any overlay cleanup or readback"
);
assert.doesNotMatch(
  freightTemplateOptionClickSource,
  /clickable\?*\.click\(\)/,
  "freight-template selection must not use synthetic DOM click for the critical option choice"
);
assert.match(
  radioOptionClickSource,
  /setAttribute\(markerName, "true"\)[\s\S]*page\.locator\(`\[\$\{radioOptionMarker\}="true"\]`\)\.first\(\)\.click/,
  "shipping radio option selection must mark the field-scoped option and click it through Playwright"
);
assert.doesNotMatch(
  radioOptionClickSource,
  /candidate\.el\.click\(\)/,
  "shipping radio option selection must not use synthetic DOM click because it can report success without updating the component state"
);
assert.doesNotMatch(
  freightTemplateOptionClickSource,
  /for \(let attempt|waitForTimeout/,
  "freight-template option clicking must be a single atomic visible-option click without pre-click polling"
);
assert.doesNotMatch(
  publishSource,
  /page\.mouse\.wheel/,
  "service/spec price fulfillment actions must use DOM label anchoring instead of large wheel scrolling"
);
assert.match(
  publishSource,
  /async function applyShippingSelectionOnPage[\s\S]*evaluateShippingBeforePriceInventoryCompletion[\s\S]*export async function applyShippingBeforePriceInventoryOnPage[\s\S]*ensurePublishSectionTab\(page, "\\u4ef7\\u683c\\u5e93\\u5b58"\)[\s\S]*scrollLabelIntoView\(page, "\\u53d1\\u8d27\\u6a21\\u5f0f"\)[\s\S]*applyShippingSelectionOnPage\(page\)/,
  "shipping mode and 48-hour shipping time must be completed and read back inside the price-inventory module before price rows"
);
assert.match(
  publishSource,
  /const SHIPPING_TIME_FIELD_LABEL_CANDIDATES[\s\S]*"\\u73b0\\u8d27\\u53d1\\u8d27\\u65f6\\u95f4"[\s\S]*"\\u53d1\\u8d27\\u65f6\\u95f4"[\s\S]*"\\u627f\\u8bfa\\u53d1\\u8d27\\u65f6\\u95f4"/,
  "shipping-time selection must support Doudian label variants instead of only 现货发货时间"
);
assert.match(
  publishSource,
  /const SHIPPING_TIME_OPTION_TEXT_CANDIDATES[\s\S]*"48\\u5c0f\\u65f6"[\s\S]*"48\\u5c0f\\u65f6\\u5185\\u53d1\\u8d27"[\s\S]*"\\u6b21\\u65e5\\u53d1"/,
  "shipping-time selection must support option text variants and the platform default 次日发"
);
assert.match(
  publishSource,
  /return radioContainers\(fieldRoot\)\.some\(\(el\) => matchesOption\(el\) && isSelected\(el\)\)/,
  "shipping-time readback must accept any selected valid option inside the parsed field root"
);
assert.match(
  publishSource,
  /async function ensureRadioOptionNearFieldLabelCandidates[\s\S]*for \(let attempt = 0; attempt < 3; attempt \+= 1\)[\s\S]*isRadioOptionSelectedNearFieldLabelCandidate[\s\S]*clickRadioOptionNearFieldLabelCandidate/,
  "shipping radio selection must retry candidate label/option pairs with readback instead of failing after one exact lookup"
);
assert.match(
  radioOptionClickSource,
  /function findFieldRoot[\s\S]*label\.parentElement[\s\S]*hasMatchingOption\(node\)/,
  "shipping radio clicks must resolve the field root from the label DOM ancestry instead of ranked global candidates"
);
assert.doesNotMatch(
  radioOptionClickSource,
  /score|sort\(/,
  "shipping radio clicks must not use scoring or sorted global guesses"
);
assert.doesNotMatch(
  publishSource.slice(
    publishSource.indexOf("async function isRadioOptionSelectedNearFieldLabelCandidate"),
    publishSource.indexOf("async function ensureRadioOptionNearFieldLabel")
  ),
  /score|sort\(/,
  "shipping radio readback must parse the field DOM structure without scoring"
);
assert.match(
  publishSource,
  /function isOptionTextMatch[\s\S]*text\.includes\(targetOptionText\)/,
  "shipping radio option matching must allow longer Doudian labels that include the requested value"
);
assert.match(
  publishSource,
  /export async function applyFixedSpecsOnPage[\s\S]*ensurePublishSectionTab\(page, "\\u4ef7\\u683c\\u5e93\\u5b58"\)[\s\S]*scrollLabelIntoView\(page, "\\u5546\\u54c1\\u89c4\\u683c"\)/,
  "spec setup must position by the 商品规格 label instead of scrolling past the price-inventory module"
);
assert.doesNotMatch(
  publishSource,
  /await page\.waitForTimeout\(600\);[\s\S]*clickFreightTemplateDropdownOption\(page, keyword\)[\s\S]*await page\.waitForTimeout\(800\)[\s\S]*await page\.waitForTimeout\(400\)/,
  "freight-template selection must not keep the old stacked waits after opening the dropdown"
);

assert.deepEqual(
  evaluateShippingBeforePriceInventoryCompletion({
    shippingModeSelected: true,
    shippingTimeSelected: true
  }),
  { passed: true, issue: "" }
);

assert.deepEqual(
  evaluateShippingBeforePriceInventoryCompletion({
    shippingModeSelected: true,
    shippingTimeSelected: false
  }),
  {
    passed: false,
    issue: "Missing price-inventory precondition fields: shippingTime"
  }
);

assert.deepEqual(
  evaluateServiceFulfillmentCompletion({
    shippingModeSelected: true,
    shippingTimeSelected: true,
    productStatusSelected: true,
    freightTemplateName: "延草运费模板"
  }),
  { passed: true, issue: "" }
);

assert.deepEqual(
  evaluateServiceFulfillmentCompletion({
    shippingModeSelected: true,
    shippingTimeSelected: false,
    productStatusSelected: true,
    freightTemplateName: "延草运费模板"
  }),
  {
    passed: false,
    issue: "Missing configured fields: shippingTime"
  }
);

assert.deepEqual(
  evaluateServiceFulfillmentCompletion({
    shippingModeSelected: true,
    shippingTimeSelected: true,
    productStatusSelected: true,
    freightTemplateName: ""
  }),
  {
    passed: false,
    issue: "Freight template was not selected. Missing configured fields: freightTemplate"
  }
);

assert.deepEqual(
  resolvePublishCheckBlockingFields({
    blockingFields: ["白底图", "主图3:4", "型号规格", "价格", "现货库存", "运费模板", "医疗器械注册证"],
    completedFields: ["modelSpec"],
    filledPriceRows: 4,
    freightTemplateName: "延草运费模板"
  }),
  ["型号规格", "价格", "现货库存", "运费模板", "医疗器械注册证"],
  "Doudian fill-check may ignore optional image slots, but must not hide hard DOM blockers using stale in-memory completion state"
);

assert.deepEqual(
  resolvePublishCheckBlockingFields({
    blockingFields: ["白底图", "商品标题"],
    completedFields: [],
    filledPriceRows: 0,
    freightTemplateName: ""
  }),
  ["商品标题"],
  "optional graphic slot filtering must not hide real publish blocking fields"
);

console.log("service fulfillment rule passed");
