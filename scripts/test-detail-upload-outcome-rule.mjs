import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyAssets } from "../dist/src/business/publish-from-spu/assets.js";
import { auditAutoListingContinuity } from "../dist/src/autolist/audit-rules.js";
import {
  classifyPublishFailure,
  evaluateDetailImageCompletion,
  evaluateDetailUploadOutcome
} from "../dist/src/business/publish-from-spu/publish-rules.js";

assert.equal(
  classifyPublishFailure(
    "Sequential publish flow stopped: 图文信息模块未完成。Detail expansion upload was not acknowledged per file. expected=2; acknowledged=1; baseline=6; final=9"
  ),
  "detail_qualification_not_ready",
  "详情页展开图 acknowledgement failures must use the deterministic detail-image circuit"
);

const missingExpansionAssetAudit = auditAutoListingContinuity({
  records: [{
    recordId: "rec-detail-expansion",
    whiteBackgroundImages: [{ localFile: "/work/white.png" }],
    qualificationImages: [{ localFile: "/work/qualification.png" }],
    detailExpansionImages: [{ localFile: "/work/detail-expansion.png" }]
  }],
  processedImages: [],
  existingFiles: ["/work/white.png", "/work/qualification.png"]
});
assert.ok(
  missingExpansionAssetAudit.errors.some((issue) => issue.code === "pending_detail_expansion_image_missing"),
  "deep continuity audit must fail when a pending Feishu 详情页展开图 local file is missing"
);

const satisfiedFinalCount = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 5,
  qualificationImageCount: 4,
  acknowledgedQualificationCount: 4,
  detailExpansionImageCount: 2,
  acknowledgedDetailExpansionCount: 2,
  finalDetailCount: 11,
  expectedDetailCount: 11
});

assert.deepEqual(
  evaluateDetailUploadOutcome({
    uploadActionCompleted: false,
    detailRule: satisfiedFinalCount
  }),
  { passed: true, issue: "" }
);

const shortFinalCount = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 5,
  qualificationImageCount: 4,
  acknowledgedQualificationCount: 4,
  detailExpansionImageCount: 2,
  acknowledgedDetailExpansionCount: 2,
  finalDetailCount: 10,
  expectedDetailCount: 11
});

assert.deepEqual(
  evaluateDetailUploadOutcome({
    uploadActionCompleted: true,
    detailRule: shortFinalCount
  }),
  {
    passed: false,
    issue: "Detail image count did not reach expected count. expected=11; actual=10"
  }
);

const missingAcknowledgement = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 6,
  qualificationImageCount: 2,
  acknowledgedQualificationCount: 1,
  detailExpansionImageCount: 1,
  acknowledgedDetailExpansionCount: 1,
  finalDetailCount: 9,
  expectedDetailCount: 9
});
assert.deepEqual(missingAcknowledgement, {
  passed: false,
  issue: "Qualification detail upload was not acknowledged per file. expected=2; acknowledged=1; baseline=6; final=9"
});

const fullyAcknowledged = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 6,
  qualificationImageCount: 2,
  acknowledgedQualificationCount: 2,
  detailExpansionImageCount: 1,
  acknowledgedDetailExpansionCount: 1,
  finalDetailCount: 9,
  expectedDetailCount: 9
});
assert.deepEqual(fullyAcknowledged, { passed: true, issue: "" });

const publishSource = fs.readFileSync("src/business/publish-from-spu/graphic-file-input-action.ts", "utf8");
const uploadStart = publishSource.indexOf("async function uploadDetailImagesByInputCapability");
const uploadEnd = publishSource.indexOf("async function uploadFilesToSectionSlots", uploadStart);
const uploadSource = publishSource.slice(uploadStart, uploadEnd);
assert.match(uploadSource, /pickBestSectionFileInput\(inputs, "\\u5546\\u54c1\\u8be6\\u60c5"/);
assert.match(uploadSource, /pickBestSectionFileInput\(inputs, "\\u8be6\\u60c5\\u9875"/);
assert.match(uploadSource, /waitForPreviewCount[\s\S]*previousCount \+ 1/);
assert.doesNotMatch(uploadSource, /pickBestFileInput\(inputs, scoreDetailGraphicInput\)/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "detail-order-"));
const productFolder = path.join(tempRoot, "延草纲目医用测试敷料-recid-水印01");
fs.mkdirSync(productFolder, { recursive: true });
const write = (name, content) => fs.writeFileSync(path.join(productFolder, name), content);
write("延草纲目医用测试敷料延草纲目大药房专营店01.png", "main-image");
write("测试白底图-01-aaaaaaaaaa.png", "white-image");
write("测试资质图片-03-0000000001.png", "qualification-03");
write("测试资质图片-01-9999999999.png", "qualification-01");
write("测试资质图片-02-1111111111.png", "qualification-02");
write("测试详情页展开图-02-bbbbbbbbbb.png", "expansion-02");
write("测试详情页展开图-01-cccccccccc.png", "expansion-01");

const classified = classifyAssets(productFolder);
assert.deepEqual(
  classified.detailImages.map((file) => path.basename(file)),
  [
    "测试资质图片-01-9999999999.png",
    "测试资质图片-02-1111111111.png",
    "测试资质图片-03-0000000001.png"
  ],
  "detail qualification images must upload in Feishu qualification order, ignoring hash suffix digits"
);
assert.deepEqual(
  classified.detailExpansionImages.map((file) => path.basename(file)),
  ["测试详情页展开图-01-cccccccccc.png", "测试详情页展开图-02-bbbbbbbbbb.png"],
  "detail expansion images must remain separate from qualifications and preserve Feishu order"
);

const uploadActionSource = fs.readFileSync("src/business/publish-from-spu/graphic-upload-page-action.ts", "utf8");
assert.match(
  uploadActionSource,
  /assets\.detailImages,[\s\S]*qualificationExpectedCount[\s\S]*detailExpansionImages,[\s\S]*countAfterQualifications/,
  "详情页展开图 must upload only after the qualification batch reaches its exact expected count"
);
assert.doesNotMatch(
  uploadActionSource,
  /finalDetailPreviewCount[\s\S]*uploadedGroups\.push\("detailImages:fillFromMainThenQualificationsThenExpansion"\)/,
  "detail completion must come only from the authoritative staged upload result, never a guessed final-count fallback"
);

console.log("detail upload outcome rule passed");
