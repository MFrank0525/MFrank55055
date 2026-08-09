import assert from "node:assert/strict";
import fs from "node:fs";

const resetSource = fs.readFileSync("src/business/publish-from-spu/graphic-prefill-clear-action.ts", "utf8");
const uploadSource = fs.readFileSync("src/business/publish-from-spu/graphic-upload-page-action.ts", "utf8");

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

console.log("graphic prefill clear rule passed");
