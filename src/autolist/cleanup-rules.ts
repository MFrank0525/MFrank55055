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
