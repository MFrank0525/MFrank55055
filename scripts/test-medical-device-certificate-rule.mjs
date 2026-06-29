import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateMedicalDeviceCertificateUploadRule } from "../dist/src/business/publish-from-spu/publish-rules.js";

assert.deepEqual(
  evaluateMedicalDeviceCertificateUploadRule({
    productCategory: "医疗器械",
    categoryText: "医疗器械及保健用品 > 医用敷料 > 液体敷料",
    selectedCertificateCount: 0,
    qualificationImageCount: 1
  }),
  { action: "upload_first_qualification_image", issue: "" }
);

assert.deepEqual(
  evaluateMedicalDeviceCertificateUploadRule({
    productCategory: "医疗器械",
    categoryText: "医疗器械及保健用品 > 医用敷料 > 液体敷料",
    selectedCertificateCount: 1,
    qualificationImageCount: 1
  }),
  { action: "leave_existing_certificate", issue: "" }
);

assert.deepEqual(
  evaluateMedicalDeviceCertificateUploadRule({
    productCategory: "保健食品",
    categoryText: "医疗器械及保健用品 > 保健食品 > 维生素",
    selectedCertificateCount: 0,
    qualificationImageCount: 1
  }),
  { action: "not_required", issue: "" },
  "Feishu productCategory=保健食品 must not be forced through the medical-device certificate gate even if the platform category path contains 医疗器械及保健用品"
);

assert.deepEqual(
  evaluateMedicalDeviceCertificateUploadRule({
    categoryText: "保健食品",
    selectedCertificateCount: 0,
    qualificationImageCount: 1
  }),
  { action: "not_required", issue: "" }
);

assert.deepEqual(
  evaluateMedicalDeviceCertificateUploadRule({
    productCategory: "医疗器械",
    categoryText: "医疗器械",
    selectedCertificateCount: 0,
    qualificationImageCount: 0
  }),
  { action: "blocked_missing_qualification_image", issue: "Medical device certificate slot is empty but no Feishu qualification image is available." }
);

const graphicActionSource = fs.readFileSync("src/business/publish-from-spu/graphic-file-input-action.ts", "utf8");
const certificateStart = graphicActionSource.indexOf("async function ensureMedicalDeviceCertificateFromFirstQualification");
const certificateEnd = graphicActionSource.indexOf("\ntype DetailQualificationUploadResult", certificateStart);
assert.notEqual(certificateStart, -1, "medical certificate action must exist in the action layer");
const certificateSource = graphicActionSource.slice(certificateStart, certificateEnd);
assert.match(
  certificateSource,
  /findExactVisibleUploadFieldInput\(page, "\\u533b\\u7597\\u5668\\u68b0\\u6ce8\\u518c\\u8bc1"/,
  "medical certificate upload must target the visible 医疗器械注册证 upload field"
);
assert.doesNotMatch(
  certificateSource,
  /collectFileInputs\(page\)|pickBestFileInput\(inputs, scoreMedicalDeviceCertificateInput\)|pickBestSectionFileInput\(inputs, "\\u533b\\u7597\\u5668\\u68b0\\u6ce8\\u518c\\u8bc1"/,
  "medical certificate upload must not fall back to adjacent upload modules"
);
assert.doesNotMatch(
  certificateSource,
  /医疗器械生产许可证|\\u533b\\u7597\\u5668\\u68b0\\u751f\\u4ea7\\u8bb8\\u53ef\\u8bc1|赠品资质|\\u8d60\\u54c1\\u8d44\\u8d28|质检报告|\\u8d28\\u68c0\\u62a5\\u544a/,
  "medical certificate action must not upload, delete, or manage sibling modules"
);

assert.match(
  graphicActionSource,
  /export async function findExactVisibleUploadFieldInput/,
  "action layer must expose a DOM-structural exact visible upload-field resolver"
);
const resolverStart = graphicActionSource.indexOf("export async function findExactVisibleUploadFieldInput");
const resolverEnd = graphicActionSource.indexOf("\nexport async function uploadFilesToInput", resolverStart);
const resolverSource = graphicActionSource.slice(resolverStart, resolverEnd);
assert.match(
  resolverSource,
  /nextLabelTop[\s\S]*inputRect\.top[\s\S]*< nextLabelTop/,
  "exact upload-field resolver must constrain file inputs before the next sibling field label"
);
assert.doesNotMatch(
  resolverSource,
  /医疗器械生产许可证|\\u533b\\u7597\\u5668\\u68b0\\u751f\\u4ea7\\u8bb8\\u53ef\\u8bc1|赠品资质|\\u8d60\\u54c1\\u8d44\\u8d28|质检报告|\\u8d28\\u68c0\\u62a5\\u544a/,
  "exact upload-field resolver must be generic and must not encode sibling medical fields as targets"
);

console.log("medical device certificate upload rule passed");
