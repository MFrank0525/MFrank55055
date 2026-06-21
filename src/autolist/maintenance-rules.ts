import path from "node:path";

export interface MaintenanceResidueRuleInput {
  filePaths: string[];
  activeGeneratedJobFile?: string;
}

export interface MaintenanceResidueTarget {
  filePath: string;
  reason: string;
}

const ONE_OFF_SCRIPT_NAME_PATTERN = /(?:^|[-_.])(inspect|debug|tmp|temp|temporary|patch|fix|relist)(?:[-_.]|$)/i;

export type ControllerJobStatus = "running" | "completed" | "failed";

export function resolveControllerJobClosure(input: {
  declaredStatus: ControllerJobStatus;
  processAlive: boolean;
  terminalResult?: "completed" | "failed";
}): { action: "keep_running" | "write_terminal" | "clear_stale"; status: ControllerJobStatus } {
  if (input.declaredStatus !== "running") {
    return { action: "write_terminal", status: input.declaredStatus };
  }
  if (input.processAlive) {
    return { action: "keep_running", status: "running" };
  }
  if (input.terminalResult) {
    return { action: "write_terminal", status: input.terminalResult };
  }
  return { action: "clear_stale", status: "failed" };
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function isGeneratedAutoListingJob(filePath: string): boolean {
  return /[/\\]input[/\\]auto-listing[/\\][^/\\]+\.generated\.json$/i.test(filePath);
}

function isResumeGeneratedJob(filePath: string): boolean {
  return /\.resume\.generated\.json$/i.test(path.basename(filePath));
}

function isOneOffScript(filePath: string): boolean {
  if (!/[/\\]scripts[/\\][^/\\]+\.mjs$/i.test(filePath)) {
    return false;
  }
  return ONE_OFF_SCRIPT_NAME_PATTERN.test(path.basename(filePath));
}

export function selectMaintenanceResidueTargets(input: MaintenanceResidueRuleInput): MaintenanceResidueTarget[] {
  const activeGeneratedJobFile = input.activeGeneratedJobFile ? normalizePath(input.activeGeneratedJobFile) : "";
  const targets: MaintenanceResidueTarget[] = [];
  const seen = new Set<string>();

  for (const filePath of input.filePaths.filter(Boolean)) {
    const normalized = normalizePath(filePath);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    if (
      isGeneratedAutoListingJob(normalized) &&
      normalized !== activeGeneratedJobFile &&
      (!isResumeGeneratedJob(normalized) || Boolean(activeGeneratedJobFile))
    ) {
      targets.push({
        filePath,
        reason: "obsolete generated auto-listing job"
      });
      continue;
    }

    if (isOneOffScript(normalized)) {
      targets.push({
        filePath,
        reason: "one-off diagnostic or temporary maintenance script"
      });
    }
  }

  return targets;
}
