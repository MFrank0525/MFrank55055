import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildAutoListingBusinessRuleFingerprint } from "../autolist/business-rule-fingerprint.js";
import { buildFeishuBatchFingerprint } from "../autolist/feishu-batch-rules.js";
import { loadFeishuProductRecords } from "../autolist/feishu-products.js";
import { assertMainImageSceneAdherence } from "../autolist/main-image-scene-adherence-action.js";
import { DEFAULT_MAIN_IMAGE_FRAME_FILE } from "../autolist/main-image-frame-rules.js";
import { assertLocalVisionRuntimeMigrationEligible } from "../autolist/local-vision-runtime-migration-rules.js";
import {
  paidImageProductLedgerDir,
  summarizePaidImageProductLedger
} from "../autolist/paid-image-submission-ledger.js";
import { atomicWriteJson } from "../utils/atomic-file.js";

interface RuntimeTask {
  taskId?: string;
  status?: string;
  notes?: string[];
  error?: { step?: string; message?: string };
  scenePlanArtifact?: { prompts?: string[] };
  feishuProductRecord?: { recordId?: string };
}

interface RuntimeFile {
  feishuBatchFingerprint?: string;
  businessRuleFingerprint?: string;
  tasks?: RuntimeTask[];
  [key: string]: unknown;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function resolveRuntimeDir(argv: string[]): string {
  const index = argv.indexOf("--runtime-dir");
  const value = index >= 0 ? argv[index + 1] : "";
  if (!value) throw new Error("Usage: migrate-local-vision-runtime --runtime-dir <path>");
  return path.resolve(value);
}

function countPublishEntries(runtimeDir: string): number {
  const file = path.join(runtimeDir, "publish-manifest.json");
  if (!fs.existsSync(file)) return 0;
  const parsed = readJson<{ entries?: unknown[] }>(file);
  return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
}

function collectImages(taskDir: string, prompts: string[]): Array<{
  imageIndex: number;
  imageFile: string;
  scenePrompt: string;
  frameFile: string;
}> {
  if (prompts.length !== 5) throw new Error("Local vision runtime migration requires exactly five saved scene prompts.");
  const images = [];
  for (let round = 1; round <= 5; round += 1) {
    for (let slot = 1; slot <= 4; slot += 1) {
      const imageFile = path.join(
        taskDir,
        `main-image-${String(round).padStart(2, "0")}`,
        "openai-compatible",
        "raw",
        `generated-${String(slot).padStart(2, "0")}.png`
      );
      if (!fs.existsSync(imageFile)) throw new Error(`Local vision runtime migration image missing: ${imageFile}`);
      images.push({
        imageIndex: (round - 1) * 4 + slot,
        imageFile,
        scenePrompt: prompts[round - 1],
        frameFile: DEFAULT_MAIN_IMAGE_FRAME_FILE
      });
    }
  }
  return images;
}

async function main(): Promise<void> {
  const runtimeDir = resolveRuntimeDir(process.argv.slice(2));
  const stateFile = path.join(runtimeDir, "state.json");
  const resultFile = path.join(runtimeDir, "result.json");
  const state = readJson<RuntimeFile>(stateFile);
  const result = readJson<RuntimeFile>(resultFile);
  if (state.businessRuleFingerprint !== result.businessRuleFingerprint ||
      state.feishuBatchFingerprint !== result.feishuBatchFingerprint) {
    throw new Error("Local vision runtime migration requires matching state/result identities.");
  }
  const tasks = state.tasks || [];
  if (tasks.length !== 1) throw new Error("Local vision runtime migration requires exactly one runtime task.");
  const task = tasks[0];
  const resultTask = (result.tasks || [])[0];
  if (!task.taskId || resultTask?.taskId !== task.taskId) {
    throw new Error("Local vision runtime migration state/result task identity mismatch.");
  }
  const recordId = task.feishuProductRecord?.recordId || "";
  const currentBatchFingerprint = buildFeishuBatchFingerprint(
    loadFeishuProductRecords(path.resolve("data/feishu/products.json"))
  );
  const currentBusinessRuleFingerprint = buildAutoListingBusinessRuleFingerprint();
  const ledgerDir = paidImageProductLedgerDir(
    path.resolve("data/auto-listing/paid-image-submissions"),
    currentBatchFingerprint,
    recordId
  );
  const paid = summarizePaidImageProductLedger(ledgerDir);
  const taskDir = path.join(runtimeDir, "tasks", task.taskId);
  const images = collectImages(taskDir, task.scenePlanArtifact?.prompts || []);
  const paidUnsafeCount = paid.missing + paid.reserved + paid.submitted + paid.failedBeforeAcceptance +
    paid.failedAfterAcceptance + paid.ambiguous;
  assertLocalVisionRuntimeMigrationEligible({
    currentBatchFingerprint,
    runtimeBatchFingerprint: state.feishuBatchFingerprint || "",
    currentBusinessRuleFingerprint,
    runtimeBusinessRuleFingerprint: state.businessRuleFingerprint || "",
    taskStatus: task.status || "",
    failedStep: task.error?.step || "",
    failureMessage: task.error?.message || "",
    generatedImageCount: images.length,
    paidCompletedCount: paid.completed,
    paidUnsafeCount,
    publishManifestEntryCount: countPublishEntries(runtimeDir)
  });
  const reportFile = path.join(taskDir, "main-image-scene-adherence-report.json");
  const report = await assertMainImageSceneAdherence({
    images,
    reportFile,
    concurrency: 2,
    onProgress: (message) => console.log(message)
  });
  const migratedAt = new Date().toISOString();
  const previousBusinessRuleFingerprint = state.businessRuleFingerprint || "";
  const migrationNote = `Local vision runtime migrated after v6 revalidation: ${report.items.length}/20 passed; model=${report.model}.`;
  const migrateFile = (value: RuntimeFile): RuntimeFile => ({
    ...value,
    businessRuleFingerprint: currentBusinessRuleFingerprint,
    tasks: (value.tasks || []).map((entry) => entry.taskId === task.taskId
      ? { ...entry, notes: [...(entry.notes || []), migrationNote] }
      : entry)
  });
  const evidenceFile = path.join(runtimeDir, "local-vision-runtime-migration.json");
  atomicWriteJson(evidenceFile, {
    migratedAt,
    runtimeDir,
    batchFingerprint: currentBatchFingerprint,
    taskId: task.taskId,
    recordId,
    previousBusinessRuleFingerprint,
    currentBusinessRuleFingerprint,
    previousStateSha256: sha256File(stateFile),
    previousResultSha256: sha256File(resultFile),
    reportFile,
    reportSha256: sha256File(reportFile),
    reportModel: report.model,
    reportGateVersion: report.gateVersion,
    passedImageCount: report.items.length,
    paidLedger: paid,
    publishManifestEntryCount: 0
  });
  atomicWriteJson(stateFile, migrateFile(state));
  atomicWriteJson(resultFile, migrateFile(result));
  console.log(JSON.stringify({
    ok: true,
    runtimeDir,
    taskId: task.taskId,
    migratedFrom: previousBusinessRuleFingerprint,
    migratedTo: currentBusinessRuleFingerprint,
    passedImageCount: report.items.length,
    evidenceFile
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
