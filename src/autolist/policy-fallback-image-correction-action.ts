import fs from "node:fs";
import path from "node:path";
import {
  invalidateCompletedPaidImageSlot,
  readPaidImageSlotRecord,
  sha256File
} from "./paid-image-submission-ledger.js";
import { isPaidImagePolicyCompatibilityReason } from "./image-generation-rules.js";

export interface PolicyFallbackCorrectionTarget {
  slot: number;
  productImageFile: string;
}

function moveToArchive(sourceFile: string, archiveFile: string): void {
  if (!fs.existsSync(sourceFile)) return;
  if (fs.existsSync(archiveFile)) {
    throw new Error(`Policy-fallback correction archive target already exists: ${archiveFile}`);
  }
  fs.mkdirSync(path.dirname(archiveFile), { recursive: true });
  fs.renameSync(sourceFile, archiveFile);
}

export function preparePolicyFallbackImageCorrection(input: {
  taskDir: string;
  paidProductLedgerDir: string;
  expectedObsoletePromptDigest: string;
  archiveDir: string;
  targets: PolicyFallbackCorrectionTarget[];
  reason: string;
}): { slots: number[]; archivedFiles: string[] } {
  const slots = input.targets.map((target) => target.slot);
  if (!slots.length || new Set(slots).size !== slots.length) {
    throw new Error("Policy-fallback correction requires a non-empty unique slot list.");
  }
  const plannedRuntimeFiles: Array<{ source: string; archive: string }> = [];
  for (const target of input.targets) {
    const round = Math.floor((target.slot - 1) / 4) + 1;
    const localIndex = ((target.slot - 1) % 4) + 1;
    const rawDir = path.join(input.taskDir, `main-image-${String(round).padStart(2, "0")}`, "openai-compatible", "raw");
    const prefix = `generated-${String(localIndex).padStart(2, "0")}.png`;
    if (!fs.existsSync(path.join(rawDir, prefix))) {
      throw new Error(`Policy-fallback runtime raw image is missing for slot ${target.slot}.`);
    }
    for (const name of fs.readdirSync(rawDir).filter((entry) => entry === prefix || entry.startsWith(`${prefix}.`))) {
      plannedRuntimeFiles.push({
        source: path.join(rawDir, name),
        archive: path.join(input.archiveDir, "runtime", `slot-${String(target.slot).padStart(2, "0")}`, name)
      });
    }
    const obsoletePolicyRetryRequest = `request-${String(localIndex).padStart(2, "0")}-policy-retry.json`;
    if (fs.existsSync(path.join(rawDir, obsoletePolicyRetryRequest))) {
      plannedRuntimeFiles.push({
        source: path.join(rawDir, obsoletePolicyRetryRequest),
        archive: path.join(
          input.archiveDir,
          "runtime",
          `slot-${String(target.slot).padStart(2, "0")}`,
          obsoletePolicyRetryRequest
        )
      });
    }
    if (!path.isAbsolute(target.productImageFile) || !fs.existsSync(target.productImageFile)) {
      throw new Error(`Policy-fallback distributed product image is missing for slot ${target.slot}.`);
    }
    plannedRuntimeFiles.push({
      source: target.productImageFile,
      archive: path.join(input.archiveDir, "distributed", `slot-${String(target.slot).padStart(2, "0")}`, path.basename(target.productImageFile))
    });
  }
  for (const item of plannedRuntimeFiles) {
    if (fs.existsSync(item.archive)) {
      throw new Error(`Policy-fallback correction archive already contains ${item.archive}.`);
    }
  }
  for (const target of input.targets) {
    const record = readPaidImageSlotRecord({ productDir: input.paidProductLedgerDir, slot: target.slot });
    const hadExplicitPolicyFailure = record?.audit.some((entry) =>
      entry.state === "failed_after_acceptance" && isPaidImagePolicyCompatibilityReason(entry.reason || "")
    );
    if (!record || record.state !== "completed" || record.promptDigest !== input.expectedObsoletePromptDigest ||
        !hadExplicitPolicyFailure || !record.resultFile || !record.resultDigest || !fs.existsSync(record.resultFile) ||
        sha256File(record.resultFile) !== record.resultDigest) {
      throw new Error(`completed policy-fallback slot ${target.slot} failed closed invalidation checks`);
    }
    const ledgerArchiveDir = path.join(input.archiveDir, "paid-ledger");
    fs.mkdirSync(ledgerArchiveDir, { recursive: true });
    const archivedResultFile = path.join(ledgerArchiveDir, `slot-${String(target.slot).padStart(2, "0")}-${record.resultDigest}.png`);
    const archivedSlotFile = path.join(ledgerArchiveDir, `slot-${String(target.slot).padStart(2, "0")}.json`);
    if (fs.existsSync(archivedResultFile) || fs.existsSync(archivedSlotFile)) {
      throw new Error(`completed policy-fallback archive already exists for slot ${target.slot}`);
    }
    fs.copyFileSync(record.resultFile, archivedResultFile);
    fs.copyFileSync(path.join(input.paidProductLedgerDir, "slots", `${String(target.slot).padStart(2, "0")}.json`), archivedSlotFile);
    invalidateCompletedPaidImageSlot({
      productDir: input.paidProductLedgerDir,
      slot: target.slot,
      expectedPromptDigest: input.expectedObsoletePromptDigest,
      expectedResultDigest: record.resultDigest,
      reason: input.reason
    });
  }
  for (const item of plannedRuntimeFiles) moveToArchive(item.source, item.archive);
  return { slots, archivedFiles: plannedRuntimeFiles.map((item) => item.archive) };
}
