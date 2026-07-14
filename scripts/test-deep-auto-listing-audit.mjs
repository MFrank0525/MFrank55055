import assert from "node:assert/strict";
import {
  aggregatePaidImageLedgerGeneration,
  auditCanonicalPublishEvidence,
  auditPaidImageLedgerArtifacts,
  auditRuntimeControllerConsistency,
  auditRuleContradictions,
  runDeepAuditRules
} from "../dist/src/autolist/deep-audit-rules.js";
import { auditCurrentPaidImageLedgers } from "../dist/src/autolist/paid-image-audit.js";
import {
  initializePaidImageProductLedger,
  recordPaidImageCompleted,
  recordPaidImageFailedAfterAcceptance,
  recordPaidImageSubmitted,
  reservePaidImageSlot,
  sha256Text
} from "../dist/src/autolist/paid-image-submission-ledger.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const partialPaidLedgerAudit = auditPaidImageLedgerArtifacts({
  expectedSlotCount: 20,
  completed: 17,
  missing: 0,
  reserved: 0,
  submitted: 0,
  failedBeforeAcceptance: 0,
  failedAfterAcceptance: 3,
  ambiguous: 0
});
assert.equal(partialPaidLedgerAudit.ok, false);
assert.deepEqual(partialPaidLedgerAudit.errors, [{
  code: "paid_image_slots_incomplete",
  message: "Paid image ledger completed 17/20 expected slots.",
  count: 3
}]);
assert.deepEqual(partialPaidLedgerAudit.warnings, []);
assert.deepEqual(partialPaidLedgerAudit.evidence, [
  "expected=20",
  "completed=17",
  "missing=0",
  "reserved=0",
  "submitted=0",
  "failedBeforeAcceptance=0",
  "failedAfterAcceptance=3",
  "ambiguous=0"
]);

const completePaidLedgerAudit = auditPaidImageLedgerArtifacts({
  expectedSlotCount: 20,
  completed: 20,
  missing: 0,
  reserved: 0,
  submitted: 0,
  failedBeforeAcceptance: 0,
  failedAfterAcceptance: 0,
  ambiguous: 0
});
assert.equal(completePaidLedgerAudit.ok, true);
assert.deepEqual(completePaidLedgerAudit.errors, []);

for (const unsupportedExpectedCount of [10, 0]) {
  const unsupportedExpectedAudit = auditPaidImageLedgerArtifacts({
    ...completePaidLedgerAuditInput(),
    expectedSlotCount: unsupportedExpectedCount,
    completed: unsupportedExpectedCount
  });
  assert.equal(unsupportedExpectedAudit.ok, false);
  assert.equal(unsupportedExpectedAudit.errors[0]?.code, "paid_image_ledger_summary_inconsistent");
}

for (const inconsistentSummary of [
  { ...completePaidLedgerAuditInput(), completed: 20, ambiguous: 1 },
  { ...completePaidLedgerAuditInput(), completed: 20, reserved: 1 },
  { ...completePaidLedgerAuditInput(), completed: 21 },
  { ...completePaidLedgerAuditInput(), completed: 19.5, missing: 0.5 },
  { ...completePaidLedgerAuditInput(), failedAfterAcceptance: -1, missing: 1 }
]) {
  const inconsistentAudit = auditPaidImageLedgerArtifacts(inconsistentSummary);
  assert.equal(inconsistentAudit.ok, false);
  assert.equal(inconsistentAudit.errors[0]?.code, "paid_image_ledger_summary_inconsistent");
}

function completePaidLedgerAuditInput() {
  return {
    expectedSlotCount: 20,
    completed: 20,
    missing: 0,
    reserved: 0,
    submitted: 0,
    failedBeforeAcceptance: 0,
    failedAfterAcceptance: 0,
    ambiguous: 0
  };
}

const aggregatedPaidGeneration = aggregatePaidImageLedgerGeneration({
  completedProducts: [
    { recordId: "record-completed", expectedImageCount: 20, generatedImageCount: 20 }
  ],
  currentLedgers: [
    {
      recordId: "record-failed-current",
      summary: {
        expectedSlotCount: 20,
        completed: 17,
        missing: 0,
        reserved: 0,
        submitted: 0,
        failedBeforeAcceptance: 0,
        failedAfterAcceptance: 3,
        ambiguous: 0
      }
    },
    {
      recordId: "record-completed",
      summary: {
        expectedSlotCount: 20,
        completed: 20,
        missing: 0,
        reserved: 0,
        submitted: 0,
        failedBeforeAcceptance: 0,
        failedAfterAcceptance: 0,
        ambiguous: 0
      }
    }
  ]
});
assert.deepEqual(aggregatedPaidGeneration.summary, {
  auditedTaskCount: 2,
  expectedImageCount: 40,
  generatedImageCount: 37
});
assert.deepEqual(aggregatedPaidGeneration.includedRecordIds, ["record-failed-current"]);
assert.deepEqual(aggregatedPaidGeneration.errors, []);
assert.equal(aggregatedPaidGeneration.audits[0]?.errors[0]?.code, "paid_image_slots_incomplete");
assert.equal(
  aggregatedPaidGeneration.includedRecordIds.includes("record-never-entered-paid-generation"),
  false,
  "A record with no ledger must contribute nothing"
);

const missingCompletedIdentity = aggregatePaidImageLedgerGeneration({
  completedProducts: [
    { recordId: "", expectedImageCount: 20, generatedImageCount: 20 }
  ],
  currentLedgers: [{
    recordId: "record-current",
    summary: completePaidLedgerAuditInput()
  }]
});
assert.deepEqual(missingCompletedIdentity.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.equal(missingCompletedIdentity.errors[0]?.code, "paid_image_completed_record_identity_missing");

const duplicateCompletedIdentity = aggregatePaidImageLedgerGeneration({
  completedProducts: [
    { recordId: "record-duplicate", expectedImageCount: 20, generatedImageCount: 20 },
    { recordId: "record-duplicate", expectedImageCount: 20, generatedImageCount: 20 }
  ],
  currentLedgers: []
});
assert.deepEqual(duplicateCompletedIdentity.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.equal(duplicateCompletedIdentity.errors[0]?.code, "paid_image_completed_record_identity_duplicate");

const canonicalOverlap = aggregatePaidImageLedgerGeneration({
  completedProducts: [
    { recordId: "record-current", expectedImageCount: 20, generatedImageCount: 20 }
  ],
  currentLedgers: [{ recordId: "record-current", summary: completePaidLedgerAuditInput() }]
});
assert.deepEqual(canonicalOverlap.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.deepEqual(canonicalOverlap.includedRecordIds, []);
assert.deepEqual(canonicalOverlap.errors, []);

const whitespaceCompletedOverlap = aggregatePaidImageLedgerGeneration({
  completedProducts: [
    { recordId: " record-current ", expectedImageCount: 20, generatedImageCount: 20 }
  ],
  currentLedgers: [{ recordId: "record-current", summary: completePaidLedgerAuditInput() }]
});
assert.deepEqual(whitespaceCompletedOverlap.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.deepEqual(whitespaceCompletedOverlap.includedRecordIds, []);
assert.equal(whitespaceCompletedOverlap.errors[0]?.code, "paid_image_record_identity_noncanonical");

const whitespaceLedgerOverlap = aggregatePaidImageLedgerGeneration({
  completedProducts: [
    { recordId: "record-current", expectedImageCount: 20, generatedImageCount: 20 }
  ],
  currentLedgers: [{ recordId: " record-current ", summary: completePaidLedgerAuditInput() }]
});
assert.deepEqual(whitespaceLedgerOverlap.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.deepEqual(whitespaceLedgerOverlap.includedRecordIds, []);
assert.equal(whitespaceLedgerOverlap.errors[0]?.code, "paid_image_record_identity_noncanonical");

const whitespaceDuplicateCompletedIdentity = aggregatePaidImageLedgerGeneration({
  completedProducts: [
    { recordId: "record-current", expectedImageCount: 20, generatedImageCount: 20 },
    { recordId: " record-current ", expectedImageCount: 20, generatedImageCount: 20 }
  ],
  currentLedgers: []
});
assert.deepEqual(whitespaceDuplicateCompletedIdentity.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.deepEqual(
  whitespaceDuplicateCompletedIdentity.errors.map((issue) => issue.code),
  ["paid_image_record_identity_noncanonical", "paid_image_completed_record_identity_duplicate"]
);

const duplicateCanonicalLedgers = aggregatePaidImageLedgerGeneration({
  completedProducts: [],
  currentLedgers: [
    { recordId: "record-current", summary: completePaidLedgerAuditInput() },
    { recordId: "record-current", summary: completePaidLedgerAuditInput() }
  ]
});
assert.deepEqual(duplicateCanonicalLedgers.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.deepEqual(duplicateCanonicalLedgers.includedRecordIds, ["record-current"]);
assert.deepEqual(duplicateCanonicalLedgers.errors.map((issue) => issue.code), [
  "paid_image_ledger_record_identity_duplicate"
]);

const duplicateWhitespaceLedgers = aggregatePaidImageLedgerGeneration({
  completedProducts: [],
  currentLedgers: [
    { recordId: "record-current", summary: completePaidLedgerAuditInput() },
    { recordId: " record-current ", summary: completePaidLedgerAuditInput() }
  ]
});
assert.deepEqual(duplicateWhitespaceLedgers.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.deepEqual(duplicateWhitespaceLedgers.includedRecordIds, ["record-current"]);
assert.deepEqual(duplicateWhitespaceLedgers.errors.map((issue) => issue.code), [
  "paid_image_record_identity_noncanonical",
  "paid_image_ledger_record_identity_duplicate"
]);

const distinctCanonicalLedgers = aggregatePaidImageLedgerGeneration({
  completedProducts: [],
  currentLedgers: [
    { recordId: "record-one", summary: completePaidLedgerAuditInput() },
    { recordId: "record-two", summary: completePaidLedgerAuditInput() }
  ]
});
assert.deepEqual(distinctCanonicalLedgers.summary, {
  auditedTaskCount: 2,
  expectedImageCount: 40,
  generatedImageCount: 40
});
assert.deepEqual(distinctCanonicalLedgers.includedRecordIds, ["record-one", "record-two"]);
assert.deepEqual(distinctCanonicalLedgers.errors, []);

const paidAuditFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paid-image-deep-audit-"));
const paidAuditBatch = "current-feishu-batch";
const fixtureResultSource = path.join(paidAuditFixtureRoot, "generated.png");
fs.writeFileSync(fixtureResultSource, "verified-generated-image", "utf8");

function createPaidAuditLedger(recordId, completedCount, failedAfterAcceptanceCount, expectedSlotCount = 20) {
  const ledger = initializePaidImageProductLedger({
    rootDir: paidAuditFixtureRoot,
    batchFingerprint: paidAuditBatch,
    recordId,
    expectedSlotCount,
    providerIdentity: "provider",
    sourceImageDigest: sha256Text(`source:${recordId}`)
  });
  for (let slot = 1; slot <= completedCount + failedAfterAcceptanceCount; slot += 1) {
    reservePaidImageSlot({
      productDir: ledger.productDir,
      slot,
      requestDigest: sha256Text(`request:${recordId}:${slot}`),
      promptDigest: sha256Text(`prompt:${recordId}:${slot}`),
      owner: { pid: process.pid }
    });
    recordPaidImageSubmitted({
      productDir: ledger.productDir,
      slot,
      providerTaskId: `provider-${recordId}-${slot}`
    });
    if (slot <= completedCount) {
      recordPaidImageCompleted({
        productDir: ledger.productDir,
        slot,
        sourceFile: fixtureResultSource,
        providerTaskId: `provider-${recordId}-${slot}`
      });
    } else {
      recordPaidImageFailedAfterAcceptance({
        productDir: ledger.productDir,
        slot,
        providerTaskId: `provider-${recordId}-${slot}`,
        reason: "provider task failed after acceptance"
      });
    }
  }
  return ledger;
}

createPaidAuditLedger("record-failed-current", 17, 3);
createPaidAuditLedger("record-completed", 20, 0);
const behavioralPaidAudit = auditCurrentPaidImageLedgers({
  records: [
    { recordId: "record-failed-current", whiteBackgroundImages: [{ localFile: "/fixtures/failed.png" }] },
    { recordId: "record-never-entered-paid-generation", whiteBackgroundImages: [{ localFile: "/fixtures/absent.png" }] },
    { recordId: "record-completed", whiteBackgroundImages: [{ localFile: "/fixtures/completed.png" }] }
  ],
  processedImages: [],
  rootDir: paidAuditFixtureRoot,
  batchFingerprint: paidAuditBatch,
  completedGeneration: {
    ok: true,
    summary: { auditedTaskCount: 1, expectedImageCount: 20, generatedImageCount: 20 },
    errors: [],
    warnings: []
  },
  completedProducts: [
    { recordId: "record-completed", expectedImageCount: 20, generatedImageCount: 20 }
  ]
});
assert.equal(behavioralPaidAudit.generation.ok, false);
assert.deepEqual(behavioralPaidAudit.generation.summary, {
  auditedTaskCount: 2,
  expectedImageCount: 40,
  generatedImageCount: 37
});
assert.equal(
  behavioralPaidAudit.generation.errors.some((issue) => issue.code === "paid_image_slots_incomplete"),
  true
);
assert.deepEqual(behavioralPaidAudit.existingLedgerRecordIds, ["record-failed-current", "record-completed"]);
assert.deepEqual(behavioralPaidAudit.includedLedgerRecordIds, ["record-failed-current"]);
const behavioralDeepAudit = runDeepAuditRules({
  rules: { errors: [], warnings: [], evidence: [] },
  contradictions: { errors: [], warnings: [], evidence: [] },
  runtime: { errors: [], warnings: [], evidence: [] },
  identities: { errors: [], warnings: [], evidence: [] },
  recovery: { errors: [], warnings: [], evidence: [] },
  sideEffects: { errors: [], warnings: [], evidence: [] },
  artifacts: behavioralPaidAudit.artifacts,
  residue: { errors: [], warnings: [], evidence: [] }
});
assert.equal(behavioralDeepAudit.ok, false);
assert.equal(
  behavioralDeepAudit.dimensions.find((dimension) => dimension.name === "artifacts")?.errors
    .some((issue) => issue.code === "paid_image_slots_incomplete"),
  true
);
const corruptedLedger = createPaidAuditLedger("record-corrupted-current", 20, 0);
fs.writeFileSync(path.join(corruptedLedger.productDir, "results", "01.png"), "corrupted", "utf8");
const corruptedPaidAudit = auditCurrentPaidImageLedgers({
  records: [
    { recordId: "record-corrupted-current", whiteBackgroundImages: [{ localFile: "/fixtures/corrupted.png" }] }
  ],
  processedImages: [],
  rootDir: paidAuditFixtureRoot,
  batchFingerprint: paidAuditBatch,
  completedGeneration: {
    ok: true,
    summary: { auditedTaskCount: 0, expectedImageCount: 0, generatedImageCount: 0 },
    errors: [],
    warnings: []
  },
  completedProducts: []
});
assert.equal(corruptedPaidAudit.generation.ok, false);
assert.deepEqual(corruptedPaidAudit.generation.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 19
});
assert.equal(
  corruptedPaidAudit.generation.errors.some((issue) => issue.code === "paid_image_completed_result_invalid"),
  true,
  "corruption must remain explicit error evidence"
);
assert.equal(
  corruptedPaidAudit.generation.errors.some((issue) => issue.code === "paid_image_slots_incomplete"),
  true,
  "a corrupt completed result must not count as generated"
);
createPaidAuditLedger("record-unsupported-ten-slot", 10, 0, 10);
const unsupportedTenSlotAudit = auditCurrentPaidImageLedgers({
  records: [
    { recordId: "record-unsupported-ten-slot", whiteBackgroundImages: [{ localFile: "/fixtures/ten-slot.png" }] }
  ],
  processedImages: [],
  rootDir: paidAuditFixtureRoot,
  batchFingerprint: paidAuditBatch,
  completedGeneration: {
    ok: true,
    summary: { auditedTaskCount: 0, expectedImageCount: 0, generatedImageCount: 0 },
    errors: [],
    warnings: []
  },
  completedProducts: []
});
assert.equal(unsupportedTenSlotAudit.generation.ok, false);
assert.deepEqual(unsupportedTenSlotAudit.generation.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 10,
  generatedImageCount: 10
});
assert.equal(
  unsupportedTenSlotAudit.artifacts.errors.some((issue) => issue.code === "paid_image_ledger_summary_inconsistent"),
  true
);
assert.equal(runDeepAuditRules({
  rules: { errors: [], warnings: [], evidence: [] },
  contradictions: { errors: [], warnings: [], evidence: [] },
  runtime: { errors: [], warnings: [], evidence: [] },
  identities: { errors: [], warnings: [], evidence: [] },
  recovery: { errors: [], warnings: [], evidence: [] },
  sideEffects: { errors: [], warnings: [], evidence: [] },
  artifacts: unsupportedTenSlotAudit.artifacts,
  residue: { errors: [], warnings: [], evidence: [] }
}).ok, false);

const missingCompletedIdentityCoreAudit = auditCurrentPaidImageLedgers({
  records: [{ recordId: "record-completed", whiteBackgroundImages: [{ localFile: "/fixtures/current-complete.png" }] }],
  processedImages: [],
  rootDir: paidAuditFixtureRoot,
  batchFingerprint: paidAuditBatch,
  completedGeneration: {
    ok: true,
    summary: { auditedTaskCount: 1, expectedImageCount: 20, generatedImageCount: 20 },
    errors: [],
    warnings: []
  },
  completedProducts: [{ recordId: "", expectedImageCount: 20, generatedImageCount: 20 }]
});
assert.equal(missingCompletedIdentityCoreAudit.generation.ok, false);
assert.deepEqual(missingCompletedIdentityCoreAudit.generation.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.equal(
  missingCompletedIdentityCoreAudit.artifacts.errors.some(
    (issue) => issue.code === "paid_image_completed_record_identity_missing"
  ),
  true
);

const duplicateCompletedIdentityCoreAudit = auditCurrentPaidImageLedgers({
  records: [],
  processedImages: [],
  rootDir: paidAuditFixtureRoot,
  batchFingerprint: paidAuditBatch,
  completedGeneration: {
    ok: true,
    summary: { auditedTaskCount: 2, expectedImageCount: 40, generatedImageCount: 40 },
    errors: [],
    warnings: []
  },
  completedProducts: [
    { recordId: "record-duplicate", expectedImageCount: 20, generatedImageCount: 20 },
    { recordId: "record-duplicate", expectedImageCount: 20, generatedImageCount: 20 }
  ]
});
assert.equal(duplicateCompletedIdentityCoreAudit.generation.ok, false);
assert.deepEqual(duplicateCompletedIdentityCoreAudit.generation.summary, {
  auditedTaskCount: 1,
  expectedImageCount: 20,
  generatedImageCount: 20
});
assert.equal(
  duplicateCompletedIdentityCoreAudit.artifacts.errors.some(
    (issue) => issue.code === "paid_image_completed_record_identity_duplicate"
  ),
  true
);

for (const tamper of ["recordId", "batchFingerprint"]) {
  const requestedRecordId = `record-tampered-${tamper}`;
  const tamperedLedger = createPaidAuditLedger(requestedRecordId, 20, 0);
  const productFile = path.join(tamperedLedger.productDir, "product.json");
  const productJson = JSON.parse(fs.readFileSync(productFile, "utf8"));
  productJson[tamper] = `wrong-${tamper}`;
  fs.writeFileSync(productFile, JSON.stringify(productJson, null, 2) + "\n", "utf8");
  const tamperedAudit = auditCurrentPaidImageLedgers({
    records: [{ recordId: requestedRecordId, whiteBackgroundImages: [{ localFile: `/fixtures/${tamper}.png` }] }],
    processedImages: [],
    rootDir: paidAuditFixtureRoot,
    batchFingerprint: paidAuditBatch,
    completedGeneration: {
      ok: true,
      summary: { auditedTaskCount: 0, expectedImageCount: 0, generatedImageCount: 0 },
      errors: [],
      warnings: []
    },
    completedProducts: []
  });
  assert.equal(tamperedAudit.generation.ok, false);
  assert.equal(tamperedAudit.generation.summary.expectedImageCount, 20);
  assert.equal(tamperedAudit.generation.summary.generatedImageCount, 0);
  assert.equal(tamperedAudit.generation.errors.some((issue) => issue.code === "paid_image_ledger_invalid"), true);
  assert.deepEqual(tamperedAudit.existingLedgerRecordIds, []);
}
fs.rmSync(paidAuditFixtureRoot, { recursive: true, force: true });

const controllerFailureAudit = auditRuntimeControllerConsistency({
  controllerStatus: "failed",
  controllerActive: false,
  runStatus: "paused"
});
assert.equal(controllerFailureAudit.ok, false);
assert.deepEqual(
  controllerFailureAudit.errors.map((item) => item.code),
  ["controller_terminal_failed", "controller_run_status_contradiction"]
);
const auditCliSource = fs.readFileSync("src/cli/audit-auto-listing.ts", "utf8");
const paidImageAuditSource = fs.readFileSync("src/autolist/paid-image-audit.ts", "utf8");
assert.match(auditCliSource, /auditRuntimeControllerConsistency/);
assert.match(auditCliSource, /controllerRuntimeAudit\.evidence/);
assert.match(
  paidImageAuditSource,
  /paidImageProductLedgerDir\(input\.rootDir, input\.batchFingerprint, record\.recordId\)/,
  "Deep audit must resolve a paid-image ledger from the exact current batch and pending Feishu record identity"
);
assert.match(
  paidImageAuditSource,
  /summarizePaidImageProductLedger\(productDir,\s*"audit",\s*\{[\s\S]*batchFingerprint:\s*input\.batchFingerprint,[\s\S]*recordId:\s*record\.recordId[\s\S]*\}\)/,
  "Deep audit must call the authoritative summarizer with the exact current batch and record identity"
);
assert.match(
  paidImageAuditSource,
  /aggregatePaidImageLedgerGeneration/,
  "Deep audit must merge current paid ledgers into generation totals"
);
assert.match(
  auditCliSource,
  /latestRunState\(resolved\.runtimeRootDir, resolved\.simulateOnly, batchFingerprint, businessRuleFingerprint\)/,
  "Deep audit must select runtime evidence only from the exact current Feishu batch and business rules"
);
assert.match(
  auditCliSource,
  /state\.businessRuleFingerprint === currentBusinessRuleFingerprint/,
  "Historical run state from obsolete shop/category rules must be isolated from the current audit"
);
assert.match(
  auditCliSource,
  /state\.feishuBatchFingerprint === currentBatchFingerprint/,
  "Historical run state from another Feishu batch must be isolated from the current batch audit"
);
assert.match(
  auditCliSource,
  /controller_process_batch_fingerprint_mismatch/,
  "Deep audit must fail when an active controller process belongs to another Feishu batch"
);
assert.match(
  auditCliSource,
  /imageWaitCeilingMs:\s*imageServiceWaitCeilingMs/,
  "Deep audit must compare image wait rule sources against the executable wait ceiling"
);
assert.match(
  auditCliSource,
  /videosBase64AcceptedTaskPollCeilingMs:\s*videosBase64AcceptedTaskPollCeilingMs/,
  "Deep audit must independently compare accepted paid-task observation rules against the executable ceiling"
);
assert.match(
  auditCliSource,
  /docs\/auto-listing\/steps\/03-main-image-generation\.md/,
  "Deep audit must read the main-image rule source for contradiction checks"
);
assert.match(
  auditCliSource,
  /docs\/auto-listing\/stability-checklist\.md/,
  "Deep audit must read the stability checklist for contradiction checks"
);

const dimensions = runDeepAuditRules({
  rules: { errors: [], warnings: [], evidence: ["rule source loaded"] },
  contradictions: { errors: [{ code: "shop_count_mismatch", message: "docs and code differ" }], warnings: [], evidence: [] },
  runtime: { errors: [], warnings: [], evidence: [] },
  identities: { errors: [], warnings: [], evidence: [] },
  recovery: { errors: [], warnings: [], evidence: [] },
  sideEffects: { errors: [], warnings: [], evidence: [] },
  artifacts: { errors: [], warnings: [], evidence: [] },
  residue: { errors: [], warnings: [], evidence: [] }
});
assert.equal(dimensions.ok, false);
assert.deepEqual(dimensions.dimensions.map((item) => item.name), [
  "rules", "contradictions", "runtime", "identities", "recovery", "sideEffects", "artifacts", "residue"
]);

const expectedTargetKeys = Array.from({ length: 120 }, (_, index) => `target-${index + 1}`);
const identityAudit = auditCanonicalPublishEvidence({
  expectedTargetKeys,
  manifestTargetKeys: expectedTargetKeys.slice(0, 100),
  artifactTargetKeys: expectedTargetKeys
});
assert.equal(identityAudit.ok, false);
assert.equal(identityAudit.errors[0].code, "publish_manifest_identity_missing");
assert.equal(identityAudit.errors[0].count, 20);

const completeIdentityAudit = auditCanonicalPublishEvidence({
  expectedTargetKeys,
  manifestTargetKeys: expectedTargetKeys,
  artifactTargetKeys: expectedTargetKeys
});
assert.equal(completeIdentityAudit.ok, true);

const resumableIdentityAudit = auditCanonicalPublishEvidence({
  expectedTargetKeys: ["current-1", "current-2", "current-3"],
  manifestTargetKeys: ["current-1"],
  artifactTargetKeys: ["current-1"],
  requireComplete: false
});
assert.equal(resumableIdentityAudit.ok, true);
assert.deepEqual(resumableIdentityAudit.warnings.map((item) => item.code), [
  "publish_manifest_identity_pending",
  "publish_artifact_identity_pending"
]);
assert.match(
  auditCliSource,
  /expectedTargetKeySet[\s\S]*filter\(.*expectedTargetKeySet\.has/s,
  "Deep audit must scope a shared runtime manifest to the current task plan instead of flagging prior same-batch tasks as unexpected"
);

const contradictionAudit = auditRuleContradictions({
  categoryPlans: [{ category: "医疗器械", titleCount: 20, shopCount: 10, promptCount: 5 }],
  titleRuleText: "医疗器械：12 条标题",
  shopRuleText: "医疗器械：10 个店铺",
  promptRuleText: "医疗器械：5 段提示词"
});
assert.equal(contradictionAudit.ok, false);
assert.equal(contradictionAudit.errors[0].code, "title_count_rule_contradiction");

const currentShopRuleText = fs.readFileSync("docs/auto-listing/steps/09-shop-distribution.md", "utf8");
const currentCategoryPlanAudit = auditRuleContradictions({
  categoryPlans: [
    { category: "医疗器械", titleCount: 20, shopCount: 20, promptCount: 5 },
    { category: "非处方药", titleCount: 20, shopCount: 10, promptCount: 5 },
    { category: "保健食品", titleCount: 20, shopCount: 20, promptCount: 5 }
  ],
  titleRuleText: "医疗器械：20 条标题；非处方药：20 条标题；保健食品：20 条标题",
  shopRuleText: currentShopRuleText,
  promptRuleText: "医疗器械：5 段提示词；非处方药：5 段提示词；保健食品：5 段提示词"
});
assert.equal(currentCategoryPlanAudit.ok, true, currentCategoryPlanAudit.errors.map((item) => item.message).join("\n"));

const imageWaitContradictionAudit = auditRuleContradictions({
  categoryPlans: [{ category: "医疗器械", titleCount: 20, shopCount: 10, promptCount: 5 }],
  titleRuleText: "医疗器械：20 条标题",
  shopRuleText: "医疗器械：10 个店铺",
  promptRuleText: "医疗器械：5 段提示词",
  imageRuleText: "固定等待 5 分钟",
  stabilityRuleText: "图片服务等待不得超过 5 分钟",
  imageWaitCeilingMs: 3 * 60 * 1000
});
assert.equal(imageWaitContradictionAudit.ok, false);
assert.deepEqual(imageWaitContradictionAudit.errors.map((item) => item.code), [
  "main_image_wait_rule_contradiction",
  "stability_wait_rule_contradiction"
]);

const wrongPaidTaskCeilingSource = "videos-base64 已受理付费任务轮询最多等待 3 分钟，之后重新提交。";
const wrongDualThresholdAudit = auditRuleContradictions({
  categoryPlans: [],
  titleRuleText: "",
  shopRuleText: "",
  promptRuleText: "",
  imageRuleText: wrongPaidTaskCeilingSource,
  stabilityRuleText: wrongPaidTaskCeilingSource,
  imageWaitCeilingMs: 3 * 60 * 1000,
  videosBase64AcceptedTaskPollCeilingMs: 30 * 60 * 1000
});
assert.equal(wrongDualThresholdAudit.ok, false, "A three-minute paid-task ceiling must be rejected");
assert.equal(
  wrongDualThresholdAudit.errors.some((item) => item.code === "main_image_accepted_task_poll_rule_contradiction"),
  true
);
assert.equal(
  wrongDualThresholdAudit.errors.some((item) => item.code === "stability_accepted_task_poll_rule_contradiction"),
  true
);

const correctDualThresholdSource = [
  "外部服务等待最多 3 分钟；这是操作等待、退避和慢服务阈值，不得授权重新提交付费任务。",
  "videos-base64 已受理付费任务使用同一任务 ID，观察上限 30 分钟。",
  "供应商明确成功或失败立即退出；达到 30 分钟执行最终状态查询，只有仍为 queued/pending 才可标记 stale 并重试同一固定 slot，completed slot 永不重新生成。"
].join("\n");
const correctDualThresholdAudit = auditRuleContradictions({
  categoryPlans: [],
  titleRuleText: "",
  shopRuleText: "",
  promptRuleText: "",
  imageRuleText: correctDualThresholdSource,
  stabilityRuleText: correctDualThresholdSource,
  imageWaitCeilingMs: 3 * 60 * 1000,
  videosBase64AcceptedTaskPollCeilingMs: 30 * 60 * 1000
});
assert.equal(correctDualThresholdAudit.ok, true, correctDualThresholdAudit.errors.map((item) => item.message).join("\n"));
assert.deepEqual(correctDualThresholdAudit.evidence.slice(-2), [
  "imageServiceWaitCeilingMs=180000",
  "videosBase64AcceptedTaskPollCeilingMs=1800000"
]);

console.log("deep auto-listing audit rules passed");
