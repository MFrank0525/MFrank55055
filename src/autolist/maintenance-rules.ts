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

function residueReason(filePath: string): string | undefined {
  const normalized = filePath.replaceAll("\\", "/");
  const base = path.basename(normalized);
  if (normalized.endsWith("/docs/superpowers") || normalized.includes("/docs/superpowers/")) {
    return "historical engineering process documents";
  }
  if (/\/data\/auto-listing\/control\/auto-listing-controller-[^/]+\.log$/i.test(normalized)) {
    return "historical controller log";
  }
  if (normalized.endsWith("/data/auto-listing/control/auto-listing-controller-job.json")) {
    return "terminal controller state";
  }
  if (normalized.endsWith("/data/auto-listing/control/hermes-watchdog-state.json")) {
    return "stale watchdog state";
  }
  if (normalized.endsWith("/data/auto-listing/control/feishu-products.refresh-candidate.json")) {
    return "transient Feishu refresh candidate";
  }
  if (/\/data\/auto-listing\/runs\/[^/]+$/i.test(normalized)) {
    return "previous batch runtime";
  }
  if (normalized.endsWith("/data/auto-listing/deferred-main-images")) {
    return "obsolete deferred main-image workspace";
  }
  if (normalized.endsWith("/data/auto-listing/shop-access-audits")) {
    return "completed shop-access audit output";
  }
  if (normalized.endsWith("/data/auto-listing/paid-image-submissions")) {
    return "previous paid image-generation batch ledger";
  }
  if (normalized.endsWith("/data/auto-listing/processed-images.json")) {
    return "previous batch processed-image marker";
  }
  if (normalized.endsWith("/data/auto-listing/after-duzhong-processed-images.json")) {
    return "obsolete processed-image snapshot";
  }
  if (normalized.endsWith("/data/feishu/products.json")) {
    return "previous Feishu batch cache";
  }
  if (normalized.endsWith("/input/auto-listing/feishu-images")) {
    return "previous Feishu batch source assets";
  }
  if (normalized.endsWith("/input/auto-listing/qualifications")) {
    return "previous Feishu batch qualification assets";
  }
  if (normalized.endsWith("/input/legacy")) {
    return "legacy input directory";
  }
  if (base === ".DS_Store") {
    return "filesystem metadata";
  }
  return undefined;
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
      continue;
    }

    const reason = residueReason(normalized);
    if (reason) {
      targets.push({ filePath, reason });
    }
  }

  return targets;
}
