import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "../utils/atomic-file.js";
import type { PublishManifestEntry } from "./publish-manifest.js";
import type { ImageTaskState } from "./types.js";

export interface CompletedProductEvidence {
  version: 1;
  batchFingerprint: string;
  businessRuleFingerprint: string;
  recordId: string;
  createdAt: string;
  task: ImageTaskState;
  manifestEntries: PublishManifestEntry[];
}

export function completedProductEvidenceRoot(runtimeRootDir: string): string {
  return path.join(path.dirname(path.resolve(runtimeRootDir)), "completed-products");
}

export function completedProductEvidenceFile(rootDir: string, batchFingerprint: string, recordId: string): string {
  return path.join(path.resolve(rootDir), encodeURIComponent(batchFingerprint), `${encodeURIComponent(recordId)}.json`);
}

export function saveCompletedProductEvidence(rootDir: string, evidence: CompletedProductEvidence): string {
  if (!evidence.batchFingerprint || !evidence.recordId || evidence.task.feishuProductRecord?.recordId !== evidence.recordId) {
    throw new Error("Completed product evidence requires one exact batch, record, and task identity.");
  }
  if (evidence.task.status !== "done" || evidence.manifestEntries.length === 0) {
    throw new Error("Completed product evidence requires a done task and non-empty canonical publish coverage.");
  }
  const file = completedProductEvidenceFile(rootDir, evidence.batchFingerprint, evidence.recordId);
  atomicWriteJson(file, evidence);
  return file;
}

export function loadCompletedProductEvidenceForBatch(rootDir: string, batchFingerprint: string): CompletedProductEvidence[] {
  const batchDir = path.join(path.resolve(rootDir), encodeURIComponent(batchFingerprint));
  if (!batchFingerprint || !fs.existsSync(batchDir)) return [];
  return fs.readdirSync(batchDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(batchDir, name), "utf8")) as CompletedProductEvidence)
    .filter((item) => item.version === 1 && item.batchFingerprint === batchFingerprint);
}
