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

export function shouldRequirePublishTargetIdentity(input: {
  recordId?: string;
  status?: string;
  hasMainImageArtifact?: boolean;
  generatedProductFolderCount?: number;
  distributedProductFolderCount?: number;
  publishResultCount?: number;
}): boolean {
  if (input.recordId?.trim()) {
    return true;
  }
  return Boolean(
    input.hasMainImageArtifact ||
      Number(input.generatedProductFolderCount || 0) > 0 ||
      Number(input.distributedProductFolderCount || 0) > 0 ||
      Number(input.publishResultCount || 0) > 0 ||
      ["main_images_generated", "product_folders_built", "titles_generated", "titles_distributed", "metadata_enriched", "qualifications_attached", "shop_distributed", "published", "cleaned", "done"].includes(
        input.status || ""
      )
  );
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

export interface PaidImageLedgerArtifactInput {
  expectedSlotCount: number;
  completed: number;
  missing: number;
  reserved: number;
  submitted: number;
  failedBeforeAcceptance: number;
  failedAfterAcceptance: number;
  ambiguous: number;
}

export function auditPaidImageLedgerArtifacts(
  input: PaidImageLedgerArtifactInput
): { ok: boolean; errors: DeepAuditIssue[]; warnings: DeepAuditIssue[]; evidence: string[] } {
  const errors: DeepAuditIssue[] = [];
  const stateCounts = [
    input.completed,
    input.missing,
    input.reserved,
    input.submitted,
    input.failedBeforeAcceptance,
    input.failedAfterAcceptance,
    input.ambiguous
  ];
  const summaryIsConsistent =
    input.expectedSlotCount === 20 &&
    stateCounts.every((count) => Number.isInteger(count) && count >= 0) &&
    input.completed <= input.expectedSlotCount &&
    stateCounts.reduce((total, count) => total + count, 0) === input.expectedSlotCount;
  if (!summaryIsConsistent) {
    errors.push({
      code: "paid_image_ledger_summary_inconsistent",
      message: "Paid image ledger summary contains invalid counts or does not cover exactly the expected slots."
    });
  }
  if (input.completed < input.expectedSlotCount) {
    errors.push({
      code: "paid_image_slots_incomplete",
      message: `Paid image ledger completed ${input.completed}/${input.expectedSlotCount} expected slots.`,
      count: input.expectedSlotCount - input.completed
    });
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    evidence: [
      `expected=${input.expectedSlotCount}`,
      `completed=${input.completed}`,
      `missing=${input.missing}`,
      `reserved=${input.reserved}`,
      `submitted=${input.submitted}`,
      `failedBeforeAcceptance=${input.failedBeforeAcceptance}`,
      `failedAfterAcceptance=${input.failedAfterAcceptance}`,
      `ambiguous=${input.ambiguous}`
    ]
  };
}

export function aggregatePaidImageLedgerGeneration(input: {
  completedProducts: Array<{
    recordId?: string;
    expectedImageCount: number;
    generatedImageCount: number;
  }>;
  currentLedgers: Array<{ recordId: string; summary: PaidImageLedgerArtifactInput }>;
}): {
  summary: { auditedTaskCount: number; expectedImageCount: number; generatedImageCount: number };
  includedRecordIds: string[];
  completedRecordIds: string[];
  errors: DeepAuditIssue[];
  audits: Array<ReturnType<typeof auditPaidImageLedgerArtifacts>>;
} {
  const completedRecordIds = new Set<string>();
  const completedProducts: typeof input.completedProducts = [];
  const errors: DeepAuditIssue[] = [];
  for (const product of input.completedProducts) {
    const rawRecordId = product.recordId || "";
    const recordId = rawRecordId.trim();
    if (!recordId) {
      errors.push({
        code: "paid_image_completed_record_identity_missing",
        message: "Completed main-image artifact is missing its Feishu record identity."
      });
      continue;
    }
    if (rawRecordId !== recordId) {
      errors.push({
        code: "paid_image_record_identity_noncanonical",
        message: `Paid image audit record identity has surrounding whitespace: ${JSON.stringify(rawRecordId)}.`
      });
    }
    if (completedRecordIds.has(recordId)) {
      errors.push({
        code: "paid_image_completed_record_identity_duplicate",
        message: `Completed main-image artifacts duplicate Feishu record identity ${recordId}.`
      });
      continue;
    }
    completedRecordIds.add(recordId);
    completedProducts.push({ ...product, recordId });
  }
  const normalizedLedgers: typeof input.currentLedgers = [];
  const ledgerRecordIds = new Set<string>();
  for (const ledger of input.currentLedgers) {
    const recordId = ledger.recordId.trim();
    if (ledger.recordId !== recordId) {
      errors.push({
        code: "paid_image_record_identity_noncanonical",
        message: `Paid image audit record identity has surrounding whitespace: ${JSON.stringify(ledger.recordId)}.`
      });
    }
    if (ledgerRecordIds.has(recordId)) {
      errors.push({
        code: "paid_image_ledger_record_identity_duplicate",
        message: `Paid image ledgers duplicate Feishu record identity ${recordId}.`
      });
      continue;
    }
    ledgerRecordIds.add(recordId);
    normalizedLedgers.push({ ...ledger, recordId });
  }
  const includedLedgers = normalizedLedgers.filter((ledger) => !completedRecordIds.has(ledger.recordId));
  return {
    summary: {
      auditedTaskCount: completedProducts.length + includedLedgers.length,
      expectedImageCount: completedProducts.reduce((total, product) => total + product.expectedImageCount, 0) + includedLedgers.reduce((total, ledger) => total + ledger.summary.expectedSlotCount, 0),
      generatedImageCount: completedProducts.reduce((total, product) => total + product.generatedImageCount, 0) + includedLedgers.reduce((total, ledger) => total + ledger.summary.completed, 0)
    },
    includedRecordIds: includedLedgers.map((ledger) => ledger.recordId),
    completedRecordIds: [...completedRecordIds],
    errors,
    audits: input.currentLedgers.map((ledger) => auditPaidImageLedgerArtifacts(ledger.summary))
  };
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

function timingRuleStatements(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+\.\s+|\d+(?:\.\d+)+\s+)/, "").replace(/\s+/g, ""))
    .filter(Boolean);
}

function timingRuleClauses(statement: string): string[] {
  return statement.split(/[。！？!?；;]+/).filter(Boolean);
}

function concernsAcceptedTask(text: string): boolean {
  return /已受理[^。；]*任务/.test(text) || text.includes("付费任务");
}

function acceptedObservationClauses(statement: string): Array<{ text: string; acceptedTaskContext: boolean }> {
  const clauses: Array<{ text: string; acceptedTaskContext: boolean }> = [];
  for (const sentence of statement.split(/[。！？!?]+/).filter(Boolean)) {
    let acceptedTaskContext = false;
    for (const clause of sentence.split(/[；;]+/).filter(Boolean)) {
      acceptedTaskContext ||= concernsAcceptedTask(clause);
      clauses.push({ text: clause, acceptedTaskContext });
    }
  }
  return clauses;
}

function extractAcceptedObservationMinuteValues(statement: string): number[] {
  const values: number[] = [];
  const patterns = [
    /(\d+)分钟(?:是|作为)?[^。；]*(?:已受理[^。；]*任务|付费任务)[^。；]*(?:固定观察上限|观察上限)/g,
    /固定观察上限(?:为|是)?(\d+)分钟/g,
    /观察上限(?:为|是)?(\d+)分钟/g,
    /观察上限不得超过(\d+)分钟/g,
    /最多观察(\d+)分钟/g,
    /观察(?:期限|时间)?不得超过(\d+)分钟/g,
    /轮询最多等待(\d+)分钟/g,
    /轮询等待(?:上限(?:为|是)?|不得超过|最多(?:为)?|为)?(\d+)分钟/g,
    /轮询(?:最大|最长)等待(?:为)?(\d+)分钟/g,
    /最多轮询等待(\d+)分钟/g
  ];
  for (const clause of acceptedObservationClauses(statement)) {
    if (!clause.acceptedTaskContext) continue;
    if (/不得把[^。；]*当作[^。；]*观察上限/.test(clause.text)) continue;
    for (const pattern of patterns) {
      for (const match of clause.text.matchAll(pattern)) values.push(Number(match[1]));
    }
  }
  return values;
}

function hasOperationalPaidResubmissionConflict(statements: string[], operationalCeilingMs: number): boolean {
  const operationalMinutes = Math.floor(operationalCeilingMs / 60000);
  return statements.flatMap(timingRuleClauses).some((clause) =>
    clause.includes(`${operationalMinutes}分钟`) &&
    clause.includes("付费任务") &&
    clause.includes("重新提交") &&
    !/(?:不得|不能|禁止)[^。；]*重新提交/.test(clause)
  );
}

function includesOperationalImageWaitRule(text: string, ceilingMs: number): boolean {
  const minutes = Math.floor(ceilingMs / 60000);
  const statements = timingRuleStatements(text);
  if (hasOperationalPaidResubmissionConflict(statements, ceilingMs)) return false;
  return statements.some((statement) =>
    statement.includes(`${minutes}分钟`) &&
    statement.includes("操作层外部服务等待") &&
    statement.includes("退避") &&
    statement.includes("慢服务阈值") &&
    /(?:不得|不能|禁止)[^。；]*重新提交付费任务/.test(statement)
  );
}

function includesAcceptedTaskObservationRule(text: string, ceilingMs: number): boolean {
  const minutes = Math.floor(ceilingMs / 60000);
  const statements = timingRuleStatements(text);
  const statedObservationMinutes = statements.flatMap(extractAcceptedObservationMinuteValues);
  if (statedObservationMinutes.some((value) => value !== minutes)) return false;
  return statements.some((statement) => {
    const hasAcceptedPaidTask = concernsAcceptedTask(statement);
    const hasSameTaskIdentity = /同一(?:task|任务)ID/i.test(statement);
    const hasObservationCeiling = extractAcceptedObservationMinuteValues(statement).includes(minutes);
    const hasFinalQuery = new RegExp(`${minutes}分钟[^。；]*最终状态查询`).test(statement);
    return hasAcceptedPaidTask && hasSameTaskIdentity && hasObservationCeiling && hasFinalQuery;
  });
}

export function auditRuleContradictions(input: {
  categoryPlans: Array<{ category: string; titleCount: number; shopCount: number; promptCount: number }>;
  titleRuleText: string;
  shopRuleText: string;
  promptRuleText: string;
  imageRuleText?: string;
  stabilityRuleText?: string;
  imageWaitCeilingMs?: number;
  videosBase64AcceptedTaskPollCeilingMs?: number;
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
  if (Number.isFinite(input.imageWaitCeilingMs || NaN)) {
    const ceilingMs = Number(input.imageWaitCeilingMs);
    if (input.imageRuleText !== undefined && !includesOperationalImageWaitRule(input.imageRuleText, ceilingMs)) {
      errors.push({
        code: "main_image_wait_rule_contradiction",
        message: `Main image rule source does not reflect image service wait ceiling ${ceilingMs}ms.`
      });
    }
    if (input.stabilityRuleText !== undefined && !includesOperationalImageWaitRule(input.stabilityRuleText, ceilingMs)) {
      errors.push({
        code: "stability_wait_rule_contradiction",
        message: `Stability checklist does not reflect image service wait ceiling ${ceilingMs}ms.`
      });
    }
  }
  if (Number.isFinite(input.videosBase64AcceptedTaskPollCeilingMs || NaN)) {
    const ceilingMs = Number(input.videosBase64AcceptedTaskPollCeilingMs);
    if (input.imageRuleText !== undefined && !includesAcceptedTaskObservationRule(input.imageRuleText, ceilingMs)) {
      errors.push({
        code: "main_image_accepted_task_poll_rule_contradiction",
        message: `Main image rule source does not reflect accepted paid-task observation ceiling ${ceilingMs}ms and its final status query.`
      });
    }
    if (input.stabilityRuleText !== undefined && !includesAcceptedTaskObservationRule(input.stabilityRuleText, ceilingMs)) {
      errors.push({
        code: "stability_accepted_task_poll_rule_contradiction",
        message: `Stability checklist does not reflect accepted paid-task observation ceiling ${ceilingMs}ms and its final status query.`
      });
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    evidence: [
      ...input.categoryPlans.map((plan) => `${plan.category}:titles=${plan.titleCount},shops=${plan.shopCount},prompts=${plan.promptCount}`),
      ...(Number.isFinite(input.imageWaitCeilingMs || NaN) ? [`imageServiceWaitCeilingMs=${Number(input.imageWaitCeilingMs)}`] : []),
      ...(Number.isFinite(input.videosBase64AcceptedTaskPollCeilingMs || NaN)
        ? [`videosBase64AcceptedTaskPollCeilingMs=${Number(input.videosBase64AcceptedTaskPollCeilingMs)}`]
        : [])
    ]
  };
}
