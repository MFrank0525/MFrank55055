import fs from "node:fs";
import path from "node:path";
import type { FeishuProductRecord } from "../feishu/types.js";
import type { AutoListingAuditIssue, MainImageGenerationAuditResult } from "./audit-rules.js";
import {
  aggregatePaidImageLedgerGeneration,
  type DeepAuditDimensionInput,
  type DeepAuditIssue
} from "./deep-audit-rules.js";
import {
  paidImageProductLedgerDir,
  summarizePaidImageProductLedger,
  type PaidImageLedgerSummary
} from "./paid-image-submission-ledger.js";

export interface CurrentPaidImageLedgerAuditInput {
  records: FeishuProductRecord[];
  processedImages: Iterable<string>;
  rootDir: string;
  batchFingerprint: string;
  completedGeneration: MainImageGenerationAuditResult;
  completedRecordIds: string[];
}

export interface CurrentPaidImageLedgerAuditResult {
  generation: MainImageGenerationAuditResult;
  artifacts: DeepAuditDimensionInput;
  existingLedgerRecordIds: string[];
  includedLedgerRecordIds: string[];
}

function recordIsPending(record: FeishuProductRecord, processedImages: Set<string>): boolean {
  const localFiles = (record.whiteBackgroundImages || [])
    .map((image) => image.localFile || "")
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath));
  if (localFiles.some((filePath) => processedImages.has(filePath))) return false;
  if (record.recordId && [...processedImages].some((filePath) => filePath.includes(`-${record.recordId}-白底图-`))) {
    return false;
  }
  return true;
}

function asAutoListingIssue(issue: DeepAuditIssue, severity: "error" | "warning"): AutoListingAuditIssue {
  return { severity, code: issue.code, message: issue.message };
}

export function auditCurrentPaidImageLedgers(
  input: CurrentPaidImageLedgerAuditInput
): CurrentPaidImageLedgerAuditResult {
  const processedImages = new Set([...input.processedImages].filter(Boolean).map((filePath) => path.resolve(filePath)));
  const currentLedgers: Array<{
    recordId: string;
    summary: PaidImageLedgerSummary;
  }> = [];
  const resolutionErrors: DeepAuditIssue[] = [];
  const seenRecordIds = new Set<string>();

  for (const record of input.records) {
    if (!record.recordId || seenRecordIds.has(record.recordId) || !recordIsPending(record, processedImages)) continue;
    seenRecordIds.add(record.recordId);
    const productDir = paidImageProductLedgerDir(input.rootDir, input.batchFingerprint, record.recordId);
    if (!fs.existsSync(productDir)) continue;
    try {
      const inspected = summarizePaidImageProductLedger(productDir, "audit");
      currentLedgers.push({
        recordId: record.recordId,
        summary: inspected.summary
      });
      resolutionErrors.push(...inspected.errors.map((issue) => ({
        code: "paid_image_completed_result_invalid",
        message: `Paid image ledger for ${record.recordId} has invalid completed artifact evidence: ${issue.message}`
      })));
    } catch (error) {
      resolutionErrors.push({
        code: "paid_image_ledger_invalid",
        message: `Paid image ledger for ${record.recordId} is invalid: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  const aggregated = aggregatePaidImageLedgerGeneration({
    completedGeneration: input.completedGeneration.summary,
    completedRecordIds: input.completedRecordIds,
    currentLedgers
  });
  const ledgerErrors = [...resolutionErrors, ...aggregated.audits.flatMap((audit) => audit.errors)];
  const ledgerWarnings = aggregated.audits.flatMap((audit) => audit.warnings);
  const evidence = [
    ...resolutionErrors.map((issue) => `paidImageLedger:invalid:${issue.message}`),
    ...currentLedgers.flatMap((ledger, index) =>
      aggregated.audits[index].evidence.map((item) => `paidImageLedger:${ledger.recordId}:${item}`)
    )
  ];

  return {
    generation: {
      ...input.completedGeneration,
      ok: input.completedGeneration.ok && ledgerErrors.length === 0,
      summary: aggregated.summary,
      errors: [
        ...input.completedGeneration.errors,
        ...ledgerErrors.map((issue) => asAutoListingIssue(issue, "error"))
      ],
      warnings: [
        ...input.completedGeneration.warnings,
        ...ledgerWarnings.map((issue) => asAutoListingIssue(issue, "warning"))
      ]
    },
    artifacts: { errors: ledgerErrors, warnings: ledgerWarnings, evidence },
    existingLedgerRecordIds: currentLedgers.map((ledger) => ledger.recordId),
    includedLedgerRecordIds: aggregated.includedRecordIds
  };
}
