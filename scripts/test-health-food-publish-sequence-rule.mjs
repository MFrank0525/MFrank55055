import assert from "node:assert/strict";
import fs from "node:fs";

const publishSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const publishManual = fs.readFileSync("docs/auto-listing/steps/10-publish.md", "utf8");
const separationManual = fs.readFileSync("docs/auto-listing/publish-rule-action-separation.md", "utf8");

function sliceFunction(name) {
  const start = publishSource.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `function not found: ${name}`);
  const next = publishSource.indexOf("\nasync function ", start + 1);
  return publishSource.slice(start, next === -1 ? publishSource.length : next);
}

function assertOrdered(source, markers, label) {
  let cursor = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert.notEqual(index, -1, `${label} missing marker: ${marker}`);
    assert.ok(index > cursor, `${label} marker out of order: ${marker}`);
    cursor = index;
  }
}

function assertBefore(source, before, after, label) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${label} missing marker: ${before}`);
  assert.notEqual(afterIndex, -1, `${label} missing marker: ${after}`);
  assert.ok(beforeIndex < afterIndex, `${label} expected ${before} before ${after}`);
}

const runPublishFlowSource = sliceFunction("runPublishFlow");

assert.match(
  publishSource,
  /import\s+\{\s*normalizeProductCategory[\s\S]*\}\s+from\s+"\.\.\/autolist\/product-category\.js"/,
  "publish flow must import the canonical category normalizer"
);
assert.match(
  runPublishFlowSource,
  /const\s+productCategory\s*=\s*normalizeProductCategory\(metadata\.productCategory\)/,
  "runPublishFlow must resolve the normalized category exactly once near the start"
);
assertBefore(
  runPublishFlowSource,
  "const productCategory = normalizeProductCategory(metadata.productCategory)",
  "if (!createPageUrl)",
  "normalized category resolution"
);

assert.match(
  publishSource,
  /import\s+\{[\s\S]*applyHealthFoodSpecificationOnPage[\s\S]*fillHealthFoodCategoryAttributesOnPage[\s\S]*fillHealthFoodSafetyAttributesOnPage[\s\S]*uploadHealthFoodOuterPackagingOnPage[\s\S]*uploadHealthFoodPackagingLabelOnPage[\s\S]*\}\s+from\s+"\.\/publish-from-spu\/health-food-actions\.js"/,
  "publish orchestration must reuse the existing health-food action module"
);

assert.match(
  runPublishFlowSource,
  /const\s+basicMetadata\s*=[\s\S]*productCategory\s*===\s*"保健食品"[\s\S]*modelSpec:\s*undefined[\s\S]*modelSpec:\s*metadata\.modelSpec/,
  "health-food basic info must not require or fill modelSpec=盒装"
);
assert.match(
  runPublishFlowSource,
  /const\s+basicInfoGuardUnexpectedFieldChanges\s*=\s*productCategory\s*!==\s*"保健食品"/,
  "health-food basic info must not use the medical-device category-attribute mutation guard"
);
assert.match(
  runPublishFlowSource,
  /fillBasicPublishPageOnPage\([\s\S]*basicInfoGuardUnexpectedFieldChanges[\s\S]*\)/,
  "health-food basic-info calls must pass the category-aware mutation guard policy"
);
assert.match(
  publishSource,
  /if\s*\(guardUnexpectedFieldChanges\)\s*\{[\s\S]*diffUnexpectedBasicFieldChanges/,
  "basic-info mutation diff must be controlled by an explicit guard flag"
);

assertOrdered(
  runPublishFlowSource,
  [
    "queryPlatformSpu(runtimeDir, metadata.brand, metadata.spu, shopFolder)",
    'publish module started: basic_info',
    "fillBasicPublishPageOnPage(",
    'publish module started: food_safety',
    "fillHealthFoodSafetyAttributesOnPage(page, metadata)",
    "if (!foodSafetyResult.ok)",
    "uploadHealthFoodOuterPackagingOnPage(page, assets.detailImages)",
    'publish module started: category_attributes',
    "fillHealthFoodCategoryAttributesOnPage(page, metadata)",
    'publish module started: graphic_info',
    "uploadProductImagesOnPage(",
    'publish module started: shipping_and_spec',
    "applyHealthFoodShippingBeforeSpecOnPage(page)",
    "applyFixedSpecsOnPage(",
    "applyHealthFoodSpecificationOnPage(page, metadata)",
    'publish module started: price_inventory',
    "applyPriceInventoryOnPage(",
    'publish module started: service_fulfillment',
    "applyFixedPublishSettingsOnPage(",
    'publish module started: packaging_label',
    "uploadHealthFoodPackagingLabelOnPage(page, assets.detailImages",
    'publish module started: final_submit',
    "clickPublishProductOnPage("
  ],
  "health-food publish sequence"
);
assert.doesNotMatch(
  runPublishFlowSource,
  /waitForHealthFoodRecognitionDiffAndCancelOnPage|dismissHealthFoodRecognitionDiffOnPage/,
  "health-food publish flow must ignore recognition difference popups instead of dismissing or blocking on them"
);
assertBefore(
  runPublishFlowSource,
  "uploadHealthFoodPackagingLabelOnPage(page, assets.detailImages",
  'publish module started: final_submit',
  "health-food packaging label upload must lead directly to final submit"
);
assert.doesNotMatch(
  runPublishFlowSource.slice(
    runPublishFlowSource.indexOf('publish module started: packaging_label'),
    runPublishFlowSource.indexOf('if (productCategory === "医疗器械")', runPublishFlowSource.indexOf('publish module started: packaging_label'))
  ),
  /runPublishCheckOnPage/,
  "health-food packaging label completion must not be followed by fill-check gating before final submit"
);
assert.match(
  runPublishFlowSource,
  /if \(productCategory === "保健食品"\) \{[\s\S]*checkPassed = true[\s\S]*submit without fill-check gating[\s\S]*\} else \{[\s\S]*runPublishCheckOnPage/,
  "health-food flow must bypass fill-check gating while non-health-food flow still uses it"
);

const healthFoodBlockStart = runPublishFlowSource.indexOf('if (productCategory === "保健食品")');
const medicalBlockStart = runPublishFlowSource.indexOf('if (productCategory === "医疗器械")');
assert.notEqual(healthFoodBlockStart, -1, "health-food branch not found");
assert.notEqual(medicalBlockStart, -1, "medical-device branch not found");
const healthFoodBlock = runPublishFlowSource.slice(
  healthFoodBlockStart,
  medicalBlockStart > healthFoodBlockStart ? medicalBlockStart : runPublishFlowSource.indexOf("const checkResult", healthFoodBlockStart)
);
const medicalBlock = runPublishFlowSource.slice(medicalBlockStart, runPublishFlowSource.indexOf("const checkResult", medicalBlockStart));

assert.doesNotMatch(
  healthFoodBlock,
  /ensureMedicalDeviceCertificateFromFirstQualification|apply_medical_device_certificate/,
  "medical certificate logic must not run for health-food products"
);
assert.doesNotMatch(
  medicalBlock,
  /fillHealthFoodSafetyAttributesOnPage|fillHealthFoodCategoryAttributesOnPage|applyHealthFoodSpecificationOnPage|uploadHealthFoodPackagingLabelOnPage|applyHealthFoodShippingBeforeSpecOnPage/,
  "health-food actions must not run for medical-device products"
);

for (const marker of [
  "保健食品分支顺序",
  "食品安全",
  "类目属性",
  "包装标签图",
  "医疗器械注册证逻辑不得对保健食品运行"
]) {
  assert.match(publishManual, new RegExp(marker), `publish manual missing health-food sequence marker: ${marker}`);
}
assert.match(
  separationManual,
  /健康食品动作.*health-food-actions\.ts[\s\S]*runPublishFlow.*编排/,
  "rule/action separation doc must explain that health-food actions are reused by orchestration"
);
assert.match(
  packageJson.scripts["rules:check"],
  /test-health-food-publish-sequence-rule\.mjs/,
  "health-food publish sequence rule must run in rules:check"
);

console.log("health food publish sequence rule passed");
