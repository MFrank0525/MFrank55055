import fs from "node:fs";
import path from "node:path";
import type { PublishFlowStage } from "./types.js";
import { atomicWriteJson } from "../../utils/atomic-file.js";

const CHECKPOINT_FILE = "publish-checkpoint.json";

export function loadCheckpoint(runtimeDir: string): PublishFlowStage[] {
  const filePath = path.join(runtimeDir, CHECKPOINT_FILE);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PublishFlowStage[];
    if (!Array.isArray(parsed)) {
      throw new Error("checkpoint must be an array");
    }
    return parsed.filter((s) => s.status === "completed").map((s) => ({ step: s.step, status: "completed" as const }));
  } catch (error) {
    throw new Error(`Invalid publish checkpoint ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function saveCheckpoint(runtimeDir: string, stages: PublishFlowStage[]): void {
  const filePath = path.join(runtimeDir, CHECKPOINT_FILE);
  const completed = stages.filter((s) => s.status === "completed");
  atomicWriteJson(filePath, completed);
}

export function isStageCompleted(stages: PublishFlowStage[], step: string): boolean {
  return stages.some((s) => s.step === step && s.status === "completed");
}

export function clearCheckpoint(runtimeDir: string): void {
  const filePath = path.join(runtimeDir, CHECKPOINT_FILE);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}
