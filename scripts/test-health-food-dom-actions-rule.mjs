import assert from "node:assert/strict";
import fs from "node:fs";

const modulePath = "src/business/publish-from-spu/health-food-actions.ts";
assert.ok(fs.existsSync(modulePath), "health-food DOM action module must exist");

const source = fs.readFileSync(modulePath, "utf8");
const publishSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

for (const exportName of [
  "fillHealthFoodSafetyAttributesOnPage",
  "fillHealthFoodCategoryAttributesOnPage",
  "uploadHealthFoodOuterPackagingOnPage",
  "applyHealthFoodSpecificationOnPage",
  "uploadHealthFoodPackagingLabelOnPage",
  "findHealthFoodFieldRootByLabel",
  "fillHealthFoodTextFieldOnPage",
  "selectHealthFoodExactOptionOnPage",
  "checkHealthFunctionOptionOnPage",
  "uploadHealthFoodFileInFieldOnPage",
  "waitForHealthFoodFieldLabelOnPage"
]) {
  assert.match(source, new RegExp(`export\\s+async\\s+function\\s+${exportName}\\b`), `missing exported action ${exportName}`);
}

assert.match(
  source,
  /import type \{[^}]*Locator[^}]*Page[^}]*\} from "playwright"/,
  "health-food actions should use Playwright Page/Locator types without importing browser lifecycle code"
);

assert.match(
  source,
  /interface HealthFood[A-Za-z]+ReadbackResult|type HealthFood[A-Za-z]+ReadbackResult/,
  "every health-food action must return a typed readback result"
);

assert.match(
  source,
  /markFieldRootByVisibleLabel[\s\S]*closest\(/,
  "field roots must be located by visible labels and DOM ancestry"
);
assert.match(
  source,
  /markFieldRootByVisibleLabel[\s\S]*textContent[\s\S]*label/,
  "field root lookup must be label-driven"
);
assert.match(
  source,
  /markFieldRootByVisibleLabel[\s\S]*const exactFieldRoots[\s\S]*querySelectorAll\("\[attr-field-id\]"\)[\s\S]*getAttribute\("attr-field-id"\)\s*===\s*labelText[\s\S]*exactFieldRoots\[0\]\.setAttribute[\s\S]*const labels =/,
  "field root lookup must prefer an exact attr-field-id match before scanning duplicate visible label text"
);

assert.match(source, /\.fill\(/, "text actions must fill fields through locators");
assert.match(source, /inputValue\(/, "text actions must read back input values after fill");
assert.match(
  source,
  /fillHealthFoodTextFieldOnPage[\s\S]*currentReadback[\s\S]*normalizeDomText\(currentReadback\)\s*===\s*normalizeDomText\(value\)[\s\S]*changed:\s*false[\s\S]*\.fill\([\s\S]*press\("Tab"[\s\S]*waitForTimeout\(3000\)[\s\S]*inputValue[\s\S]*changed:\s*true/,
  "text actions must skip exact existing values; changed values must blur with Tab and verify again after 3 seconds"
);

assert.doesNotMatch(
  source,
  /page\.getByText\([^)]*optionText[\s\S]{0,180}\.click/,
  "select actions must not fall back to clicking arbitrary page body text"
);
assert.match(
  source,
  /role='listbox'[\s\S]*role='option'[\s\S]*normalizeDomText\([\s\S]*optionText/,
  "select actions must restrict exact matching to dropdown/listbox option structures"
);
assert.match(
  source,
  /selectHealthFoodExactOptionOnPage[\s\S]*readback/,
  "select actions must return the selected option readback"
);
assert.match(
  source,
  /readHealthFoodSelectedValue[\s\S]*ecom-g-select-selection-item[\s\S]*inputValue/,
  "select readback must use the selected-value DOM instead of helper text from the whole field root"
);
assert.doesNotMatch(
  source.slice(
    source.indexOf("async function readHealthFoodSelectedValue"),
    source.indexOf("export async function selectHealthFoodExactOptionOnPage")
  ),
  /fieldRoot\.innerText/,
  "select readback must not accept option names found only in field helper text"
);
assert.match(
  source,
  /selectHealthFoodExactOptionOnPage[\s\S]*readHealthFoodSelectedValue\(fieldRoot\)[\s\S]*normalizeDomText\(currentReadback\)\.includes\(normalizeDomText\(optionText\)\)[\s\S]*changed:\s*false[\s\S]*option\.click[\s\S]*waitForTimeout\(3000\)[\s\S]*readHealthFoodSelectedValue\(fieldRoot\)[\s\S]*changed:\s*true/,
  "select actions must skip exact existing values and verify changed values again after the 3-second stabilization wait"
);

assert.match(
  source,
  /checkHealthFunctionOptionOnPage[\s\S]*resolveHealthFoodFunctionOptionTexts\(optionText\)[\s\S]*"保健功能"[\s\S]*ecom-g-select-selector[\s\S]*role=['"]combobox['"][\s\S]*fill\(expectedOption[\s\S]*ecom-g-select-tree-title[\s\S]*ecom-g-select-tree-treenode[\s\S]*ecom-g-select-tree-checkbox/,
  "health function action must split compound Feishu 保健功能 values, search the virtualized tree, and click each exact option's structural checkbox"
);
assert.match(
  source,
  /ecom-g-select-selection-item[\s\S]*readbackValue[\s\S]*normalizeDomText\(readbackValue\)\.includes/,
  "health function action must read back the selected tag from the field instead of the transient dropdown"
);

assert.match(
  source,
  /uploadHealthFoodFileInFieldOnPage[\s\S]*fieldRoot[\s\S]*input\[type=['"]file['"][\s\S]*setInputFiles/,
  "file uploads must target input[type=file] inside the correct field root"
);
assert.doesNotMatch(
  source,
  /食品安全资质/,
  "health-food safety actions must not search for obsolete label 食品安全资质; the real page uses 食品安全属性/商品外包装图/产地与包装"
);
assert.match(
  source,
  /fillHealthFoodSafetyAttributesOnPage\([\s\S]*page: Page,[\s\S]*metadata: PublishFromSpuMetadata[\s\S]*"产地与包装"[\s\S]*"保质期"[\s\S]*"生产企业名称"[\s\S]*"贮存条件"[\s\S]*"生产企业地址"[\s\S]*"净含量"[\s\S]*"产品标准代码"[\s\S]*"配料表"/,
  "health-food safety actions must fill the real food-safety fields shown under 食品安全属性"
);
assert.match(
  source,
  /fillHealthFoodSafetyAttributesOnPage[\s\S]*selectHealthFoodOptionCandidateOnPage\(page,\s*"产地与包装"[\s\S]*waitForHealthFoodFieldLabelOnPage\(page,\s*"保质期"[\s\S]*fillHealthFoodTextFieldOnPage\(page,\s*"保质期"[\s\S]*waitForHealthFoodFieldLabelOnPage\(page,\s*"生产企业名称"[\s\S]*fillHealthFoodTextFieldOnPage\(page,\s*"生产企业名称"[\s\S]*waitForHealthFoodFieldLabelOnPage\(page,\s*"生产企业地址"[\s\S]*fillHealthFoodTextFieldOnPage\(page,\s*"生产企业地址"[\s\S]*waitForHealthFoodFieldLabelOnPage\(page,\s*"净含量"[\s\S]*fillHealthFoodTextFieldOnPage\(page,\s*"净含量"/,
  "食品安全属性 must process one ordered sub-module at a time with DOM-readiness gates, including 净含量"
);
assert.match(
  source,
  /assertHealthFoodSubModuleCompleted\("产地与包装",\s*originPackaging\)[\s\S]*assertHealthFoodSubModuleCompleted\("保质期",\s*shelfLife\)[\s\S]*assertHealthFoodSubModuleCompleted\("生产企业名称",\s*manufacturerName\)[\s\S]*assertHealthFoodSubModuleCompleted\("贮存条件",\s*storage\)[\s\S]*assertHealthFoodSubModuleCompleted\("生产企业地址",\s*manufacturerAddress\)[\s\S]*assertHealthFoodSubModuleCompleted\("净含量",\s*netContent\)[\s\S]*assertHealthFoodSubModuleCompleted\("产品标准代码",\s*productStandardCode\)[\s\S]*assertHealthFoodSubModuleCompleted\("配料表",\s*ingredients\)/,
  "every food-safety sub-module must pass immediately before the next sub-module starts"
);
assert.doesNotMatch(
  source,
  /waitForHealthFoodRecognitionDiffAndCancelOnPage|dismissHealthFoodRecognitionDiffOnPage/,
  "health-food recognition difference popups must be ignored and must not become a publish blocker"
);
assert.match(
  source,
  /fillHealthFoodCategoryAttributesOnPage[\s\S]*checkHealthFunctionOptionOnPage\(page,\s*metadata\.healthFunction/,
  "health-food category attributes must handle 保健功能 after the food-safety dynamic fields are complete"
);
assert.doesNotMatch(
  source.slice(source.indexOf("export async function fillHealthFoodCategoryAttributesOnPage")),
  /"生产企业名称"|"生产企业地址"|"净含量"|"产品标准代码"|"配料表"/,
  "dynamic 食品安全属性 fields must not be delayed to the later 类目属性 stage"
);
assert.match(
  source,
  /uploadHealthFoodOuterPackagingOnPage[\s\S]*"上传外包装图"|uploadHealthFoodOuterPackagingOnPage[\s\S]*"商品外包装图"/,
  "health-food outer packaging upload must target the real 商品外包装图 upload control"
);
assert.match(
  source,
  /uploadHealthFoodOuterPackagingOnPage[\s\S]*从商品外包装图识别[\s\S]*ok:\s*true/,
  "outer packaging upload must treat Doudian recognition-difference evidence as upload completion without blocking on the reminder"
);
assert.match(
  source,
  /uploadHealthFoodFileInFieldOnPage[\s\S]*for \(let attempt = 0; attempt < 20; attempt \+= 1\)[\s\S]*uploadedCount[\s\S]*acceptedCount[\s\S]*page\.waitForTimeout\(1000\)/,
  "outer packaging upload must poll for asynchronous upload acceptance instead of checking file input state once"
);
assert.match(
  source,
  /uploadHealthFoodFileInFieldOnPage[\s\S]*if \(acceptedCount < selectedFiles\.length && selectedFiles\.length > 1\)[\s\S]*for \(const file of selectedFiles\)[\s\S]*setInputFiles\(file/,
  "outer packaging upload must fall back to per-file uploads when Doudian does not accept one multi-file selection"
);
const outerPackagingSource = source.slice(
  source.indexOf("export async function uploadHealthFoodOuterPackagingOnPage"),
  source.indexOf("export async function applyHealthFoodSpecificationOnPage")
);
assert.doesNotMatch(
  outerPackagingSource,
  /dismissHealthFoodRecognitionDiffOnPage/,
  "outer packaging upload must leave recognition diff handling to the explicit post-upload gate"
);
assert.match(
  source,
  /fieldRoot\.evaluate[\s\S]*root\.querySelectorAll\("img, video,[\s\S]*previewCount[\s\S]*ok: acceptedCount >= selectedFiles\.length/,
  "file upload readback must inspect accepted previews/upload evidence inside the field root"
);
const packagingLabelSource = source.slice(source.indexOf("export async function uploadHealthFoodPackagingLabelOnPage"));
assert.match(packagingLabelSource, /selectedFiles\.length/, "packaging label must use Feishu qualification image count as expected count");
assert.match(packagingLabelSource, /fieldRoot/, "packaging label must read back inside the 包装标签图 field root");
assert.match(packagingLabelSource, /uploadedCount[\s\S]*\/20/, "packaging label must read Doudian's 包装标签图 uploaded count");
assert.match(
  packagingLabelSource,
  /ok:\s*acceptedCount >= selectedFiles\.length/,
  "packaging label completion must compare the 包装标签图 field count against Feishu qualification image count"
);
assert.doesNotMatch(
  source,
  /getBoundingClientRect\(/,
  "health-food actions must not use viewport geometry for action targeting"
);
assert.match(
  source,
  /function parseHealthFoodSpecificationParts[\s\S]*firstQuantity[\s\S]*firstUnit[\s\S]*secondQuantity[\s\S]*secondUnit/,
  "health-food specification action must parse Feishu full specification into two numeric/unit segments"
);
assert.match(
  source,
  /applyHealthFoodSpecificationOnPage[\s\S]*findHealthFoodFieldRootByLabel\(page, "商品规格"\)[\s\S]*#skuValue-规格[\s\S]*placeholder=.填写并新增规格值.[\s\S]*editableValueInputs[\s\S]*populatedValueInputs[\s\S]*targetIndex/,
  "health-food specification action must target the populated template value input inside exact 规格 group before using blank add-value inputs"
);
assert.match(
  source,
  /openHealthFoodSpecificationEditor\(specificationInput\)[\s\S]*applyHealthFoodSpecificationEditorOnPage\(page,\s*parts\)[\s\S]*inputValue/,
  "health-food specification action must open the split editor, fill numeric/unit controls, then read back the auto-updated combined value"
);
assert.match(
  source,
  /async function applyHealthFoodSpecificationEditorOnPage[\s\S]*ecom-g-popover-content[\s\S]*input\.ecom-g-input\[placeholder=.请输入.\][\s\S]*chooseUnit[\s\S]*ecom-g-select-item-option/,
  "health-food specification action must operate the expanded popover numeric inputs and unit dropdown options"
);
assert.doesNotMatch(
  source,
  /chooseSplitRuleOnPage|两类组合|三类组合|单品/,
  "health-food specification action must not touch the split-rule/default selector; only quantity/unit/quantity/unit fields are controlled"
);
assert.match(
  source,
  /fillQuantityOnPage\(0, parts\.firstQuantity\)[\s\S]*chooseUnit\(0, parts\.firstUnit\)[\s\S]*fillQuantityOnPage\(1, parts\.secondQuantity\)[\s\S]*chooseUnit\(1, parts\.secondUnit\)/,
  "health-food specification action must fill exactly the four lower controls in order: quantity, unit, quantity, unit"
);
assert.doesNotMatch(
  source.slice(
    source.indexOf("export async function applyHealthFoodSpecificationOnPage"),
    source.indexOf("export async function uploadHealthFoodPackagingLabelOnPage")
  ),
  /\.fill\(|\.press\(|setHealthFoodSpecificationInputValue/,
  "health-food specification replacement must not depend on direct combined-input fill/press/value-setter"
);
assert.doesNotMatch(
  source.slice(
    source.indexOf("export async function applyHealthFoodSpecificationOnPage"),
    source.indexOf("export async function uploadHealthFoodPackagingLabelOnPage")
  ),
  /numericInputs|nth\(1\)|input:not\(\[type=['"]hidden['"]\]\)|口味分类|件数|type=['"]file['"]/,
  "health-food specification action must not enumerate unrelated inputs or touch other specification groups"
);

for (const forbidden of [
  /page\.mouse\.click/,
  /\.mouse\.click/,
  /page\.mouse\.move/,
  /\.touchscreen\./,
  /elementFromPoint\(/,
  /boundingBox\(/,
  /new MouseEvent\([^)]*\{[^}]*client[XY]/,
  /new PointerEvent\([^)]*\{[^}]*client[XY]/,
  /\.click\([^)]*\{[^}]*\b(x|y|position)\b/
]) {
  assert.doesNotMatch(source, forbidden, `health-food actions must not use coordinate-derived interaction: ${forbidden}`);
}

assert.match(
  publishSource,
  /from "\.\/publish-from-spu\/health-food-actions\.js"/,
  "publish-from-spu.ts must expose the health-food action module through the existing publish boundary"
);

assert.match(
  packageJson.scripts["rules:check"],
  /test-health-food-dom-actions-rule\.mjs/,
  "health-food DOM actions rule must run in rules:check"
);

console.log("health food DOM actions rule passed");
