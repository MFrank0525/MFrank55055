import fs from "node:fs";
import path from "node:path";
import { paidImageBatchLedgerDir } from "./paid-image-submission-ledger.js";

const ACTIVE_PAID_IMAGE_STATES = new Set(["reserved", "submitted", "ambiguous"]);

type ArchivedMove = {
  source: string;
  destination: string;
};

export interface FreshRerunArchiveResult {
  archiveDir: string;
  archivedPaths: string[];
  paidImageStates: Record<string, number>;
}

function timestampForArchive(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function readJsonObject(file: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function paidImageStateCounts(batchDir: string): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!fs.existsSync(batchDir)) {
    return counts;
  }
  for (const productEntry of fs.readdirSync(batchDir, { withFileTypes: true })) {
    if (!productEntry.isDirectory()) {
      continue;
    }
    const slotsDir = path.join(batchDir, productEntry.name, "slots");
    if (!fs.existsSync(slotsDir)) {
      continue;
    }
    for (const slotEntry of fs.readdirSync(slotsDir, { withFileTypes: true })) {
      if (!slotEntry.isFile() || !slotEntry.name.endsWith(".json")) {
        continue;
      }
      const record = readJsonObject(path.join(slotsDir, slotEntry.name));
      const state = typeof record?.state === "string" ? record.state : "invalid";
      counts[state] = (counts[state] || 0) + 1;
    }
  }
  return counts;
}

function runtimeMatchesBatch(runtimeDir: string, batchFingerprint: string): boolean {
  for (const name of ["state.json", "result.json", "preflight.json"]) {
    const payload = readJsonObject(path.join(runtimeDir, name));
    if (payload?.feishuBatchFingerprint === batchFingerprint) {
      return true;
    }
  }
  return false;
}

function moveWithRollback(moves: ArchivedMove[]): void {
  const completed: ArchivedMove[] = [];
  try {
    for (const move of moves) {
      fs.mkdirSync(path.dirname(move.destination), { recursive: true });
      fs.renameSync(move.source, move.destination);
      completed.push(move);
    }
  } catch (error) {
    for (const move of completed.reverse()) {
      if (fs.existsSync(move.destination) && !fs.existsSync(move.source)) {
        fs.renameSync(move.destination, move.source);
      }
    }
    throw error;
  }
}

export function archiveFreshRerunEvidence(input: {
  batchFingerprint: string;
  paidImageLedgerRoot: string;
  runtimeRoot: string;
  processedImageManifest: string;
  archiveRoot: string;
  now?: Date;
}): FreshRerunArchiveResult {
  if (!input.batchFingerprint.trim()) {
    throw new Error("Cannot archive fresh-rerun evidence without a Feishu batch fingerprint.");
  }

  const batchDir = paidImageBatchLedgerDir(input.paidImageLedgerRoot, input.batchFingerprint);
  const paidImageStates = paidImageStateCounts(batchDir);
  const activeStates = Object.keys(paidImageStates).filter((state) => ACTIVE_PAID_IMAGE_STATES.has(state));
  if (activeStates.length > 0) {
    throw new Error(
      `Cannot fresh-rerun while paid image slots remain active or uncertain: ${activeStates.map((state) => `${state}=${paidImageStates[state]}`).join(", ")}.`
    );
  }
  if (paidImageStates.invalid) {
    throw new Error(`Cannot fresh-rerun with ${paidImageStates.invalid} invalid paid image ledger slot record(s).`);
  }

  const now = input.now || new Date();
  const archiveDir = path.join(
    path.resolve(input.archiveRoot),
    `fresh-rerun-${timestampForArchive(now)}-${input.batchFingerprint.slice(0, 12)}`
  );
  if (fs.existsSync(archiveDir)) {
    throw new Error(`Fresh-rerun archive already exists: ${archiveDir}`);
  }

  const moves: ArchivedMove[] = [];
  if (fs.existsSync(batchDir)) {
    moves.push({ source: batchDir, destination: path.join(archiveDir, "paid-image-ledger") });
  }
  const runtimeRoot = path.resolve(input.runtimeRoot);
  if (fs.existsSync(runtimeRoot)) {
    for (const entry of fs.readdirSync(runtimeRoot, { withFileTypes: true })) {
      const runtimeDir = path.join(runtimeRoot, entry.name);
      if (entry.isDirectory() && runtimeMatchesBatch(runtimeDir, input.batchFingerprint)) {
        moves.push({ source: runtimeDir, destination: path.join(archiveDir, "runs", entry.name) });
      }
    }
  }

  fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: false });
  try {
    const processedManifest = path.resolve(input.processedImageManifest);
    if (fs.existsSync(processedManifest)) {
      fs.copyFileSync(processedManifest, path.join(archiveDir, "processed-images.before-rerun.json"));
    }
    moveWithRollback(moves);
    const manifest = {
      version: 1,
      archivedAt: now.toISOString(),
      reason: "explicit_fresh_rerun_current_feishu_batch",
      batchFingerprint: input.batchFingerprint,
      paidImageStates,
      moved: moves.map((move) => ({ source: move.source, archivedAs: path.relative(archiveDir, move.destination) }))
    };
    fs.writeFileSync(path.join(archiveDir, "archive-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  } catch (error) {
    for (const move of moves.slice().reverse()) {
      if (fs.existsSync(move.destination) && !fs.existsSync(move.source)) {
        fs.mkdirSync(path.dirname(move.source), { recursive: true });
        fs.renameSync(move.destination, move.source);
      }
    }
    fs.rmSync(archiveDir, { recursive: true, force: true });
    throw error;
  }

  return {
    archiveDir,
    archivedPaths: moves.map((move) => move.source),
    paidImageStates
  };
}
