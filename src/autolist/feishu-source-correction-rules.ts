import type { FeishuProductRecord } from "../feishu/types.js";

export interface FeishuSourceCorrection {
  version: 1;
  lockedBatchFingerprint: string;
  liveCandidateFingerprint: string;
  recordId: string;
  field: "specTemplate";
  previousValue: string;
  currentValue: string;
  verifiedOnlyChangedScalarField: true;
  publishSubmitAttemptState: "not_attempted";
  canonicalTargetKey: string;
}

export function validateFeishuSourceCorrectionEvidence(options: {
  correction: FeishuSourceCorrection;
  batchFingerprint: string;
  recordId: string;
  canonicalTargetKey: string;
  publishSubmitAttemptState: string;
}): FeishuSourceCorrection {
  const { correction } = options;
  if (
    correction.version !== 1 ||
    correction.field !== "specTemplate" ||
    correction.verifiedOnlyChangedScalarField !== true ||
    correction.publishSubmitAttemptState !== "not_attempted" ||
    options.publishSubmitAttemptState !== "not_attempted" ||
    !correction.liveCandidateFingerprint ||
    !correction.previousValue ||
    !correction.currentValue ||
    correction.previousValue === correction.currentValue ||
    correction.lockedBatchFingerprint !== options.batchFingerprint ||
    correction.recordId !== options.recordId ||
    correction.canonicalTargetKey !== options.canonicalTargetKey
  ) {
    throw new Error("Feishu source correction evidence failed closed validation.");
  }
  return correction;
}

export function applyVerifiedFeishuSourceCorrection(
  record: Pick<FeishuProductRecord, "recordId" | "specTemplate" | "rawFields">,
  correction: FeishuSourceCorrection,
  lockedBatchFingerprint: string
): typeof record {
  if (
    correction.field !== "specTemplate" ||
    correction.lockedBatchFingerprint !== lockedBatchFingerprint ||
    record.recordId !== correction.recordId ||
    record.specTemplate !== correction.previousValue
  ) {
    throw new Error("Feishu source correction does not match the locked source record.");
  }
  return {
    ...record,
    specTemplate: correction.currentValue,
    rawFields: {
      ...record.rawFields,
      规格模板: correction.currentValue
    }
  };
}
