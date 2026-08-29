import assert from "node:assert/strict";
import fs from "node:fs";

const resetSource = fs.readFileSync("src/business/publish-from-spu/graphic-prefill-clear-action.ts", "utf8");
const uploadSource = fs.readFileSync("src/business/publish-from-spu/graphic-upload-page-action.ts", "utf8");
const previewActionSource = fs.readFileSync("src/business/publish-from-spu/graphic-section-preview-action.ts", "utf8");

assert.match(
  resetSource,
  /clearMainImagePrefillAndConfirmEmpty[\s\S]*clearGraphicSectionPreviewsStrict[\s\S]*countMainImagePreviews[\s\S]*remainingCount !== 0[\s\S]*throw new Error/,
  "main-image prefill clear must fail closed unless DOM readback reaches zero"
);
assert.match(
  resetSource,
  /clearDetailPrefillAndConfirmEmpty[\s\S]*clearDetailImagePreviewsStrict[\s\S]*countDetailImagePreviews[\s\S]*remainingCount !== 0[\s\S]*throw new Error/,
  "detail prefill clear must fail closed unless DOM readback reaches zero"
);
assert.match(
  uploadSource,
  /clearMainImagePrefillAndConfirmEmpty\(page\)[\s\S]*uploadMainImagesToSection/,
  "main images must be uploaded only after strict prefill clearing"
);
assert.match(
  uploadSource,
  /clearDetailPrefillAndConfirmEmpty\(page\)[\s\S]*clickFillFromMainForDetailSection[\s\S]*uploadDetailImagesByInputCapability/,
  "detail sequence must be clear, confirm empty, fill from main, then upload Feishu qualifications"
);
assert.doesNotMatch(
  uploadSource,
  /clear(?:GraphicSection|DetailImage)PreviewsStrict\([^;]+\)\.catch\(\(\) => 0\)/,
  "required main/detail prefill clearing must not swallow failures"
);
assert.match(
  previewActionSource,
  /clickLastMainImagePreviewDeleteControl[\s\S]*resolveExactMainImageFieldRoot[\s\S]*\.material-preview-button[\s\S]*\.last\(\)[\s\S]*\.hover\([\s\S]*use\[href='#icon-shanchu'\][\s\S]*actionAfter[\s\S]*deleteControl\.click/,
  "main-image prefill clearing must hover the exact last preview and click the platform delete action container"
);
assert.match(
  previewActionSource,
  /sectionName === "主图"[\s\S]*clickLastMainImagePreviewDeleteControl/,
  "generic graphic clearing must route main images through the exact field action"
);
assert.match(
  previewActionSource,
  /clickLastDetailImagePreviewDeleteControl[\s\S]*attr-field-id='商品详情'[\s\S]*detailDeleteControlSelector[\s\S]*aria-roledescription='sortable'[\s\S]*\.hover\([\s\S]*deleteControl\.click/,
  "detail prefill clearing must scope to the exact detail field and click its current delete control"
);
assert.match(
  previewActionSource,
  /detailDeleteControlSelector[\s\S]*aria-label\*='删除'[\s\S]*title\*='删除'[\s\S]*clickLastDetailImagePreviewDeleteControl/,
  "detail clearing must recognize semantic delete controls instead of depending on one platform icon class"
);
assert.doesNotMatch(
  previewActionSource,
  /clearDetailImagePreviewsStrict[\s\S]*getGraphicSectionPreviewRectsStrict[\s\S]*if \(!previews\.length\) \{\s*break;/,
  "exact detail-field deletion must not be blocked by heuristic preview rectangles"
);
assert.match(
  previewActionSource,
  /clearDetailImagePreviewsStrict[\s\S]*waitForDetailPreviewCountDecrease\(page, beforeCount/,
  "detail deletion must wait for a bounded DOM count decrease instead of relying on a fixed delay"
);
assert.match(
  previewActionSource,
  /sectionName === "商品详情" \|\| sectionName === "详情页"[\s\S]*clickLastDetailImagePreviewDeleteControl/,
  "generic graphic clearing must route both detail section labels through the exact field action"
);

console.log("graphic prefill clear rule passed");
