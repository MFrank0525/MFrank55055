import assert from "node:assert/strict";
import { resolveControllerJobClosure } from "../dist/src/autolist/maintenance-rules.js";
import { resolveControllerJobBatchTransition } from "../dist/src/autolist/controller-job-ownership-rules.js";

assert.deepEqual(
  resolveControllerJobClosure({ declaredStatus: "running", processAlive: false, terminalResult: "completed" }),
  { action: "write_terminal", status: "completed" }
);
assert.deepEqual(
  resolveControllerJobClosure({ declaredStatus: "running", processAlive: false, terminalResult: "failed" }),
  { action: "write_terminal", status: "failed" }
);
assert.deepEqual(
  resolveControllerJobClosure({ declaredStatus: "running", processAlive: false }),
  { action: "clear_stale", status: "failed" }
);
assert.deepEqual(
  resolveControllerJobClosure({ declaredStatus: "running", processAlive: true }),
  { action: "keep_running", status: "running" }
);

const transitioned = resolveControllerJobBatchTransition({
  job: {
    pid: 42,
    status: "running",
    mode: "resume-real-job",
    batchFingerprint: "batch-old",
    args: ["dist/src/cli/auto-listing-supervisor.js", "--initial", "resume", "--batch-fingerprint", "batch-old"]
  },
  supervisorPid: 42,
  nextBatchFingerprint: "batch-new"
});
assert.equal(transitioned.action, "update");
assert.equal(transitioned.job?.batchFingerprint, "batch-new");
assert.equal(transitioned.job?.mode, "full-real-flow");
assert.equal(transitioned.job?.expectedResultFile, undefined);
assert.deepEqual(transitioned.job?.args.slice(-2), ["--batch-fingerprint", "batch-new"]);

const resumed = resolveControllerJobBatchTransition({
  job: {
    pid: 42,
    status: "running",
    mode: "full-real-flow",
    batchFingerprint: "batch-new",
    args: ["dist/src/cli/auto-listing-supervisor.js"]
  },
  supervisorPid: 42,
  nextBatchFingerprint: "batch-new",
  nextMode: "resume-real-job",
  nextExpectedResultFile: "/runtime/resume-result.json"
});
assert.equal(resumed.action, "update");
assert.equal(resumed.job?.mode, "resume-real-job");
assert.equal(resumed.job?.expectedResultFile, "/runtime/resume-result.json");
assert.deepEqual(resumed.job?.args, [
  "dist/src/cli/auto-listing-supervisor.js",
  "--batch-fingerprint",
  "batch-new",
  "--initial",
  "resume"
]);

assert.deepEqual(
  resolveControllerJobBatchTransition({
    job: {
      pid: 99,
      status: "running",
      mode: "resume-real-job",
      batchFingerprint: "batch-old",
      args: []
    },
    supervisorPid: 42,
    nextBatchFingerprint: "batch-new"
  }),
  { action: "refuse", reason: "controller_pid_mismatch" }
);

console.log("controller terminal cleanup rules passed");
