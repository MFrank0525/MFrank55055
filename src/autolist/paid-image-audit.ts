import fs from "node:fs";
import path from "node:path";
import type { FeishuProductRecord } from "../feishu/types.js";
import type { AutoListingAuditIssue, MainImageGenerationAuditResult } from "./audit-rules.js";
import {
  aggregatePaidImageLedgerGeneration,
  auditPaidImageLedgerArtifacts,
  type DeepAuditDimensionInput,
  type DeepAuditIssue
} from "./deep-audit-rules.js";
import {
  paidImageBatchLedgerDir,
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
  completedProducts: Array<{
    recordId?: string;
    expectedImageCount: number;
    generatedImageCount: number;
  }>;
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

function emptyLedgerSummary(): PaidImageLedgerSummary {
  return {
    expectedSlotCount: 20,
    completed: 0,
    missing: 20,
    reserved: 0,
    submitted: 0,
    failedBeforeAcceptance: 0,
    failedAfterAcceptance: 0,
    ambiguous: 0
  };
}

function requireCanonicalLedgerPath(productDir: string, realBatchDir: string): void {
  const productStat = fs.lstatSync(productDir);
  if (!productStat.isDirectory() || productStat.isSymbolicLink()) {
    throw new Error("batch entry must be a non-symlink directory");
  }
  const realProductDir = fs.realpathSync(productDir);
  if (realProductDir !== path.join(realBatchDir, path.basename(productDir))) {
    throw new Error("batch entry resolves outside its canonical directory");
  }

  const requiredPaths: Array<{ file: string; kind: "file" | "directory" }> = [
    { file: path.join(productDir, "product.json"), kind: "file" },
    { file: path.join(productDir, "slots"), kind: "directory" }
  ];
  for (const required of requiredPaths) {
    const stat = fs.lstatSync(required.file);
    const correctType = required.kind === "file" ? stat.isFile() : stat.isDirectory();
    if (!correctType || stat.isSymbolicLink()) {
      throw new Error(`${path.basename(required.file)} must be a non-symlink ${required.kind}`);
    }
    if (fs.realpathSync(required.file) !== path.join(realProductDir, path.basename(required.file))) {
      throw new Error(`${path.basename(required.file)} resolves outside its canonical path`);
    }
  }

  const slotsDir = path.join(productDir, "slots");
  for (const slotEntry of fs.readdirSync(slotsDir)) {
    const slotPath = path.join(slotsDir, slotEntry);
    const slotStat = fs.lstatSync(slotPath);
    if (!slotStat.isFile() || slotStat.isSymbolicLink()) {
      throw new Error(`slot entry must be a non-symlink file: ${slotEntry}`);
    }
  }
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
  const independentlyAuditedLedgers: Array<{
    label: string;
    audit: ReturnType<typeof auditPaidImageLedgerArtifacts>;
  }> = [];
  const validLedgerRecordIds = new Set<string>();
  const expectedByEntryName = new Map<string, { record: FeishuProductRecord; pending: boolean }>();
  const expectedByCanonicalRecordId = new Map<string, string>();
  for (const record of input.records) {
    if (!record.recordId) continue;
    const productDir = paidImageProductLedgerDir(input.rootDir, input.batchFingerprint, record.recordId);
    const entryName = path.basename(productDir);
    if (!expectedByEntryName.has(entryName)) {
      expectedByEntryName.set(entryName, {
        record,
        pending: recordIsPending(record, processedImages)
      });
    }
    if (!expectedByCanonicalRecordId.has(record.recordId.trim())) {
      expectedByCanonicalRecordId.set(record.recordId.trim(), entryName);
    }
  }

  const batchDir = paidImageBatchLedgerDir(input.rootDir, input.batchFingerprint);
  const validCanonicalEntries = new Set<string>();
  const claimedExpectedEntries = new Set<string>();
  const discoveredCanonicalRecordIds = new Set<string>();
  let batchEntries: string[] = [];
  let realBatchDir = "";
  let batchStat: fs.Stats | undefined;
  try {
    batchStat = fs.lstatSync(batchDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      resolutionErrors.push({
        code: "paid_image_ledger_path_invalid",
        message: `Current paid image batch ledger is invalid: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  if (batchStat) {
    try {
      if (!batchStat.isDirectory() || batchStat.isSymbolicLink()) {
        throw new Error("current batch ledger path must be a non-symlink directory");
      }
      realBatchDir = fs.realpathSync(batchDir);
      batchEntries = fs.readdirSync(batchDir);
    } catch (error) {
      resolutionErrors.push({
        code: "paid_image_ledger_path_invalid",
        message: `Current paid image batch ledger is invalid: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  const expectedEntryOrder = new Map([...expectedByEntryName.keys()].map((entryName, index) => [entryName, index]));
  batchEntries.sort((left, right) => {
    const leftIndex = expectedEntryOrder.get(left);
    const rightIndex = expectedEntryOrder.get(right);
    if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    return left.localeCompare(right);
  });

  for (const entryName of batchEntries) {
    const productDir = path.join(batchDir, entryName);
    const expected = expectedByEntryName.get(entryName);
    if (!expected) {
      resolutionErrors.push({
        code: "paid_image_ledger_unexpected_entry",
        message: `Unexpected paid image ledger batch entry: ${entryName}`
      });
    }

    let ledgerRecordId = expected?.record.recordId;
    try {
      requireCanonicalLedgerPath(productDir, realBatchDir);
      if (!expected) {
        const productValue = JSON.parse(fs.readFileSync(path.join(productDir, "product.json"), "utf8")) as {
          recordId?: unknown;
        };
        if (typeof productValue.recordId === "string") ledgerRecordId = productValue.recordId;
      }
      const inspected = expected
        ? summarizePaidImageProductLedger(productDir, "audit", {
            batchFingerprint: input.batchFingerprint,
            recordId: expected.record.recordId!
          })
        : summarizePaidImageProductLedger(productDir, "audit");
      if (ledgerRecordId) {
        const canonicalRecordId = ledgerRecordId.trim();
        const expectedEntryName = expectedByCanonicalRecordId.get(canonicalRecordId);
        if (expectedEntryName && expectedEntryName !== entryName) claimedExpectedEntries.add(expectedEntryName);
        if (discoveredCanonicalRecordIds.has(canonicalRecordId)) {
          resolutionErrors.push({
            code: "paid_image_ledger_record_identity_duplicate",
            message: `Multiple paid image ledger entries claim record identity ${canonicalRecordId}.`
          });
        }
        discoveredCanonicalRecordIds.add(canonicalRecordId);
      }
      if (expected) {
        validCanonicalEntries.add(entryName);
        if (expected.pending) {
          currentLedgers.push({ recordId: expected.record.recordId!, summary: inspected.summary });
          validLedgerRecordIds.add(expected.record.recordId!);
        } else {
          independentlyAuditedLedgers.push({
            label: expected.record.recordId!,
            audit: auditPaidImageLedgerArtifacts(inspected.summary)
          });
        }
        resolutionErrors.push(...inspected.errors.map((issue) => ({
          code: "paid_image_completed_result_invalid",
          message: `Paid image ledger for ${expected.record.recordId} has invalid completed artifact evidence: ${issue.message}`
        })));
      } else {
        independentlyAuditedLedgers.push({
          label: entryName,
          audit: auditPaidImageLedgerArtifacts(inspected.summary)
        });
        resolutionErrors.push(...inspected.errors.map((issue) => ({
          code: "paid_image_completed_result_invalid",
          message: `Unexpected paid image ledger ${entryName} has invalid completed artifact evidence: ${issue.message}`
        })));
      }
    } catch (error) {
      const pathError = error instanceof Error && /non-symlink|canonical (?:directory|path)|resolves outside/.test(error.message);
      resolutionErrors.push({
        code: pathError ? "paid_image_ledger_path_invalid" : "paid_image_ledger_invalid",
        message: `Paid image ledger entry ${entryName} is invalid: ${error instanceof Error ? error.message : String(error)}`
      });
      if (expected?.pending) {
        currentLedgers.push({ recordId: expected.record.recordId!, summary: emptyLedgerSummary() });
      }
      if (expected) claimedExpectedEntries.add(entryName);
    }
  }

  for (const entryName of claimedExpectedEntries) {
    if (!validCanonicalEntries.has(entryName)) {
      resolutionErrors.push({
        code: "paid_image_ledger_missing_expected_entry",
        message: `Paid image ledger identity evidence requires missing canonical batch entry: ${entryName}`
      });
    }
  }

  const aggregated = aggregatePaidImageLedgerGeneration({
    completedProducts: input.completedProducts,
    currentLedgers
  });
  const ledgerErrors = [
    ...resolutionErrors,
    ...independentlyAuditedLedgers.flatMap(({ audit }) => audit.errors),
    ...aggregated.errors,
    ...aggregated.audits.flatMap((audit) => audit.errors)
  ];
  const ledgerWarnings = [
    ...independentlyAuditedLedgers.flatMap(({ audit }) => audit.warnings),
    ...aggregated.audits.flatMap((audit) => audit.warnings)
  ];
  const evidence = [
    ...resolutionErrors.map((issue) => `paidImageLedger:invalid:${issue.message}`),
    ...independentlyAuditedLedgers.flatMap(({ label, audit }) =>
      audit.evidence.map((item) => `paidImageLedger:${label}:${item}`)
    ),
    ...currentLedgers.flatMap((ledger, index) =>
      aggregated.audits[index].evidence.map((item) => `paidImageLedger:${ledger.recordId}:${item}`)
    )
  ];
  const validCanonicalLedgerRecordIds = new Set(
    [...validLedgerRecordIds].map((recordId) => recordId.trim())
  );

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
    existingLedgerRecordIds: [...new Set(
      currentLedgers
        .map((ledger) => ledger.recordId)
        .filter((recordId) => validLedgerRecordIds.has(recordId))
        .map((recordId) => recordId.trim())
    )],
    includedLedgerRecordIds: aggregated.includedRecordIds
      .filter((recordId) => validCanonicalLedgerRecordIds.has(recordId))
  };
}
