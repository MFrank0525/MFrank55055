import assert from "node:assert/strict";
import { evaluateMedicalDeviceCertificateUploadRule } from "../src/business/publish-from-spu/publish-rules.ts";

assert.deepEqual(
  evaluateMedicalDeviceCertificateUploadRule({
    categoryText: "医疗器械及保健用品 > 医用敷料 > 液体敷料",
    selectedCertificateCount: 0,
    qualificationImageCount: 1
  }),
  { action: "upload_first_qualification_image", issue: "" }
);

assert.deepEqual(
  evaluateMedicalDeviceCertificateUploadRule({
    categoryText: "医疗器械及保健用品 > 医用敷料 > 液体敷料",
    selectedCertificateCount: 1,
    qualificationImageCount: 1
  }),
  { action: "leave_existing_certificate", issue: "" }
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
    categoryText: "医疗器械",
    selectedCertificateCount: 0,
    qualificationImageCount: 0
  }),
  { action: "blocked_missing_qualification_image", issue: "Medical device certificate slot is empty but no Feishu qualification image is available." }
);

console.log("medical device certificate upload rule passed");
