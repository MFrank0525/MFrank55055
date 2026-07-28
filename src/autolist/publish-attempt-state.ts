import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "../utils/atomic-file.js";

export type PublishAttemptState = "not_attempted" | "attempted_or_unknown";

const STATE_FILE = "publish-submit-attempt.json";

export function publishAttemptStateFile(runtimeDir: string): string {
  return path.join(runtimeDir, STATE_FILE);
}

export function initializePublishAttemptState(runtimeDir: string): string {
  const file = publishAttemptStateFile(runtimeDir);
  if (!fs.existsSync(file)) {
    atomicWriteJson(file, {
      state: "not_attempted",
      initializedAt: new Date().toISOString()
    });
  }
  return file;
}

export function markPublishAttemptStarted(runtimeDir: string): string {
  const file = publishAttemptStateFile(runtimeDir);
  atomicWriteJson(file, {
    state: "attempted_or_unknown",
    attemptedAt: new Date().toISOString()
  });
  return file;
}

export function readPublishAttemptState(runtimeDir: string): PublishAttemptState {
  const file = publishAttemptStateFile(runtimeDir);
  if (!fs.existsSync(file)) {
    return "attempted_or_unknown";
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { state?: string };
    return parsed.state === "not_attempted" ? "not_attempted" : "attempted_or_unknown";
  } catch {
    return "attempted_or_unknown";
  }
}
