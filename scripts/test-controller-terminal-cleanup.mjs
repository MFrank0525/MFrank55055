import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveControllerJobClosure } from "../dist/src/autolist/maintenance-rules.js";
import {
  resolveControllerJobBatchTransition,
  shouldSuppressBatchMismatchPauseDuringControllerTransition
} from "../dist/src/autolist/controller-job-ownership-rules.js";

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

assert.equal(
  shouldSuppressBatchMismatchPauseDuringControllerTransition({
    running: true,
    controllerPid: 42,
    controllerBatchFingerprint: "batch-new",
    runtimeBatchFingerprint: "batch-old",
    currentBatchFingerprint: "batch-new",
    nowMs: Date.parse("2026-10-21T00:00:10.000Z")
  }),
  true,
  "stale runtime evidence must not pause a live supervisor after ownership moved to the new canonical batch"
);

assert.equal(
  shouldSuppressBatchMismatchPauseDuringControllerTransition({
    running: true,
    controllerPid: 42,
    controllerBatchFingerprint: "batch-old",
    runtimeBatchFingerprint: "batch-old",
    currentBatchFingerprint: "batch-new",
    transition: {
      supervisorPid: 42,
      fromBatchFingerprint: "batch-old",
      toBatchFingerprint: "batch-new",
      startedAt: "2026-10-21T00:00:00.000Z"
    },
    nowMs: Date.parse("2026-10-21T00:00:10.000Z")
  }),
  true,
  "a fresh same-supervisor transition marker must close the cache-swap/ownership-update race window"
);

for (const transition of [
  undefined,
  {
    supervisorPid: 99,
    fromBatchFingerprint: "batch-old",
    toBatchFingerprint: "batch-new",
    startedAt: "2026-10-21T00:00:00.000Z"
  },
  {
    supervisorPid: 42,
    fromBatchFingerprint: "batch-old",
    toBatchFingerprint: "batch-other",
    startedAt: "2026-10-21T00:00:00.000Z"
  },
  {
    supervisorPid: 42,
    fromBatchFingerprint: "batch-old",
    toBatchFingerprint: "batch-new",
    startedAt: "2026-10-20T23:58:00.000Z"
  }
]) {
  assert.equal(
    shouldSuppressBatchMismatchPauseDuringControllerTransition({
      running: true,
      controllerPid: 42,
      controllerBatchFingerprint: "batch-old",
      runtimeBatchFingerprint: "batch-old",
      currentBatchFingerprint: "batch-new",
      transition,
      nowMs: Date.parse("2026-10-21T00:00:10.000Z")
    }),
    false,
    "missing, foreign, wrong-target, or stale transition evidence must remain fail-closed"
  );
}

const supervisorSource = fs.readFileSync(new URL("../src/cli/auto-listing-supervisor.ts", import.meta.url), "utf8");
assert.match(
  supervisorSource,
  /atomicWriteJson\(batchTransitionFile, transitionEvidence\);[\s\S]*fs\.copyFileSync\(refresh\.outFile, feishuProductDataFile\);[\s\S]*synchronizeControllerJobOwnership\(refreshedBatch\.fingerprint, "full"\);[\s\S]*finally \{[\s\S]*fs\.rmSync\(batchTransitionFile, \{ force: true \}\);/,
  "the supervisor must bracket canonical cache activation and ownership transfer with transition evidence"
);
const statusSource = fs.readFileSync(new URL("../src/cli/auto-listing-controller-status.ts", import.meta.url), "utf8");
assert.match(
  statusSource,
  /shouldSuppressBatchMismatchPauseDuringControllerTransition\([\s\S]*historicalRuntimeSuppressed: true[\s\S]*writePauseSignalFile\(/,
  "status must suppress stale runtime evidence only before the ordinary fail-closed pause path"
);

console.log("controller terminal cleanup rules passed");
