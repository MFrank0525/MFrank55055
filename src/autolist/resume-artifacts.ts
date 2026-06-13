import fs from "node:fs";
import path from "node:path";

export interface ReusableTaskArtifactSummary {
  reusableRawImageCount: number;
  reusablePaidImageTaskCount: number;
  reusableArtifactCount: number;
}

function walkFiles(rootDir: string, visit: (file: string) => void): void {
  if (!fs.existsSync(rootDir)) {
    return;
  }
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, visit);
      continue;
    }
    visit(fullPath);
  }
}

export function isReusableRawMainImageFile(file: string): boolean {
  return path.basename(path.dirname(file)) === "raw" && /^generated-\d+.*\.(png|jpe?g|webp)$/i.test(path.basename(file));
}

export function isReusablePaidImageLedgerSlotFile(file: string): boolean {
  if (path.basename(path.dirname(file)) !== "slots" || !/^\d+\.json$/i.test(path.basename(file))) {
    return false;
  }
  try {
    const slot = JSON.parse(fs.readFileSync(file, "utf8")) as { state?: string; providerTaskId?: string };
    return (
      (slot.state === "submitted" || slot.state === "completed") &&
      typeof slot.providerTaskId === "string" &&
      slot.providerTaskId.length > 0
    );
  } catch {
    return false;
  }
}

export function summarizeReusableTaskArtifacts(options: {
  runtimeDir: string;
  taskId?: string;
}): ReusableTaskArtifactSummary {
  const taskDir = options.taskId ? path.join(options.runtimeDir, "tasks", options.taskId) : "";
  let reusableRawImageCount = 0;
  let reusablePaidImageTaskCount = 0;
  walkFiles(taskDir, (file) => {
    if (isReusableRawMainImageFile(file)) {
      reusableRawImageCount += 1;
    }
    if (isReusablePaidImageLedgerSlotFile(file)) {
      reusablePaidImageTaskCount += 1;
    }
  });
  return {
    reusableRawImageCount,
    reusablePaidImageTaskCount,
    reusableArtifactCount: Math.max(reusableRawImageCount, reusablePaidImageTaskCount)
  };
}

export function runDirHasReusableMainImageArtifacts(runDir: string): boolean {
  let found = false;
  walkFiles(path.join(runDir, "tasks"), (file) => {
    if (found) {
      return;
    }
    found = isReusableRawMainImageFile(file) || isReusablePaidImageLedgerSlotFile(file);
  });
  return found;
}
