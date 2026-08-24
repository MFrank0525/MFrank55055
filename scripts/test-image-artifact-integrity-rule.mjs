import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isFullyDecodableImageFile, writeFullyValidatedImageAtomic } from "../dist/src/utils/image-integrity.js";
import {
  initializePaidImageProductLedger,
  inspectPaidImageProductLedgerForAudit,
  recordPaidImageCompleted,
  recordPaidImageFailedAfterAcceptance,
  recordPaidImageRecoveredFromExistingResult,
  recordPaidImageSubmitted,
  reservePaidImageSlot,
  resolvePaidImageProviderIdentityProofCandidate,
  resolvePaidImageSlotAction,
  rotatePaidImageProviderIdentityWithAuthenticatedTaskProof,
  sha256File,
  summarizePaidImageProductLedger,
  validatePaidImageExistingResultRecoveryPlan
} from "../dist/src/autolist/paid-image-submission-ledger.js";
import { hasIncompleteFixedMainImageRoundFiles, summarizeReusableTaskArtifacts } from "../dist/src/autolist/resume-artifacts.js";
import { isTransientImageProviderErrorMessage } from "../dist/src/autolist/main-image-provider-action.js";
import { isRetryableExternalServiceAvailabilityFailure } from "../dist/src/autolist/external-service-recovery-rules.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-integrity-rule-"));
const mainImageAssetsSource = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
const providerActionSource = fs.readFileSync("src/autolist/main-image-provider-action.ts", "utf8");
assert.match(mainImageAssetsSource, /stagedShapeValid[\s\S]*isFullyDecodableImageFile\(stagedFile\)/);
assert.match(providerActionSource, /credentialFingerprint:\s*sha256Text\(config\.apiKey/);
assert.match(providerActionSource, /proofTaskId[\s\S]*proofStatus[\s\S]*proofModel[\s\S]*proofSize/);
const valid = fs.readFileSync("input/fixed-main-images/辅助图02.png");
const truncated = valid.subarray(0, Math.max(32, Math.floor(valid.length / 20)));
const validFile = path.join(tempDir, "valid.png");
const truncatedFile = path.join(tempDir, "truncated.png");
fs.writeFileSync(validFile, valid);
fs.writeFileSync(truncatedFile, truncated);
assert.equal(isFullyDecodableImageFile(validFile), true);
assert.equal(isFullyDecodableImageFile(truncatedFile), false);
assert.equal(isTransientImageProviderErrorMessage("Image artifact failed full decode validation"), true);
assert.equal(
  isRetryableExternalServiceAvailabilityFailure(
    "failed at main_images_generated: Image download failed: Image artifact failed full decode validation"
  ),
  true
);

const atomicTarget = path.join(tempDir, "atomic.png");
writeFullyValidatedImageAtomic(atomicTarget, valid);
assert.throws(() => writeFullyValidatedImageAtomic(atomicTarget, truncated), /full decode validation/i);
assert.deepEqual(fs.readFileSync(atomicTarget), valid, "invalid transport bytes must never replace the last valid artifact");

const corruptDeliveryLedger = initializePaidImageProductLedger({
  rootDir: path.join(tempDir, "corrupt-delivery-ledger"), batchFingerprint: "batch-delivery", recordId: "record-delivery",
  expectedSlotCount: 1, providerIdentity: "provider/model", sourceImageDigest: "source"
});
reservePaidImageSlot({
  productDir: corruptDeliveryLedger.productDir, slot: 1, requestDigest: "request", promptDigest: "prompt",
  owner: { runId: "run", taskId: "task", pid: process.pid }
});
recordPaidImageSubmitted({ productDir: corruptDeliveryLedger.productDir, slot: 1, providerTaskId: "corrupt-delivery-task" });
const corruptDeliveryCompleted = recordPaidImageCompleted({
  productDir: corruptDeliveryLedger.productDir, slot: 1, providerTaskId: "corrupt-delivery-task", sourceFile: validFile
});
fs.writeFileSync(corruptDeliveryCompleted.resultFile, truncated);
assert.equal(recordPaidImageFailedAfterAcceptance({
  productDir: corruptDeliveryLedger.productDir,
  slot: 1,
  providerTaskId: "corrupt-delivery-task",
  reason: "completed provider task returned corrupt bytes from both delivery paths"
}).state, "failed_after_acceptance");

const ledger = initializePaidImageProductLedger({
  rootDir: path.join(tempDir, "ledger"), batchFingerprint: "batch-integrity", recordId: "record-integrity",
  expectedSlotCount: 2, providerIdentity: "provider/model", sourceImageDigest: "source"
});
reservePaidImageSlot({
  productDir: ledger.productDir, slot: 1, requestDigest: "request", promptDigest: "prompt",
  owner: { runId: "run", taskId: "task", pid: process.pid }
});
recordPaidImageSubmitted({ productDir: ledger.productDir, slot: 1, providerTaskId: "accepted-task" });
const completed = recordPaidImageCompleted({
  productDir: ledger.productDir, slot: 1, providerTaskId: "accepted-task", sourceFile: validFile
});
assert.equal(resolvePaidImageSlotAction({ productDir: ledger.productDir, slot: 1 }).action, "reuse");
const identityProof = resolvePaidImageProviderIdentityProofCandidate(ledger.productDir);
assert.ok(identityProof);
assert.equal(
  rotatePaidImageProviderIdentityWithAuthenticatedTaskProof({
    productDir: ledger.productDir,
    previousProviderIdentity: identityProof.currentProviderIdentity,
    nextProviderIdentity: "provider/model/credential-b",
    proofProviderTaskId: identityProof.providerTaskId,
    proofResultDigest: identityProof.resultDigest
  }).providerIdentity,
  "provider/model/credential-b"
);

fs.writeFileSync(completed.resultFile, truncated);
const slotFile = path.join(ledger.productDir, "slots", "01.json");
const slotRecord = JSON.parse(fs.readFileSync(slotFile, "utf8"));
slotRecord.resultDigest = sha256File(completed.resultFile);
fs.writeFileSync(slotFile, `${JSON.stringify(slotRecord, null, 2)}\n`);
assert.equal(
  resolvePaidImageSlotAction({ productDir: ledger.productDir, slot: 1 }).action,
  "poll",
  "a corrupt completed result must poll the same accepted task, never submit a second paid task"
);
assert.equal(inspectPaidImageProductLedgerForAudit(ledger.productDir).summary.completed, 0);
assert.throws(() => summarizePaidImageProductLedger(ledger.productDir), /missing or invalid/i);
reservePaidImageSlot({
  productDir: ledger.productDir, slot: 2, requestDigest: "request-2", promptDigest: "prompt-2",
  owner: { runId: "run", taskId: "task", pid: process.pid }
});
recordPaidImageSubmitted({ productDir: ledger.productDir, slot: 2, providerTaskId: "failed-task" });
recordPaidImageFailedAfterAcceptance({
  productDir: ledger.productDir, slot: 2, providerTaskId: "failed-task", reason: "provider task failed after acceptance"
});
assert.throws(
  () => validatePaidImageExistingResultRecoveryPlan({ productDir: ledger.productDir, mappings: [{ targetSlot: 2, sourceSlot: 1 }] }),
  /not a valid completed result/i
);
assert.throws(
  () => recordPaidImageRecoveredFromExistingResult({ productDir: ledger.productDir, targetSlot: 2, sourceSlot: 1, reason: "test" }),
  /not a valid completed result/i
);
recordPaidImageCompleted({
  productDir: ledger.productDir, slot: 1, providerTaskId: "accepted-task", sourceFile: validFile
});
assert.equal(resolvePaidImageSlotAction({ productDir: ledger.productDir, slot: 1 }).action, "reuse");

const runtimeDir = path.join(tempDir, "runtime");
const rawDir = path.join(runtimeDir, "tasks", "image-001", "main-image-01", "openai-compatible", "raw");
fs.mkdirSync(rawDir, { recursive: true });
fs.writeFileSync(path.join(rawDir, "generated-01.png"), valid);
fs.writeFileSync(path.join(rawDir, "generated-02.png"), truncated);
assert.equal(summarizeReusableTaskArtifacts({ runtimeDir, taskId: "image-001" }).reusableRawImageCount, 1);
assert.equal(
  hasIncompleteFixedMainImageRoundFiles({ runtimeDir, taskId: "image-001", expectedImagesPerRound: 2 }),
  true
);
fs.writeFileSync(path.join(rawDir, "generated-01.png"), truncated);
assert.equal(
  hasIncompleteFixedMainImageRoundFiles({ runtimeDir, taskId: "image-001", expectedImagesPerRound: 2 }),
  true,
  "a round containing only corrupt filename-shaped artifacts must remain incomplete"
);

console.log("image artifact integrity rule tests passed");
