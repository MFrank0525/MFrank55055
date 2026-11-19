import assert from "node:assert/strict";

import {
  applyVerifiedFeishuSourceCorrection,
  validateFeishuSourceCorrectionEvidence
} from "../dist/src/autolist/feishu-source-correction-rules.js";

const record = {
  recordId: "rec-1",
  specTemplate: "买一送一",
  rawFields: { 规格模板: "买一送一", 产品价格: "159,149,99.9,89.9" }
};
const correction = {
  version: 1,
  lockedBatchFingerprint: "batch-1",
  liveCandidateFingerprint: "batch-2",
  recordId: "rec-1",
  field: "specTemplate",
  previousValue: "买一送一",
  currentValue: "买二送一",
  verifiedOnlyChangedScalarField: true,
  publishSubmitAttemptState: "not_attempted",
  canonicalTargetKey: "batch-1__rec-1__image-004__01__01"
};

assert.deepEqual(
  validateFeishuSourceCorrectionEvidence({
    correction,
    batchFingerprint: "batch-1",
    recordId: "rec-1",
    canonicalTargetKey: correction.canonicalTargetKey,
    publishSubmitAttemptState: "not_attempted"
  }),
  correction
);

const corrected = applyVerifiedFeishuSourceCorrection(record, correction, "batch-1");
assert.equal(corrected.specTemplate, "买二送一");
assert.equal(corrected.rawFields.规格模板, "买二送一");
assert.equal(record.specTemplate, "买一送一", "source record must not be mutated");

for (const [label, bad] of [
  ["batch", { batchFingerprint: "other" }],
  ["record", { recordId: "other" }],
  ["target", { canonicalTargetKey: "other" }],
  ["submit", { publishSubmitAttemptState: "attempted" }]
]) {
  assert.throws(
    () => validateFeishuSourceCorrectionEvidence({
      correction,
      batchFingerprint: bad.batchFingerprint || "batch-1",
      recordId: bad.recordId || "rec-1",
      canonicalTargetKey: bad.canonicalTargetKey || correction.canonicalTargetKey,
      publishSubmitAttemptState: bad.publishSubmitAttemptState || "not_attempted"
    }),
    undefined,
    `${label} mismatch must fail closed`
  );
}

assert.throws(() => applyVerifiedFeishuSourceCorrection({ ...record, specTemplate: "其他" }, correction, "batch-1"));
assert.throws(() => applyVerifiedFeishuSourceCorrection(record, { ...correction, field: "productPriceText" }, "batch-1"));

console.log("feishu source correction rule tests passed");
