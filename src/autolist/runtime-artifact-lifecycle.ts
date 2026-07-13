import fs from "node:fs";
import path from "node:path";

interface RuntimeArtifactIdentity {
  feishuBatchFingerprint?: string;
  batchFingerprint?: string;
  businessRuleFingerprint?: string;
}

function readJson(filePath: string): RuntimeArtifactIdentity | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as RuntimeArtifactIdentity;
  } catch {
    return undefined;
  }
}

function readRuntimeArtifactIdentity(runtimeDir: string): {
  batchFingerprint?: string;
  businessRuleFingerprint?: string;
} {
  for (const fileName of ["result.json", "state.json"]) {
    const parsed = readJson(path.join(runtimeDir, fileName));
    const batchFingerprint = parsed?.feishuBatchFingerprint || parsed?.batchFingerprint;
    if (batchFingerprint) {
      return { batchFingerprint, businessRuleFingerprint: parsed?.businessRuleFingerprint };
    }
  }
  return {};
}

export function removeInvalidRuntimeArtifactDirs(input: {
  runsDir: string;
  currentBatchFingerprint: string;
  currentBusinessRuleFingerprint: string;
}): string[] {
  if (!fs.existsSync(input.runsDir)) return [];
  const removed: string[] = [];
  for (const entry of fs.readdirSync(input.runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runtimeDir = path.join(input.runsDir, entry.name);
    const identity = readRuntimeArtifactIdentity(runtimeDir);
    if (
      identity.batchFingerprint !== input.currentBatchFingerprint ||
      identity.businessRuleFingerprint !== input.currentBusinessRuleFingerprint
    ) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
      removed.push(runtimeDir);
    }
  }
  return removed;
}
