export const DEEP_AUDIT_DIMENSIONS = [
  "rules",
  "contradictions",
  "runtime",
  "identities",
  "recovery",
  "sideEffects",
  "artifacts",
  "residue"
] as const;

export type DeepAuditDimensionName = (typeof DEEP_AUDIT_DIMENSIONS)[number];

export interface DeepAuditIssue {
  code: string;
  message: string;
  count?: number;
}

export interface DeepAuditDimensionInput {
  errors: DeepAuditIssue[];
  warnings: DeepAuditIssue[];
  evidence: string[];
}

export interface DeepAuditDimension extends DeepAuditDimensionInput {
  name: DeepAuditDimensionName;
  ok: boolean;
}

export function runDeepAuditRules(
  input: Record<DeepAuditDimensionName, DeepAuditDimensionInput>
): { ok: boolean; dimensions: DeepAuditDimension[] } {
  const dimensions = DEEP_AUDIT_DIMENSIONS.map((name) => ({
    name,
    ok: input[name].errors.length === 0,
    errors: input[name].errors,
    warnings: input[name].warnings,
    evidence: input[name].evidence
  }));
  return {
    ok: dimensions.every((dimension) => dimension.ok),
    dimensions
  };
}

export function auditRuntimeControllerConsistency(input: {
  controllerStatus?: "running" | "completed" | "failed";
  controllerActive: boolean;
  runStatus?: string;
}): { ok: boolean; errors: DeepAuditIssue[]; warnings: DeepAuditIssue[]; evidence: string[] } {
  const errors: DeepAuditIssue[] = [];
  if (input.controllerStatus === "running" && !input.controllerActive) {
    errors.push({
      code: "controller_job_stale_running",
      message: "Controller job declares running but its supervisor process is not alive."
    });
  }
  if (input.controllerStatus === "failed") {
    errors.push({
      code: "controller_terminal_failed",
      message: "The latest controller job is terminal failed."
    });
    if (input.runStatus && input.runStatus !== "failed") {
      errors.push({
        code: "controller_run_status_contradiction",
        message: `Controller status is failed but the latest run status is ${input.runStatus}.`
      });
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    evidence: [
      `controllerStatus=${input.controllerStatus || "missing"}`,
      `controllerActive=${input.controllerActive}`,
      `runStatus=${input.runStatus || "missing"}`
    ]
  };
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function auditCanonicalPublishEvidence(input: {
  expectedTargetKeys: string[];
  manifestTargetKeys: string[];
  artifactTargetKeys: string[];
  requireComplete?: boolean;
}): { ok: boolean; errors: DeepAuditIssue[]; warnings: DeepAuditIssue[]; evidence: string[] } {
  const errors: DeepAuditIssue[] = [];
  const warnings: DeepAuditIssue[] = [];
  const expected = new Set(input.expectedTargetKeys);
  const manifest = new Set(input.manifestTargetKeys);
  const artifacts = new Set(input.artifactTargetKeys);
  const duplicateExpected = duplicateValues(input.expectedTargetKeys);
  const duplicateManifest = duplicateValues(input.manifestTargetKeys);
  const duplicateArtifacts = duplicateValues(input.artifactTargetKeys);

  if (duplicateExpected.length > 0) {
    errors.push({ code: "publish_target_identity_duplicate", message: "Expected publish target identities are duplicated.", count: duplicateExpected.length });
  }
  if (duplicateManifest.length > 0) {
    errors.push({ code: "publish_manifest_identity_duplicate", message: "Publish manifest target identities are duplicated.", count: duplicateManifest.length });
  }
  if (duplicateArtifacts.length > 0) {
    errors.push({ code: "publish_artifact_identity_duplicate", message: "Task publish artifact target identities are duplicated.", count: duplicateArtifacts.length });
  }

  const missingManifest = [...expected].filter((key) => !manifest.has(key));
  const missingArtifact = [...expected].filter((key) => !artifacts.has(key));
  const unexpectedManifest = [...manifest].filter((key) => !expected.has(key));
  const unexpectedArtifact = [...artifacts].filter((key) => !expected.has(key));
  if (missingManifest.length > 0) {
    (input.requireComplete === false ? warnings : errors).push({
      code: input.requireComplete === false ? "publish_manifest_identity_pending" : "publish_manifest_identity_missing",
      message: input.requireComplete === false ? "Publish manifest identities are pending for unexecuted targets." : "Publish manifest is missing canonical target identities.",
      count: missingManifest.length
    });
  }
  if (missingArtifact.length > 0) {
    (input.requireComplete === false ? warnings : errors).push({
      code: input.requireComplete === false ? "publish_artifact_identity_pending" : "publish_artifact_identity_missing",
      message: input.requireComplete === false ? "Publish artifact identities are pending for unexecuted targets." : "Task publish artifacts are missing canonical target identities.",
      count: missingArtifact.length
    });
  }
  if (unexpectedManifest.length > 0) {
    errors.push({ code: "publish_manifest_identity_unexpected", message: "Publish manifest contains identities outside the task plan.", count: unexpectedManifest.length });
  }
  if (unexpectedArtifact.length > 0) {
    errors.push({ code: "publish_artifact_identity_unexpected", message: "Task publish artifacts contain identities outside the task plan.", count: unexpectedArtifact.length });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    evidence: [
      `expected=${input.expectedTargetKeys.length}`,
      `manifest=${input.manifestTargetKeys.length}`,
      `artifacts=${input.artifactTargetKeys.length}`
    ]
  };
}

function includesCountRule(text: string, category: string, count: number, unit: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return normalized.includes(`${category}：${count}${unit}`) || normalized.includes(`${category}:${count}${unit}`);
}

export function auditRuleContradictions(input: {
  categoryPlans: Array<{ category: string; titleCount: number; shopCount: number; promptCount: number }>;
  titleRuleText: string;
  shopRuleText: string;
  promptRuleText: string;
}): { ok: boolean; errors: DeepAuditIssue[]; warnings: DeepAuditIssue[]; evidence: string[] } {
  const errors: DeepAuditIssue[] = [];
  for (const plan of input.categoryPlans) {
    if (!includesCountRule(input.titleRuleText, plan.category, plan.titleCount, "条标题")) {
      errors.push({ code: "title_count_rule_contradiction", message: `${plan.category} titleCount=${plan.titleCount} is not reflected in the title rule source.` });
    }
    if (!includesCountRule(input.shopRuleText, plan.category, plan.shopCount, "个店铺")) {
      errors.push({ code: "shop_count_rule_contradiction", message: `${plan.category} shopCount=${plan.shopCount} is not reflected in the shop rule source.` });
    }
    if (!includesCountRule(input.promptRuleText, plan.category, plan.promptCount, "段提示词")) {
      errors.push({ code: "prompt_count_rule_contradiction", message: `${plan.category} promptCount=${plan.promptCount} is not reflected in the prompt rule source.` });
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    evidence: input.categoryPlans.map((plan) => `${plan.category}:titles=${plan.titleCount},shops=${plan.shopCount},prompts=${plan.promptCount}`)
  };
}
