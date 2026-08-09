import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

assert.equal(
  fs.existsSync("docs/PUBLISH_FLOW_SOP.md"),
  false,
  "the duplicate monolithic publish SOP must be removed; step manuals are the sole Markdown rule source"
);

for (const file of [
  "README.ai.md",
  "docs/PROJECT_MAINTENANCE_MAP.md",
  "scripts/test-rule-closure-audit.mjs"
]) {
  assert.doesNotMatch(read(file), /PUBLISH_FLOW_SOP\.md/, `${file} must not reference the obsolete duplicate SOP`);
}
assert.doesNotMatch(
  read("src/autolist/shop-distribution.ts"),
  /模拟店铺|inferredName/,
  "shop distribution must not retain an unreachable inferred-shop compatibility branch"
);
for (const file of ["src/autolist/orchestrator.ts", "src/autolist/file-batch.ts"]) {
  assert.doesNotMatch(
    read(file),
    /discoverFallbackImages|discoverPendingImages|filterPendingImages/,
    `${file} must not retain unbound image-directory discovery for the Feishu-only flow`
  );
}

const publishSource = read("src/autolist/publish.ts");
assert.doesNotMatch(publishSource, /wasPublishCompleted|Recovered from legacy completed result file/);
assert.doesNotMatch(
  publishSource,
  /modelSpec:\s*workbookFields\.modelSpec\s*\|\|\s*"盒装"/,
  "publish metadata must not synthesize medical-device modelSpec for every category"
);
assert.doesNotMatch(
  publishSource,
  /if \(!fields\.modelSpec\.trim\(\)\)/,
  "generic workbook preflight must not require a medical-device-only field"
);

const titleSheetSource = read("src/autolist/title-sheets.ts");
assert.doesNotMatch(
  titleSheetSource,
  /\["型号规格",\s*"盒装"\]/,
  "generated title workbooks must not prefill a medical-device-only category attribute"
);

assert.match(
  read("docs/auto-listing/steps/10-publish.md"),
  /类目属性填写规则[\s\S]*本规则只适用于医疗器械[\s\S]*非处方药不得展开或改动类目属性/,
  "the model-spec manual block must not read like a generic all-category rule"
);

assert.doesNotMatch(
  read("docs/auto-listing/README.md"),
  /调用当前标题 provider/,
  "project overview must not claim that deterministic local title composition uses a provider"
);

for (const file of [
  "src/autolist/config.ts",
  "src/autolist/types.ts",
  "src/autolist/orchestrator.ts",
  "src/autolist/metadata.ts",
  "src/autolist/preflight.ts",
  "src/cli/doctor.ts",
  "docs/auto-listing/steps/07-product-info-enrichment.md",
  "docs/auto-listing/stability-checklist.md",
  "input/auto-listing.job.example.json"
]) {
  assert.doesNotMatch(
    read(file),
    /productInfoXlsx|productInfoKeyMap|product-info\.xlsx|product-info-key-map/,
    `${file} must not retain the obsolete workbook product-info input path`
  );
}
assert.doesNotMatch(read("docs/auto-listing/stability-checklist.md"), /商品信息表主键匹配|新增产品主键映射/);

for (const file of [
  "src/autolist/file-batch.ts",
  "src/cli/auto-listing-controller.ts",
  "src/cli/auto-listing-supervisor.ts",
  "src/cli/flow-mac-feishu.ts"
]) {
  assert.doesNotMatch(
    read(file),
    /migrateLegacyProcessedImagesToBatch|legacyImages/,
    `${file} must not attach an identity-free processed-image list to the current Feishu batch`
  );
}
assert.doesNotMatch(
  read("src/autolist/cleanup-rules.ts"),
  /legacyPublishRuntimeKey|path\.join\(options\.runtimeDir, "publish"/,
  "cleanup must not derive identity-free publish runtime directories from display folder names"
);
assert.doesNotMatch(
  read("src/autolist/status-progress-rules.ts"),
  /name:\$\{fallbackName\}/,
  "publish progress grouping must not substitute a display name for missing canonical identity"
);
for (const file of [
  "src/business/publish-from-spu/graphic-upload-page-action.ts",
  "src/business/publish-from-spu/graphic-section-preview-action.ts",
  "src/business/publish-from-spu/graphic-file-input-action.ts"
]) {
  assert.doesNotMatch(
    read(file),
    /uploadWhiteBackgroundImage|purgeForbiddenGraphicSections|countWhiteBackgroundPreviews|countMain34Previews|scoreWhiteBackgroundGraphicInput/,
    `${file} must not retain upload, delete, or readback code for graphic sections outside the publish flow`
  );
}

for (const file of [
  "input/product-info-key-map.example.json",
  "input/product.example.json",
  "input/image-search-hot-terms.example.txt"
]) {
  assert.equal(fs.existsSync(file), false, `unused legacy input example must be removed: ${file}`);
}

console.log("obsolete rule source removal passed");
