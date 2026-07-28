import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  isAutoListingControllerChildProcessCommand,
  isAutoListingControllerRunningProcessConfirmed,
  isAutoListingControllerSupervisorProcessCommand
} from "../autolist/batch-continuation-rules.js";
import { shouldTreatControllerSupervisorAsInert } from "../autolist/maintenance-rules.js";

export interface ControllerRunnerJob {
  pid: number;
  startedAt: string;
  logFile: string;
  status: "running" | "completed" | "failed";
}

type ControllerWaitState = {
  supervisorPid?: number;
  status?: "external_service_wait" | "doudian_login_wait";
};

function readJsonFile<T>(file: string | undefined): T | undefined {
  if (!file || !fs.existsSync(file)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function fileMtimeMs(file: string | undefined): number | undefined {
  return file && fs.existsSync(file) ? fs.statSync(file).mtimeMs : undefined;
}

function readProcessCommand(pid: number | undefined): string | undefined {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function isPidRunning(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isProcessGroupRunning(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function isControllerRunnerJobRunning(input: {
  job: ControllerRunnerJob;
  childControlFile: string;
  waitStateFile: string;
  latestResultFile?: string;
}): boolean {
  if (input.job.status !== "running") {
    return false;
  }
  const command = readProcessCommand(input.job.pid);
  const processConfirmed = isAutoListingControllerRunningProcessConfirmed({
    pidAlive: isPidRunning(input.job.pid),
    processGroupAlive: isProcessGroupRunning(input.job.pid),
    command
  });
  if (!processConfirmed) {
    return false;
  }
  const child = readJsonFile<{ pid?: number }>(input.childControlFile);
  const childCommand = child?.pid && isPidRunning(child.pid) ? readProcessCommand(child.pid) : undefined;
  const childProcessRecorded = Boolean(childCommand && isAutoListingControllerChildProcessCommand(childCommand));
  const waitState = readJsonFile<ControllerWaitState>(input.waitStateFile);
  const waitStateRecorded = Boolean(
    waitState?.supervisorPid === input.job.pid &&
    (waitState.status === "external_service_wait" || waitState.status === "doudian_login_wait")
  );
  const latestResult = readJsonFile<{ ok?: boolean; status?: string }>(input.latestResultFile);
  const terminalResultMtimeMs = fileMtimeMs(input.latestResultFile);
  const jobStartedAtMs = Date.parse(input.job.startedAt);
  const terminalResultFound = Boolean(
    terminalResultMtimeMs &&
    Number.isFinite(jobStartedAtMs) &&
    terminalResultMtimeMs >= jobStartedAtMs &&
    latestResult &&
    (latestResult.ok === true || latestResult.ok === false || latestResult.status === "success" || latestResult.status === "failed")
  );
  const gracePeriodMs = 2 * 60 * 1000;
  return !shouldTreatControllerSupervisorAsInert({
    processConfirmed,
    childProcessRecorded,
    waitStateRecorded,
    terminalResultFound,
    terminalResultAgeMs: terminalResultMtimeMs ? Date.now() - terminalResultMtimeMs : 0,
    controllerLogAdvancedAfterTerminalResult: Boolean(
      terminalResultMtimeMs && (fileMtimeMs(input.job.logFile) || 0) > terminalResultMtimeMs + gracePeriodMs
    ),
    gracePeriodMs
  });
}

export async function cleanupInertControllerSupervisor(input: {
  job?: ControllerRunnerJob;
  childControlFile: string;
  waitStateFile: string;
  latestResultFile?: string;
}): Promise<void> {
  const job = input.job;
  if (!job || !isPidRunning(job.pid) || isControllerRunnerJobRunning({ ...input, job })) {
    return;
  }
  const command = readProcessCommand(job.pid);
  if (!command || !isAutoListingControllerSupervisorProcessCommand(command)) {
    return;
  }
  try {
    process.kill(-job.pid, "SIGTERM");
  } catch {
    try {
      process.kill(job.pid, "SIGTERM");
    } catch {
      return;
    }
  }
  const deadline = Date.now() + 5000;
  while (isProcessGroupRunning(job.pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (isProcessGroupRunning(job.pid)) {
    try {
      process.kill(-job.pid, "SIGKILL");
    } catch {
      try {
        process.kill(job.pid, "SIGKILL");
      } catch {
        // The inert supervisor exited between checks.
      }
    }
  }
}
