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
  completedGeneration: {
    auditedTaskCount: 1,
    expectedImageCount: 20,
    generatedImageCount: 20
  },
  completedRecordIds: ["record-completed"],
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
assert.equal(aggregatedPaidGeneration.audits[0]?.errors[0]?.code, "paid_image_slots_incomplete");
assert.equal(
  aggregatedPaidGeneration.includedRecordIds.includes("record-never-entered-paid-generation"),
  false,
  "A record with no ledger must contribute nothing"
);

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
  completedRecordIds: ["record-completed"]
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
  completedRecordIds: []
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
  completedRecordIds: []
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
  /summarizePaidImageProductLedger\(productDir,\s*"audit"\)/,
  "Deep audit must call the authoritative project ledger summarizer in verified audit mode"
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

console.log("deep auto-listing audit rules passed");
