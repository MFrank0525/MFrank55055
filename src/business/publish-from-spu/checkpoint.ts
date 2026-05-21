import fs from "node:fs";
import path from "node:path";
import type { PublishFlowStage } from "./types.js";

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
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s.status === "completed").map((s) => ({ step: s.step, status: "completed" as const }));
  } catch {
    return [];
  }
}

export function saveCheckpoint(runtimeDir: string, stages: PublishFlowStage[]): void {
  const filePath = path.join(runtimeDir, CHECKPOINT_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const completed = stages.filter((s) => s.status === "completed");
  fs.writeFileSync(filePath, `${JSON.stringify(completed, null, 2)}\n`, "utf8");
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
