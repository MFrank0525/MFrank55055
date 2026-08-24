import fs from "node:fs";
import { isFullyDecodableImageFile } from "../utils/image-integrity.js";
import { isUnsafePaidImageReplayReason } from "./image-generation-rules.js";

export interface PaidImageProviderIdentityMigration {
  at: string;
  previousProviderIdentity: string;
  nextProviderIdentity: string;
  proofProviderTaskId: string;
  proofResultDigest: string;
}

export interface PaidImageProviderIdentityProofCandidate {
  currentProviderIdentity: string;
  providerTaskId: string;
  resultDigest: string;
}

export interface PaidImageProviderIdentityRotationInput {
  productDir: string;
  previousProviderIdentity: string;
  nextProviderIdentity: string;
  proofProviderTaskId: string;
  proofResultDigest: string;
}

export function isPaidImageCompletedResultValid(
  record: { state?: string; resultFile?: string; resultDigest?: string } | undefined,
  sha256File: (file: string) => string
): boolean {
  return Boolean(
    record?.state === "completed" &&
    record.resultFile &&
    record.resultDigest &&
    fs.existsSync(record.resultFile) &&
    sha256File(record.resultFile) === record.resultDigest &&
    isFullyDecodableImageFile(record.resultFile)
  );
}

export function isPaidImageProviderIdentityMigrationHistoryValid(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((entry) =>
    entry && typeof entry.at === "string" && typeof entry.previousProviderIdentity === "string" &&
    typeof entry.nextProviderIdentity === "string" && typeof entry.proofProviderTaskId === "string" &&
    typeof entry.proofResultDigest === "string"
  ));
}

export function selectPaidImageProviderIdentityProofCandidate(input: {
  currentProviderIdentity: string;
  records: Array<{ state?: string; providerTaskId?: string; resultDigest?: string }>;
  resultIsValid: (record: { resultDigest?: string }) => boolean;
}): PaidImageProviderIdentityProofCandidate | undefined {
  const record = input.records.find((item) =>
    item.state === "completed" && Boolean(item.providerTaskId && item.resultDigest) && input.resultIsValid(item)
  );
  return record ? {
    currentProviderIdentity: input.currentProviderIdentity,
    providerTaskId: record.providerTaskId as string,
    resultDigest: record.resultDigest as string
  } : undefined;
}

export function validatePaidImageExistingResultRecoveryPlanRule(input: {
  expectedSlotCount: number;
  mappings: Array<{ targetSlot: number; sourceSlot: number }>;
  readRecord: (slot: number) => any;
  sha256File: (file: string) => string;
}): void {
  if (!input.mappings.length) throw new Error("operator-approved paid image recovery requires mappings");
  if (new Set(input.mappings.map((item) => item.targetSlot)).size !== input.mappings.length)
    throw new Error("operator-approved paid image recovery requires unique target slots");
  if (new Set(input.mappings.map((item) => item.sourceSlot)).size !== input.mappings.length)
    throw new Error("operator-approved paid image recovery requires unique source slots");
  for (const mapping of input.mappings) {
    for (const slot of [mapping.targetSlot, mapping.sourceSlot]) {
      if (!Number.isInteger(slot) || slot < 1 || slot > input.expectedSlotCount)
        throw new Error(`paid image slot ${slot} is outside expected range 1-${input.expectedSlotCount}`);
    }
    if (mapping.targetSlot === mapping.sourceSlot)
      throw new Error("operator-approved paid image recovery requires different source and target slots");
    const target = input.readRecord(mapping.targetSlot);
    const source = input.readRecord(mapping.sourceSlot);
    if (!target || target.state !== "failed_after_acceptance")
      throw new Error(`operator-approved paid image recovery target slot ${mapping.targetSlot} must be failed_after_acceptance, got ${target?.state || "missing"}`);
    if (target.replayDisposition === "non_replayable" || isUnsafePaidImageReplayReason(target.reason || ""))
      throw new Error(`operator-approved paid image recovery target slot ${mapping.targetSlot} has unsafe terminal evidence`);
    if (!isPaidImageCompletedResultValid(source, input.sha256File))
      throw new Error(`operator-approved paid image recovery source slot ${mapping.sourceSlot} is not a valid completed result`);
  }
}
