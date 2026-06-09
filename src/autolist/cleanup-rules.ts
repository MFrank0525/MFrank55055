import path from "node:path";

function normalizePath(value: string): string {
  return path.resolve(value);
}

export function selectCleanupTargets(options: {
  candidates: string[];
  protectedPaths?: string[];
}): string[] {
  const protectedSet = new Set((options.protectedPaths || []).filter(Boolean).map(normalizePath));
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const candidate of options.candidates.filter(Boolean)) {
    const normalized = normalizePath(candidate);
    if (protectedSet.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    selected.push(candidate);
  }

  return selected;
}

function isAutoListingRunDirName(value: string): boolean {
  return /^[0-9]{8}-[0-9]{6}$/.test(value);
}

export function selectStaleRunHistoryTargets(options: {
  runDirs: string[];
  activeRunDir?: string;
  protectedRunDirs?: string[];
}): string[] {
  const activeRunDir = options.activeRunDir ? normalizePath(options.activeRunDir) : "";
  const protectedSet = new Set((options.protectedRunDirs || []).filter(Boolean).map(normalizePath));
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const runDir of options.runDirs.filter(Boolean)) {
    const normalized = normalizePath(runDir);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (normalized === activeRunDir || protectedSet.has(normalized)) {
      continue;
    }
    if (!isAutoListingRunDirName(path.basename(normalized))) {
      continue;
    }
    selected.push(runDir);
  }

  return selected;
}
