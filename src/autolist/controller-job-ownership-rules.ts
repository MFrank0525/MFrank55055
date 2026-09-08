export type ControllerJobBatchTransitionInput = {
  job?: {
    pid: number;
    status: string;
    mode: "full-real-flow" | "resume-real-job";
    batchFingerprint?: string;
    expectedResultFile?: string;
    args: string[];
  };
  supervisorPid: number;
  nextBatchFingerprint: string;
  nextMode?: "full-real-flow" | "resume-real-job";
  nextExpectedResultFile?: string;
};

export type ControllerJobBatchTransitionResult =
  | { action: "skip"; reason: "controller_job_missing" | "controller_not_running" }
  | { action: "refuse"; reason: "controller_pid_mismatch" }
  | { action: "update"; job: NonNullable<ControllerJobBatchTransitionInput["job"]> };

function replaceOptionValue(args: string[], option: string, value: string): string[] {
  const next = [...args];
  const index = next.indexOf(option);
  if (index >= 0) {
    if (index + 1 < next.length) {
      next[index + 1] = value;
    } else {
      next.push(value);
    }
    return next;
  }
  return [...next, option, value];
}

export function resolveControllerJobBatchTransition(
  input: ControllerJobBatchTransitionInput
): ControllerJobBatchTransitionResult {
  if (!input.job) {
    return { action: "skip", reason: "controller_job_missing" };
  }
  if (input.job.status !== "running") {
    return { action: "skip", reason: "controller_not_running" };
  }
  if (input.job.pid !== input.supervisorPid) {
    return { action: "refuse", reason: "controller_pid_mismatch" };
  }
  const mode = input.nextMode || "full-real-flow";
  const initialMode = mode === "resume-real-job" ? "resume" : "full";
  const argsWithBatch = replaceOptionValue(input.job.args, "--batch-fingerprint", input.nextBatchFingerprint);
  return {
    action: "update",
    job: {
      ...input.job,
      args: replaceOptionValue(argsWithBatch, "--initial", initialMode),
      batchFingerprint: input.nextBatchFingerprint,
      expectedResultFile: input.nextExpectedResultFile,
      mode
    }
  };
}
