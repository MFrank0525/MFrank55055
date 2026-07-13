import assert from "node:assert/strict";
import {
  buildAutoListingBusinessRuleFingerprint,
  canResumeAutoListingArtifacts
} from "../dist/src/autolist/business-rule-fingerprint.js";

const first = buildAutoListingBusinessRuleFingerprint();
const second = buildAutoListingBusinessRuleFingerprint();

assert.match(first, /^[a-f0-9]{24}$/);
assert.equal(first, second, "canonical business rules must have a deterministic fingerprint");
assert.equal(
  canResumeAutoListingArtifacts({
    currentBatchFingerprint: "batch-a",
    resumeBatchFingerprint: "batch-a",
    currentBusinessRuleFingerprint: first,
    resumeBusinessRuleFingerprint: first
  }),
  true
);
for (const incompatible of [
  { resumeBatchFingerprint: "batch-b", resumeBusinessRuleFingerprint: first },
  { resumeBatchFingerprint: "batch-a", resumeBusinessRuleFingerprint: "" },
  { resumeBatchFingerprint: "batch-a", resumeBusinessRuleFingerprint: "0".repeat(24) }
]) {
  assert.equal(
    canResumeAutoListingArtifacts({
      currentBatchFingerprint: "batch-a",
      currentBusinessRuleFingerprint: first,
      ...incompatible
    }),
    false
  );
}

console.log("business rule fingerprint passed");
