import assert from "node:assert/strict";
import {
  auditCanonicalPublishEvidence,
  auditRuntimeControllerConsistency,
  auditRuleContradictions,
  runDeepAuditRules
} from "../dist/src/autolist/deep-audit-rules.js";
import fs from "node:fs";

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
assert.match(auditCliSource, /auditRuntimeControllerConsistency/);
assert.match(auditCliSource, /controllerRuntimeAudit\.evidence/);
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
