import fs from "node:fs";
import path from "node:path";
import type { FeishuProductRecord } from "../feishu/types.js";
import { atomicWriteJson } from "../utils/atomic-file.js";
import {
  buildMainImageCopyCandidateDigest,
  countMainImageCopyCombinations,
  digestSelectedMainImageCopy,
  type MainImageCopyRecordHistory
} from "./main-image-copy-rotation-rules.js";

export const MAIN_IMAGE_COPY_SELECTION_HISTORY_SCHEMA_VERSION = 1;
export const DEFAULT_MAIN_IMAGE_COPY_SELECTION_HISTORY_FILE = "data/auto-listing/main-image-copy-selection-history.json";

export interface MainImageCopySelectionHistory {
  schemaVersion: 1;
  records: Record<string, MainImageCopyRecordHistory>;
  batches: Record<string, {
    committedAt: string;
    selections: Record<string, string>;
  }>;
}

function emptyHistory(): MainImageCopySelectionHistory {
  return { schemaVersion: MAIN_IMAGE_COPY_SELECTION_HISTORY_SCHEMA_VERSION, records: {}, batches: {} };
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`${label} must be a non-empty string array.`);
  }
}

export function loadMainImageCopySelectionHistory(historyFile = DEFAULT_MAIN_IMAGE_COPY_SELECTION_HISTORY_FILE): MainImageCopySelectionHistory {
  const resolved = path.resolve(historyFile);
  if (!fs.existsSync(resolved)) return emptyHistory();
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as Partial<MainImageCopySelectionHistory>;
  if (parsed.schemaVersion !== MAIN_IMAGE_COPY_SELECTION_HISTORY_SCHEMA_VERSION) {
    throw new Error(`Main-image copy selection history schemaVersion must be ${MAIN_IMAGE_COPY_SELECTION_HISTORY_SCHEMA_VERSION}.`);
  }
  if (!parsed.records || typeof parsed.records !== "object" || Array.isArray(parsed.records)) {
    throw new Error("Main-image copy selection history records must be an object.");
  }
  if (!parsed.batches || typeof parsed.batches !== "object" || Array.isArray(parsed.batches)) {
    throw new Error("Main-image copy selection history batches must be an object.");
  }
  for (const [recordId, record] of Object.entries(parsed.records)) {
    if (!record || typeof record !== "object" || !record.candidateDigest || !record.lastSelectionText || !Number.isInteger(record.cycle) || record.cycle < 1) {
      throw new Error(`Main-image copy selection history record ${recordId} is invalid.`);
    }
    assertStringArray(record.usedSelectionDigests, `Main-image copy selection history record ${recordId} usedSelectionDigests`);
  }
  return parsed as MainImageCopySelectionHistory;
}

type SelectionRecord = Pick<FeishuProductRecord,
  "recordId" | "sellingPointText" | "mainImageHeadlineCandidateText" |
  "mainImageSubtitleCandidateText" | "mainImageSellingPointCandidateText">;

export function commitMainImageCopySelectionsForBatch(input: {
  historyFile?: string;
  batchFingerprint: string;
  records: SelectionRecord[];
  committedAt?: string;
}): boolean {
  if (!input.batchFingerprint) throw new Error("Main-image copy history commit requires a batch fingerprint.");
  const historyFile = path.resolve(input.historyFile || DEFAULT_MAIN_IMAGE_COPY_SELECTION_HISTORY_FILE);
  const history = loadMainImageCopySelectionHistory(historyFile);
  if (history.batches[input.batchFingerprint]) return false;
  const selections: Record<string, string> = {};
  for (const record of input.records) {
    if (!record.recordId || !record.sellingPointText) continue;
    const candidates = {
      headlineCandidateText: record.mainImageHeadlineCandidateText,
      subtitleCandidateText: record.mainImageSubtitleCandidateText,
      sellingPointCandidateText: record.mainImageSellingPointCandidateText
    };
    const candidateDigest = buildMainImageCopyCandidateDigest(candidates);
    const selectionDigest = digestSelectedMainImageCopy(record.sellingPointText);
    const previous = history.records[record.recordId];
    const matchingPrevious = previous?.candidateDigest === candidateDigest ? previous : undefined;
    const combinationCount = countMainImageCopyCombinations(candidates);
    const previousUsed = matchingPrevious?.usedSelectionDigests || [];
    const beginsNewCycle = previousUsed.length >= combinationCount;
    const usedSelectionDigests = beginsNewCycle
      ? [selectionDigest]
      : Array.from(new Set([...previousUsed, selectionDigest]));
    history.records[record.recordId] = {
      candidateDigest,
      usedSelectionDigests,
      lastSelectionText: record.sellingPointText,
      cycle: beginsNewCycle ? (matchingPrevious?.cycle || 1) + 1 : matchingPrevious?.cycle || 1
    };
    selections[record.recordId] = selectionDigest;
  }
  history.batches[input.batchFingerprint] = {
    committedAt: input.committedAt || new Date().toISOString(),
    selections
  };
  atomicWriteJson(historyFile, history);
  return true;
}
