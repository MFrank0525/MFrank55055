import { getShopSpecs, type ShopSpec } from "./shop-rules.js";

export interface ShopAccessAuditEntry {
  sequence: number;
  shopCode: string;
  expectedShopName: string;
  actualShopName: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  errorClass: string;
  issue: string;
}

export interface ShopAccessSideEffects {
  navigationAttempted: boolean;
  shopSwitchAttempted: boolean;
  publishAttempted: boolean;
  formMutationAttempted: boolean;
}

export interface ShopAccessAuditFailure {
  shopCode: string;
  errorClass: string;
  message: string;
}

export interface ShopAccessAuditReport {
  runId: string;
  runtimeDir: string;
  resultFile: string;
  startedAt: string;
  finishedAt: string;
  status: "passed" | "failed";
  expectedShopCount: number;
  entries: ShopAccessAuditEntry[];
  sideEffects: ShopAccessSideEffects;
  failure?: ShopAccessAuditFailure;
}

function normalizeShopName(value: string): string {
  return value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
}

export function validateShopAccessAuditReport(
  report: ShopAccessAuditReport,
  expected: readonly ShopSpec[] = getShopSpecs()
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (report.status !== "passed") {
    errors.push(`Shop access audit status must be passed, got ${report.status}.`);
  }
  if (report.expectedShopCount !== expected.length) {
    errors.push(
      `Shop access audit expected shop count mismatch: report=${report.expectedShopCount}; expected=${expected.length}.`
    );
  }
  if (report.entries.length !== expected.length) {
    errors.push(`Shop access audit entry count mismatch: actual=${report.entries.length}; expected=${expected.length}.`);
  }

  const seenShopCodes = new Set<string>();
  for (let index = 0; index < report.entries.length; index += 1) {
    const entry = report.entries[index];
    const expectedShop = expected[index];
    if (seenShopCodes.has(entry.shopCode)) {
      errors.push(`Shop access audit duplicate shop code at sequence ${entry.sequence}: ${entry.shopCode}.`);
    }
    seenShopCodes.add(entry.shopCode);
    if (!expectedShop) {
      errors.push(`Shop access audit contains unexpected entry at sequence ${entry.sequence}: ${entry.shopCode}.`);
      continue;
    }
    if (entry.sequence !== index + 1) {
      errors.push(`Shop access audit sequence mismatch: actual=${entry.sequence}; expected=${index + 1}.`);
    }
    if (entry.shopCode !== expectedShop.shopCode) {
      errors.push(
        `Shop access audit expected shop mismatch at sequence ${index + 1}: actual=${entry.shopCode}; expected=${expectedShop.shopCode}.`
      );
    }
    if (normalizeShopName(entry.expectedShopName) !== normalizeShopName(expectedShop.watermarkText)) {
      errors.push(
        `Shop access audit expected name mismatch for ${expectedShop.shopCode}: report=${entry.expectedShopName}; expected=${expectedShop.watermarkText}.`
      );
    }
    if (normalizeShopName(entry.actualShopName) !== normalizeShopName(expectedShop.watermarkText)) {
      errors.push(
        `Shop access audit actual name mismatch for ${expectedShop.shopCode}: actual=${entry.actualShopName}; expected=${expectedShop.watermarkText}.`
      );
    }
    if (!entry.passed) {
      errors.push(`Shop access audit entry ${entry.shopCode} did not pass: ${entry.issue || entry.errorClass || "unknown error"}.`);
    }
  }

  if (report.sideEffects.publishAttempted) {
    errors.push("Shop access audit must not attempt any publish action.");
  }
  if (report.sideEffects.formMutationAttempted) {
    errors.push("Shop access audit must not attempt any form mutation.");
  }

  return { ok: errors.length === 0, errors };
}
