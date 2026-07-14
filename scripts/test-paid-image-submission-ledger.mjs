import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  currentPaidImageLedgerProcessIdentity,
  expireSubmittedPaidImageQueue,
  initializePaidImageProductLedger,
  inspectPaidImageProductLedgerForAudit,
  removePaidImageBatchLedger,
  removePaidImageProductLedger,
  paidImageProductLedgerDir,
  recordPaidImageAmbiguous,
  recordPaidImageCompleted,
  recordPaidImageFailedAfterAcceptance,
  recordPaidImageFailedBeforeAcceptance,
  reconcileAmbiguousPaidImageProviderFailure,
  reconcileAmbiguousPaidImageNoAcceptance,
  reconcileAmbiguousPaidImageTask,
  recordPaidImageSubmitted,
  reservePaidImageSlot,
  resolvePaidImageSlotAction,
  sha256File,
  sha256Text,
  summarizePaidImageProductLedger
} from "../dist/src/autolist/paid-image-submission-ledger.js";

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-image-ledger-"));
const identity = {
  rootDir,
  batchFingerprint: "batch/a",
  recordId: "record:a",
  expectedSlotCount: 20,
  providerIdentity: "https://provider.example/v1/videos|model-a",
  sourceImageDigest: "source-a"
};
const ownerA = { runId: "run-a", taskId: "task-a", pid: 101 };
const ownerB = { runId: "run-b", taskId: "task-b", pid: 202 };
const currentProcessIdentity = currentPaidImageLedgerProcessIdentity();
assert.ok(currentProcessIdentity.identity);
assert.match(currentProcessIdentity.source, /^(ps-lstart-command-sha256|local-process-start-sha256)$/);

const initialized = initializePaidImageProductLedger(identity);
assert.equal(initialized.expectedSlotCount, 20);
assert.equal(initialized.batchFingerprint, "batch/a");
assert.equal(initialized.recordId, "record:a");
assert.equal(initialized.productDir, paidImageProductLedgerDir(rootDir, "batch/a", "record:a"));
assert.equal(initialized.productDir.includes("batch/a"), false, "path segments must be sanitized");
assert.equal(initialized.productDir.includes("record:a"), false, "path segments must be sanitized");

const sameIdentity = initializePaidImageProductLedger(identity);
assert.equal(sameIdentity.productDir, initialized.productDir, "stable batch and record identity must reuse a ledger");
assert.throws(
  () => initializePaidImageProductLedger({ ...identity, sourceImageDigest: "source-conflict" }),
  /ledger identity conflict/i
);
const emptyProviderMigrated = initializePaidImageProductLedger({ ...identity, providerIdentity: "provider-conflict" });
assert.equal(emptyProviderMigrated.providerIdentity, "provider-conflict");
const providerMigrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paid-image-provider-migration-"));
const failedBeforeProviderA = initializePaidImageProductLedger({
  ...identity,
  rootDir: providerMigrationRoot,
  batchFingerprint: "batch-provider-migration",
  recordId: "record-provider-migration",
  providerIdentity: "provider-a"
});
reservePaidImageSlot({
  productDir: failedBeforeProviderA.productDir,
  slot: 1,
  requestDigest: "provider-migration-request",
  promptDigest: "provider-migration-prompt",
  owner: ownerA
});
recordPaidImageFailedBeforeAcceptance({
  productDir: failedBeforeProviderA.productDir,
  slot: 1,
  reason: "fetch failed"
});
const failedBeforeProviderB = initializePaidImageProductLedger({
  ...identity,
  rootDir: providerMigrationRoot,
  batchFingerprint: "batch-provider-migration",
  recordId: "record-provider-migration",
  providerIdentity: "provider-b"
});
assert.equal(
  failedBeforeProviderB.providerIdentity,
  "provider-b",
  "provider changes after no-acceptance failures must not block safe retry"
);
const submittedProviderLocked = initializePaidImageProductLedger({
  ...identity,
  rootDir: providerMigrationRoot,
  batchFingerprint: "batch-provider-locked",
  recordId: "record-provider-locked",
  providerIdentity: "provider-a"
});
reservePaidImageSlot({
  productDir: submittedProviderLocked.productDir,
  slot: 1,
  requestDigest: "provider-locked-request",
  promptDigest: "provider-locked-prompt",
  owner: ownerA
});
recordPaidImageSubmitted({
  productDir: submittedProviderLocked.productDir,
  slot: 1,
  providerTaskId: "task_provider_locked"
});
assert.throws(
  () =>
    initializePaidImageProductLedger({
      ...identity,
      rootDir: providerMigrationRoot,
      batchFingerprint: "batch-provider-locked",
      recordId: "record-provider-locked",
      providerIdentity: "provider-b"
    }),
  /ledger identity conflict/i,
  "provider changes must remain blocked once a paid task id exists"
);
assert.throws(
  () => initializePaidImageProductLedger({ ...identity, expectedSlotCount: 19 }),
  /ledger identity conflict/i
);
assert.notEqual(
  paidImageProductLedgerDir(rootDir, "batch/a", "record:a"),
  paidImageProductLedgerDir(rootDir, "batch-b", "record:a"),
  "later batches must use isolated ledgers"
);
assert.throws(
  () => initializePaidImageProductLedger({ ...identity, batchFingerprint: "", recordId: "record" }),
  /non-empty/i
);
assert.throws(
  () => initializePaidImageProductLedger({ ...identity, batchFingerprint: "batch-too-large", expectedSlotCount: 21 }),
  /between 1 and 20/i
);

const raceProduct = initializePaidImageProductLedger({ ...identity, batchFingerprint: "batch-race", recordId: "record-race" });
const ledgerModuleUrl = pathToFileURL(path.resolve("dist/src/autolist/paid-image-submission-ledger.js")).href;
const productRaceRoot = path.join(rootDir, "product-race-root");
function raceProductInitialization(sourceImageDigest) {
  const worker = `
    import { initializePaidImageProductLedger } from ${JSON.stringify(ledgerModuleUrl)};
    try {
      initializePaidImageProductLedger({
        rootDir: ${JSON.stringify(productRaceRoot)},
        batchFingerprint: "same-batch",
        recordId: "same-record",
        expectedSlotCount: 20,
        providerIdentity: "same-provider",
        sourceImageDigest: ${JSON.stringify(sourceImageDigest)}
      });
      process.stdout.write("success");
    } catch (error) {
      process.stdout.write("rejected:" + error.message);
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", worker], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr))));
  });
}
const productRaceResults = await Promise.all([
  raceProductInitialization("source-race-a"),
  raceProductInitialization("source-race-b")
]);
assert.equal(productRaceResults.filter((item) => item === "success").length, 1);
assert.equal(productRaceResults.filter((item) => /rejected:.*identity conflict/i.test(item)).length, 1);

function raceReserve(owner) {
  const worker = `
    import { reservePaidImageSlot } from ${JSON.stringify(ledgerModuleUrl)};
    const action = reservePaidImageSlot({
      productDir: ${JSON.stringify(raceProduct.productDir)},
      slot: 1,
      requestDigest: "race-request",
      promptDigest: "race-prompt",
      owner: ${JSON.stringify(owner)}
    });
    process.stdout.write(action.action);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", worker], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr))));
  });
}
const raceActions = await Promise.all([raceReserve(ownerA), raceReserve(ownerB)]);
assert.deepEqual(raceActions.sort(), ["blocked_reserved", "submit"], "cross-process reservation race must have one winner");

const resolutionRaceProduct = initializePaidImageProductLedger({
  ...identity,
  batchFingerprint: "batch-resolution-race",
  recordId: "record-resolution-race"
});
const resolutionRaceWorker = `
  import { reservePaidImageSlot } from ${JSON.stringify(ledgerModuleUrl)};
  reservePaidImageSlot({
    productDir: ${JSON.stringify(resolutionRaceProduct.productDir)},
    slot: 1,
    requestDigest: "resolution-race-request",
    promptDigest: "resolution-race-prompt",
    owner: ${JSON.stringify(ownerA)}
  });
`;
const resolutionRaceChild = spawn(process.execPath, ["--input-type=module", "-e", resolutionRaceWorker], {
  stdio: ["ignore", "ignore", "pipe"]
});
let resolutionRaceStderr = "";
resolutionRaceChild.stderr.on("data", (chunk) => (resolutionRaceStderr += chunk));
for (let attempt = 0; attempt < 200; attempt += 1) {
  const action = resolvePaidImageSlotAction({ productDir: resolutionRaceProduct.productDir, slot: 1 }).action;
  assert.match(action, /missing|blocked_reserved/);
}
await new Promise((resolve, reject) => {
  resolutionRaceChild.on("error", reject);
  resolutionRaceChild.on("close", (code) => (code === 0 ? resolve() : reject(new Error(resolutionRaceStderr))));
});
assert.equal(resolvePaidImageSlotAction({ productDir: resolutionRaceProduct.productDir, slot: 1 }).action, "blocked_reserved");

const transitionRaceProduct = initializePaidImageProductLedger({
  ...identity,
  batchFingerprint: "batch-transition-race",
  recordId: "record-transition-race"
});
reservePaidImageSlot({
  productDir: transitionRaceProduct.productDir,
  slot: 1,
  requestDigest: "transition-race-request",
  promptDigest: "transition-race-prompt",
  owner: ownerA
});
function raceTransition(kind) {
  const worker = `
    import { recordPaidImageFailedBeforeAcceptance, recordPaidImageSubmitted } from ${JSON.stringify(ledgerModuleUrl)};
    try {
      const record = ${
        kind === "submitted"
          ? `recordPaidImageSubmitted({ productDir: ${JSON.stringify(transitionRaceProduct.productDir)}, slot: 1, providerTaskId: "race-provider-task" })`
          : `recordPaidImageFailedBeforeAcceptance({ productDir: ${JSON.stringify(transitionRaceProduct.productDir)}, slot: 1, reason: "explicit rejection" })`
      };
      process.stdout.write("success:" + record.state);
    } catch (error) {
      process.stdout.write("rejected:" + error.message);
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", worker], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr))));
  });
}
const transitionRaceResults = await Promise.all([raceTransition("submitted"), raceTransition("failed")]);
assert.equal(transitionRaceResults.filter((item) => item.startsWith("success:")).length, 1);
assert.equal(transitionRaceResults.filter((item) => item.startsWith("rejected:invalid slot transition")).length, 1);
const transitionRaceRecord = JSON.parse(
  fs.readFileSync(path.join(transitionRaceProduct.productDir, "slots", "01.json"), "utf8")
);
assert.equal(transitionRaceRecord.audit.length, 2, "concurrent transition loser must not overwrite winner audit");
assert.equal(transitionRaceRecord.audit.at(-1).state, transitionRaceRecord.state);

const productDir = initialized.productDir;
const originalFsyncSync = fs.fsyncSync;
let directoryFsyncCount = 0;
fs.fsyncSync = (fd) => {
  if (fs.fstatSync(fd).isDirectory()) {
    directoryFsyncCount += 1;
  }
  return originalFsyncSync(fd);
};
const first = reservePaidImageSlot({
  productDir,
  slot: 1,
  requestDigest: "request-1",
  promptDigest: "prompt-1",
  owner: ownerA
});
assert.ok(directoryFsyncCount >= 1, "reservation must fsync the slots directory before returning submit permission");
assert.equal(first.action, "submit");
assert.equal(first.record.state, "reserved");

const second = reservePaidImageSlot({
  productDir,
  slot: 1,
  requestDigest: "request-1",
  promptDigest: "prompt-1",
  owner: ownerB
});
assert.equal(second.action, "blocked_reserved", "only one atomic reservation may win");
assert.throws(
  () =>
    reservePaidImageSlot({
      productDir,
      slot: 1,
      requestDigest: "request-conflict",
      promptDigest: "prompt-1",
      owner: ownerB
    }),
  /slot identity conflict/i
);
assert.throws(
  () => reservePaidImageSlot({ productDir, slot: 0, requestDigest: "x", promptDigest: "x", owner: ownerA }),
  /outside expected range/i
);
assert.throws(
  () => reservePaidImageSlot({ productDir, slot: 21, requestDigest: "x", promptDigest: "x", owner: ownerA }),
  /outside expected range/i
);

const directoryFsyncBeforeTransition = directoryFsyncCount;
const submitted = recordPaidImageSubmitted({
  productDir,
  slot: 1,
  providerTaskId: "provider-task-1",
  providerResponse: {
    id: "provider-task-1",
    status: "submitted",
    message: "A".repeat(2000),
    error: "data:image/png;base64," + "B".repeat(2000),
    token: "token-must-not-be-written",
    api_key: "api-key-must-not-be-written",
    authorization: "Bearer must-not-be-written",
    image: "data:image/png;base64,must-not-be-written"
  }
});
assert.ok(
  directoryFsyncCount >= directoryFsyncBeforeTransition + 3,
  "critical atomic slot rename must fsync its parent directory in addition to lock creation and release"
);
fs.fsyncSync = originalFsyncSync;
assert.equal(submitted.state, "submitted");
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 1 }).action, "poll");
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 1 }).providerTaskId, "provider-task-1");
assert.throws(
  () => recordPaidImageSubmitted({ productDir, slot: 3, providerTaskId: "data:image/png;base64," + "X".repeat(1000) }),
  /providerTaskId/i
);

const resultSource = path.join(rootDir, "generated.png");
fs.writeFileSync(resultSource, "generated-image", "utf8");
const resultFsyncEvents = [];
fs.fsyncSync = (fd) => {
  const stat = fs.fstatSync(fd);
  resultFsyncEvents.push(stat.isDirectory() ? "directory" : "file");
  return originalFsyncSync(fd);
};
const completed = recordPaidImageCompleted({ productDir, slot: 1, sourceFile: resultSource });
fs.fsyncSync = originalFsyncSync;
const completedResultDirectoryFsync = resultFsyncEvents.indexOf("directory");
assert.ok(completedResultDirectoryFsync > 0, "completed result rename must fsync its parent directory");
assert.ok(
  resultFsyncEvents.slice(0, completedResultDirectoryFsync).includes("file"),
  "copied temporary image result contents must be fsynced before rename and parent directory fsync"
);
assert.equal(completed.state, "completed");
const reuse = resolvePaidImageSlotAction({ productDir, slot: 1 });
assert.equal(reuse.action, "reuse");
assert.equal(fs.readFileSync(reuse.resultFile, "utf8"), "generated-image");
assert.equal(completed.resultDigest, sha256File(reuse.resultFile));
assert.equal(sha256Text("generated-image"), sha256File(resultSource));

const terminalRaceProduct = initializePaidImageProductLedger({
  ...identity,
  rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "paid-image-terminal-race-")),
  batchFingerprint: "batch-terminal-race",
  recordId: "record-terminal-race",
  expectedSlotCount: 2
});
reservePaidImageSlot({
  productDir: terminalRaceProduct.productDir,
  slot: 1,
  requestDigest: "terminal-complete-request",
  promptDigest: "terminal-complete-prompt",
  owner: ownerA
});
recordPaidImageSubmitted({
  productDir: terminalRaceProduct.productDir,
  slot: 1,
  providerTaskId: "terminal-complete-task"
});
const terminalCompleteSourceA = path.join(rootDir, "terminal-complete-a.png");
const terminalCompleteSourceB = path.join(rootDir, "terminal-complete-b.png");
const terminalCompleteConflict = path.join(rootDir, "terminal-complete-conflict.png");
fs.writeFileSync(terminalCompleteSourceA, "same-terminal-image", "utf8");
fs.writeFileSync(terminalCompleteSourceB, "same-terminal-image", "utf8");
fs.writeFileSync(terminalCompleteConflict, "different-terminal-image", "utf8");
const firstTerminalCompletion = recordPaidImageCompleted({
  productDir: terminalRaceProduct.productDir,
  slot: 1,
  sourceFile: terminalCompleteSourceA,
  providerTaskId: "terminal-complete-task"
});
const secondTerminalCompletion = recordPaidImageCompleted({
  productDir: terminalRaceProduct.productDir,
  slot: 1,
  sourceFile: terminalCompleteSourceB,
  providerTaskId: "terminal-complete-task"
});
assert.deepEqual(secondTerminalCompletion, firstTerminalCompletion, "two completion resumers must converge on one terminal record");
assert.equal(secondTerminalCompletion.audit.filter((entry) => entry.state === "completed").length, 1);
assert.throws(
  () =>
    recordPaidImageCompleted({
      productDir: terminalRaceProduct.productDir,
      slot: 1,
      sourceFile: terminalCompleteSourceB,
      providerTaskId: "different-terminal-task"
    }),
  /conflicting.*terminal|provider task.*mismatch/i,
  "a different provider task must not reuse completed terminal state"
);
assert.throws(
  () =>
    recordPaidImageCompleted({
      productDir: terminalRaceProduct.productDir,
      slot: 1,
      sourceFile: terminalCompleteConflict,
      providerTaskId: "terminal-complete-task"
    }),
  /conflicting.*terminal|result.*mismatch/i,
  "a different result digest must not reuse completed terminal state"
);

reservePaidImageSlot({
  productDir: terminalRaceProduct.productDir,
  slot: 2,
  requestDigest: "terminal-failure-request",
  promptDigest: "terminal-failure-prompt",
  owner: ownerA
});
recordPaidImageSubmitted({
  productDir: terminalRaceProduct.productDir,
  slot: 2,
  providerTaskId: "terminal-failure-task"
});
const terminalFailureInput = {
  productDir: terminalRaceProduct.productDir,
  slot: 2,
  providerTaskId: "terminal-failure-task",
  reason: "provider task failed: deterministic terminal failure",
  providerResponse: { id: "terminal-failure-task", status: "failed", code: "terminal_failure" }
};
const firstTerminalFailure = recordPaidImageFailedAfterAcceptance(terminalFailureInput);
const secondTerminalFailure = recordPaidImageFailedAfterAcceptance(terminalFailureInput);
assert.deepEqual(secondTerminalFailure, firstTerminalFailure, "two failure resumers must converge on one terminal record");
assert.equal(secondTerminalFailure.audit.filter((entry) => entry.state === "failed_after_acceptance").length, 1);
assert.throws(
  () => recordPaidImageFailedAfterAcceptance({ ...terminalFailureInput, providerTaskId: "different-failure-task" }),
  /conflicting.*terminal|provider task.*mismatch/i,
  "a different provider task must not reuse failed terminal state"
);
assert.throws(
  () => recordPaidImageFailedAfterAcceptance({ ...terminalFailureInput, reason: "provider task failed: conflicting evidence" }),
  /conflicting.*terminal|evidence.*mismatch/i,
  "different failure evidence must fail closed"
);

const ambiguousReservation = reservePaidImageSlot({
  productDir,
  slot: 2,
  requestDigest: "request-2",
  promptDigest: "prompt-2",
  owner: ownerA
});
assert.equal(ambiguousReservation.action, "submit");
recordPaidImageAmbiguous({ productDir, slot: 2, reason: "transport timeout", providerResponse: { secret: "must-not-write" } });
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 2 }).action, "blocked_ambiguous");
assert.equal(
  reservePaidImageSlot({
    productDir,
    slot: 2,
    requestDigest: "request-2",
    promptDigest: "prompt-2",
    owner: ownerB
  }).action,
  "blocked_ambiguous",
  "ambiguous slots must remain permanently blocked from automatic resubmission"
);
const ambiguousSlotFile = path.join(productDir, "slots", "02.json");
const ambiguousSlot = JSON.parse(fs.readFileSync(ambiguousSlotFile, "utf8"));
const oldAmbiguousAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
ambiguousSlot.updatedAt = oldAmbiguousAt;
ambiguousSlot.audit[ambiguousSlot.audit.length - 1].at = oldAmbiguousAt;
fs.writeFileSync(ambiguousSlotFile, JSON.stringify(ambiguousSlot, null, 2) + "\n", "utf8");
assert.equal(
  reservePaidImageSlot({
    productDir,
    slot: 2,
    requestDigest: "request-2",
    promptDigest: "prompt-2",
    owner: ownerB
  }).action,
  "blocked_ambiguous",
  "elapsed time must never turn an uncertain paid submission into another paid submission"
);
const reconciledAmbiguous = reconcileAmbiguousPaidImageTask({
  productDir,
  slot: 2,
  providerTaskId: "provider-task-2",
  reason: "operator matched the only provider task missing from this product ledger"
});
assert.equal(reconciledAmbiguous.state, "submitted");
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 2 }).action, "poll");
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 2 }).providerTaskId, "provider-task-2");
assert.deepEqual(reconciledAmbiguous.audit.map((entry) => entry.state), ["reserved", "ambiguous", "submitted"]);
assert.match(reconciledAmbiguous.audit.at(-1).reason, /operator matched/);

const autoRetryProduct = initializePaidImageProductLedger({
  ...identity,
  batchFingerprint: "batch-auto-no-acceptance",
  recordId: "record-auto-no-acceptance"
});
reservePaidImageSlot({
  productDir: autoRetryProduct.productDir,
  slot: 1,
  requestDigest: "request-6",
  promptDigest: "prompt-6",
  owner: ownerA
});
recordPaidImageAmbiguous({ productDir: autoRetryProduct.productDir, slot: 1, reason: "fetch failed" });
assert.equal(
  resolvePaidImageSlotAction({ productDir: autoRetryProduct.productDir, slot: 1 }).action,
  "retry_failed_before_acceptance",
  "slot action resolution must not block no-task submit transport failures before reserve is called"
);
const autoNoAcceptanceRetry = reservePaidImageSlot({
  productDir: autoRetryProduct.productDir,
  slot: 1,
  requestDigest: "request-6",
  promptDigest: "prompt-6",
  owner: ownerB
});
assert.equal(
  autoNoAcceptanceRetry.action,
  "submit",
  "ambiguous submit failures without provider task evidence must auto-reconcile to retryable no-acceptance"
);
assert.deepEqual(
  autoNoAcceptanceRetry.record.audit.map((entry) => entry.state),
  ["reserved", "ambiguous", "failed_before_acceptance", "reserved"]
);
reservePaidImageSlot({
  productDir: autoRetryProduct.productDir,
  slot: 2,
  requestDigest: "request-7",
  promptDigest: "prompt-7",
  owner: ownerA
});
recordPaidImageAmbiguous({
  productDir: autoRetryProduct.productDir,
  slot: 2,
  reason:
    'HTTP 503: {"code":"fail_to_fetch_task","message":"{\\"error\\":{\\"code\\":\\"model_not_found\\",\\"message\\":\\"No available channel for model gpt-image-2 under group default\\"}}","data":null}'
});
assert.equal(
  resolvePaidImageSlotAction({ productDir: autoRetryProduct.productDir, slot: 2 }).action,
  "retry_failed_before_acceptance",
  "model channel fail_to_fetch_task responses without task ids must auto-reconcile to no-acceptance"
);

const ambiguousSubmittedReservation = reservePaidImageSlot({
  productDir,
  slot: 4,
  requestDigest: "request-4",
  promptDigest: "prompt-4",
  owner: ownerA
});
assert.equal(ambiguousSubmittedReservation.action, "submit");
recordPaidImageSubmitted({ productDir, slot: 4, providerTaskId: "provider-task-4" });
recordPaidImageAmbiguous({ productDir, slot: 4, reason: "download timeout" });
const ambiguousSubmittedAction = resolvePaidImageSlotAction({ productDir, slot: 4 });
assert.equal(
  ambiguousSubmittedAction.action,
  "blocked_ambiguous",
  "ambiguous slots must require explicit reconciliation even if an earlier task id is retained"
);
assert.throws(
  () =>
    reconcileAmbiguousPaidImageTask({
      productDir,
      slot: 4,
      providerTaskId: "different-provider-task",
      reason: "unsafe mismatch"
    }),
  /provider task id mismatch/i
);
reservePaidImageSlot({
  productDir,
  slot: 5,
  requestDigest: "request-5",
  promptDigest: "prompt-5",
  owner: ownerA
});
recordPaidImageAmbiguous({ productDir, slot: 5, reason: "transport timeout" });
assert.throws(
  () =>
    reconcileAmbiguousPaidImageTask({
      productDir,
      slot: 5,
      providerTaskId: "provider-task-2",
      reason: "unsafe duplicate"
    }),
  /already belongs to slot 2/i
);
reconcileAmbiguousPaidImageTask({
  productDir,
  slot: 4,
  providerTaskId: "provider-task-4",
  reason: "verified existing task is complete"
});
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 4 }).action, "poll");

reservePaidImageSlot({
  productDir,
  slot: 7,
  requestDigest: "request-7",
  promptDigest: "prompt-7",
  owner: ownerA
});
recordPaidImageSubmitted({ productDir, slot: 7, providerTaskId: "provider-task-7" });
const failedAfterAcceptance = recordPaidImageFailedAfterAcceptance({
  productDir,
  slot: 7,
  reason: "provider task failed: upstream model failed",
  providerResponse: { id: "provider-task-7", status: "failed", progress: 100, error: { message: "upstream model failed" } }
});
assert.equal(failedAfterAcceptance.state, "failed_after_acceptance");
assert.equal(
  resolvePaidImageSlotAction({ productDir, slot: 7 }).action,
  "retry_failed_after_acceptance",
  "provider-accepted tasks that explicitly fail must retry only the same fixed slot"
);
const failedAfterAcceptanceRetry = reservePaidImageSlot({
  productDir,
  slot: 7,
  requestDigest: "request-7",
  promptDigest: "prompt-7",
  owner: ownerB
});
assert.equal(failedAfterAcceptanceRetry.action, "submit");
assert.deepEqual(
  failedAfterAcceptanceRetry.record.audit.map((entry) => entry.state),
  ["reserved", "submitted", "failed_after_acceptance", "reserved"]
);

reservePaidImageSlot({
  productDir,
  slot: 11,
  requestDigest: "request-11",
  promptDigest: "prompt-11",
  owner: ownerA
});
recordPaidImageSubmitted({ productDir, slot: 11, providerTaskId: "provider-task-11" });
assert.equal(
  expireSubmittedPaidImageQueue({
    productDir,
    slot: 11,
    minSubmittedAgeMs: 24 * 60 * 60 * 1000,
    reason: "not stale yet"
  }),
  undefined,
  "fresh submitted slots must not be expired as dead queue"
);
const staleQueue = expireSubmittedPaidImageQueue({
  productDir,
  slot: 11,
  minSubmittedAgeMs: 0,
  reason: "accepted task stayed queued beyond threshold"
});
assert.equal(staleQueue?.state, "failed_after_acceptance");
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 11 }).action, "retry_failed_after_acceptance");

reservePaidImageSlot({
  productDir,
  slot: 8,
  requestDigest: "request-8",
  promptDigest: "prompt-8",
  owner: ownerA
});
recordPaidImageSubmitted({ productDir, slot: 8, providerTaskId: "provider-task-8" });
recordPaidImageAmbiguous({
  productDir,
  slot: 8,
  reason: "provider task failed: legacy classification",
  providerResponse: { id: "provider-task-8", status: "failed", error: { message: "legacy failed task" } }
});
const reconciledProviderFailure = reconcileAmbiguousPaidImageProviderFailure({
  productDir,
  slot: 8,
  providerTaskId: "provider-task-8",
  reason: "legacy ambiguous slot was an explicit provider task failure"
});
assert.equal(reconciledProviderFailure.state, "failed_after_acceptance");
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 8 }).action, "retry_failed_after_acceptance");
assert.throws(
  () =>
    reservePaidImageSlot({
      productDir,
      slot: 8,
      requestDigest: "request-8-different",
      promptDigest: "prompt-8-different",
      owner: ownerB
    }),
  /slot identity conflict/i,
  "non-policy provider failures must not permit changing the prompt digest on retry"
);

reservePaidImageSlot({
  productDir,
  slot: 10,
  requestDigest: "request-10-original",
  promptDigest: "prompt-10-original",
  owner: ownerA
});
recordPaidImageSubmitted({ productDir, slot: 10, providerTaskId: "provider-task-10" });
recordPaidImageFailedAfterAcceptance({
  productDir,
  slot: 10,
  reason: 'provider task failed: {"code":"upstream_error","message":"提示词或图片中可能包含违规信息，请修改后重试"}',
  providerResponse: {
    id: "provider-task-10",
    status: "failed",
    error: { code: "upstream_error", message: "提示词或图片中可能包含违规信息，请修改后重试" }
  }
});
const policyRetryWithNewDigest = reservePaidImageSlot({
  productDir,
  slot: 10,
  requestDigest: "request-10-policy-compatible",
  promptDigest: "prompt-10-policy-compatible",
  owner: ownerB,
  allowFailedAfterAcceptanceDigestChange: true
});
assert.equal(policyRetryWithNewDigest.action, "submit");
assert.equal(policyRetryWithNewDigest.record.requestDigest, "request-10-policy-compatible");
assert.equal(policyRetryWithNewDigest.record.promptDigest, "prompt-10-policy-compatible");
assert.deepEqual(
  policyRetryWithNewDigest.record.audit.map((entry) => entry.state),
  ["reserved", "submitted", "failed_after_acceptance", "reserved"]
);
recordPaidImageSubmitted({ productDir, slot: 10, providerTaskId: "provider-task-10-policy-compatible" });
recordPaidImageFailedAfterAcceptance({
  productDir,
  slot: 10,
  reason: "provider task failed: policy-compatible task timed out"
});
const samePolicyDigestRetry = reservePaidImageSlot({
  productDir,
  slot: 10,
  requestDigest: "request-10-policy-compatible",
  promptDigest: "prompt-10-policy-compatible",
  owner: ownerA
});
assert.equal(samePolicyDigestRetry.action, "submit", "ordinary retries must preserve a persisted policy-compatible identity");
recordPaidImageSubmitted({ productDir, slot: 10, providerTaskId: "provider-task-10-policy-compatible-again" });
recordPaidImageFailedAfterAcceptance({
  productDir,
  slot: 10,
  reason: "provider task failed: policy-compatible task timed out again"
});
assert.throws(
  () =>
    reservePaidImageSlot({
      productDir,
      slot: 10,
      requestDigest: "request-10-original",
      promptDigest: "prompt-10-original",
      owner: ownerB
    }),
  /slot identity conflict/i,
  "a policy-compatible slot must never transition back to a different original digest"
);
assert.equal(
  reservePaidImageSlot({
    productDir,
    slot: 10,
    requestDigest: "request-10-policy-compatible",
    promptDigest: "prompt-10-policy-compatible",
    owner: ownerB
  }).action,
  "submit",
  "the same persisted compatibility digests must remain retryable after rejecting an identity rollback"
);

reservePaidImageSlot({
  productDir,
  slot: 9,
  requestDigest: "request-9",
  promptDigest: "prompt-9",
  owner: ownerA
});
recordPaidImageAmbiguous({ productDir, slot: 9, reason: "submit transport failed before provider task id" });
const noAcceptance = reconcileAmbiguousPaidImageNoAcceptance({
  productDir,
  slot: 9,
  reason: "operator verified provider dashboard has 19 accepted tasks and 19 charges; slot 9 has no provider task"
});
assert.equal(noAcceptance.state, "failed_before_acceptance");
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 9 }).action, "retry_failed_before_acceptance");
const noAcceptanceRetry = reservePaidImageSlot({
  productDir,
  slot: 9,
  requestDigest: "request-9",
  promptDigest: "prompt-9",
  owner: ownerB
});
assert.equal(noAcceptanceRetry.action, "submit");
assert.deepEqual(
  noAcceptanceRetry.record.audit.map((entry) => entry.state),
  ["reserved", "ambiguous", "failed_before_acceptance", "reserved"]
);

reservePaidImageSlot({
  productDir,
  slot: 3,
  requestDigest: "request-3",
  promptDigest: "prompt-3",
  owner: ownerA
});
const failed = recordPaidImageFailedBeforeAcceptance({ productDir, slot: 3, reason: "provider explicitly rejected request" });
assert.equal(failed.state, "failed_before_acceptance");
const reacquired = reservePaidImageSlot({
  productDir,
  slot: 3,
  requestDigest: "request-3",
  promptDigest: "prompt-3",
  owner: ownerB
});
assert.equal(reacquired.action, "submit");
assert.equal(reacquired.record.state, "reserved");
assert.equal(reacquired.record.audit.length, 3, "fresh reservation must preserve failed attempt audit history");
assert.deepEqual(
  reacquired.record.audit.map((entry) => entry.state),
  ["reserved", "failed_before_acceptance", "reserved"]
);

assert.throws(() => recordPaidImageSubmitted({ productDir, slot: 2, providerTaskId: "nope" }), /invalid slot transition/i);
assert.throws(() => recordPaidImageCompleted({ productDir, slot: 3, sourceFile: resultSource }), /invalid slot transition/i);

const summary = summarizePaidImageProductLedger(productDir);
assert.deepEqual(summary, {
  expectedSlotCount: 20,
  missing: 10,
  reserved: 4,
  submitted: 2,
  completed: 1,
  failedBeforeAcceptance: 0,
  failedAfterAcceptance: 2,
  ambiguous: 1
});
const completedResultFile = completed.resultFile;
assert.ok(completedResultFile);
const temporarilyDeletedResultFile = `${completedResultFile}.deleted-for-audit-test`;
fs.renameSync(completedResultFile, temporarilyDeletedResultFile);
const deletedResultAudit = inspectPaidImageProductLedgerForAudit(productDir);
assert.equal(deletedResultAudit.summary.expectedSlotCount, 20);
assert.equal(deletedResultAudit.summary.completed, 0);
assert.equal(deletedResultAudit.summary.missing, 11);
assert.deepEqual(deletedResultAudit.errors.map((issue) => issue.code), ["completed_result_missing_or_invalid"]);
assert.throws(
  () => summarizePaidImageProductLedger(productDir),
  /completed paid image result is missing or invalid for slot 1/i,
  "a deleted completed result must fail closed instead of counting as generated"
);
fs.renameSync(temporarilyDeletedResultFile, completedResultFile);
const validCompletedResult = fs.readFileSync(completedResultFile);
fs.writeFileSync(completedResultFile, "corrupted-completed-image", "utf8");
const corruptedResultAudit = inspectPaidImageProductLedgerForAudit(productDir);
assert.equal(corruptedResultAudit.summary.expectedSlotCount, 20);
assert.equal(corruptedResultAudit.summary.completed, 0);
assert.equal(corruptedResultAudit.summary.missing, 11);
assert.deepEqual(corruptedResultAudit.errors.map((issue) => issue.code), ["completed_result_missing_or_invalid"]);
assert.throws(
  () => summarizePaidImageProductLedger(productDir),
  /completed paid image result is missing or invalid for slot 1/i,
  "a corrupted completed result must fail closed instead of counting as generated"
);
fs.writeFileSync(completedResultFile, validCompletedResult);
assert.equal(
  summarizePaidImageProductLedger(productDir).completed,
  1,
  "a completed slot with an existing SHA-256-matching result counts as generated"
);

const completedSlotFile = path.join(productDir, "slots", "01.json");
const canonicalCompletedSlotText = fs.readFileSync(completedSlotFile, "utf8");
const externalCompletedSlot = JSON.parse(canonicalCompletedSlotText);
externalCompletedSlot.resultFile = resultSource;
fs.writeFileSync(completedSlotFile, JSON.stringify(externalCompletedSlot, null, 2) + "\n", "utf8");
assert.deepEqual(
  inspectPaidImageProductLedgerForAudit(productDir).errors.map((issue) => issue.code),
  ["completed_result_missing_or_invalid"],
  "an external same-digest result path must not count as a completed product artifact"
);
fs.writeFileSync(completedSlotFile, canonicalCompletedSlotText, "utf8");
const escapingCompletedSlot = JSON.parse(canonicalCompletedSlotText);
escapingCompletedSlot.resultFile = `${productDir}/results/../results/01.png`;
fs.writeFileSync(completedSlotFile, JSON.stringify(escapingCompletedSlot, null, 2) + "\n", "utf8");
assert.deepEqual(
  inspectPaidImageProductLedgerForAudit(productDir).errors.map((issue) => issue.code),
  ["completed_result_missing_or_invalid"],
  "a result path containing parent traversal must not count even when it resolves to the canonical file"
);
fs.writeFileSync(completedSlotFile, canonicalCompletedSlotText, "utf8");

const canonicalResultBackup = `${completedResultFile}.real`;
fs.renameSync(completedResultFile, canonicalResultBackup);
let fileSymlinkSupported = true;
try {
  fs.symlinkSync(canonicalResultBackup, completedResultFile, "file");
} catch (error) {
  if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
  fileSymlinkSupported = false;
}
if (fileSymlinkSupported) {
  assert.deepEqual(
    inspectPaidImageProductLedgerForAudit(productDir).errors.map((issue) => issue.code),
    ["completed_result_missing_or_invalid"],
    "a symlinked completed result must not count"
  );
  fs.unlinkSync(completedResultFile);
}
fs.renameSync(canonicalResultBackup, completedResultFile);

const canonicalResultsDir = path.join(productDir, "results");
const canonicalResultsDirBackup = path.join(productDir, "results-real");
fs.renameSync(canonicalResultsDir, canonicalResultsDirBackup);
let directorySymlinkSupported = true;
try {
  fs.symlinkSync(canonicalResultsDirBackup, canonicalResultsDir, "dir");
} catch (error) {
  if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
  directorySymlinkSupported = false;
}
if (directorySymlinkSupported) {
  assert.deepEqual(
    inspectPaidImageProductLedgerForAudit(productDir).errors.map((issue) => issue.code),
    ["completed_result_missing_or_invalid"],
    "a symlinked results directory must not count completed artifacts"
  );
  fs.unlinkSync(canonicalResultsDir);
}
fs.renameSync(canonicalResultsDirBackup, canonicalResultsDir);

const ledgerText = fs
  .readdirSync(path.join(productDir, "slots"))
  .map((file) => fs.readFileSync(path.join(productDir, "slots", file), "utf8"))
  .join("\n");
assert.doesNotMatch(ledgerText, /Bearer must-not-be-written|must-not-be-written|must-not-write|base64,/i);
assert.doesNotMatch(ledgerText, /A{100}|B{100}|token-must|api-key-must/i);

const invalidSlotFile = path.join(productDir, "slots", "21.json");
fs.writeFileSync(invalidSlotFile, JSON.stringify({ slot: 21, state: "reserved" }), "utf8");
assert.throws(() => summarizePaidImageProductLedger(productDir), /outside expected range/i);

const noncanonicalProduct = initializePaidImageProductLedger({
  ...identity,
  batchFingerprint: "batch-noncanonical-slot",
  recordId: "record-noncanonical-slot"
});
reservePaidImageSlot({
  productDir: noncanonicalProduct.productDir,
  slot: 1,
  requestDigest: "noncanonical-request",
  promptDigest: "noncanonical-prompt",
  owner: ownerA
});
fs.copyFileSync(
  path.join(noncanonicalProduct.productDir, "slots", "01.json"),
  path.join(noncanonicalProduct.productDir, "slots", "1.json")
);
assert.throws(() => summarizePaidImageProductLedger(noncanonicalProduct.productDir), /noncanonical|invalid paid image slot ledger file/i);

const staleLockProduct = initializePaidImageProductLedger({
  ...identity,
  batchFingerprint: "batch-stale-lock",
  recordId: "record-stale-lock"
});
reservePaidImageSlot({
  productDir: staleLockProduct.productDir,
  slot: 1,
  requestDigest: "stale-lock-request",
  promptDigest: "stale-lock-prompt",
  owner: ownerA
});
const staleLockFile = path.join(staleLockProduct.productDir, "slots", "01.json.lock");
const staleRecoveryLockFile = `${staleLockFile}.recovery.lock`;
fs.writeFileSync(
  staleLockFile,
  JSON.stringify({
    pid: 2147483647,
    acquiredAt: "2000-01-01T00:00:00.000Z",
    token: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    processIdentity: "dead-process-identity",
    processIdentitySource: currentProcessIdentity.source
  }),
  "utf8"
);
fs.writeFileSync(
  staleRecoveryLockFile,
  JSON.stringify({
    pid: 2147483647,
    acquiredAt: "2000-01-01T00:00:00.000Z",
    token: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    processIdentity: "dead-process-identity",
    processIdentitySource: "ps-lstart-command-sha256"
  }),
  "utf8"
);
assert.equal(
  recordPaidImageSubmitted({ productDir: staleLockProduct.productDir, slot: 1, providerTaskId: "stale-recovered-task" }).state,
  "submitted",
  "provably stale dead-process lock must be recovered"
);
assert.equal(fs.existsSync(staleLockFile), false);
assert.equal(fs.existsSync(staleRecoveryLockFile), false);

const pidReuseProduct = initializePaidImageProductLedger({
  ...identity,
  batchFingerprint: "batch-pid-reuse-lock",
  recordId: "record-pid-reuse-lock"
});
reservePaidImageSlot({
  productDir: pidReuseProduct.productDir,
  slot: 1,
  requestDigest: "pid-reuse-request",
  promptDigest: "pid-reuse-prompt",
  owner: ownerA
});
const pidReuseLockFile = path.join(pidReuseProduct.productDir, "slots", "01.json.lock");
fs.writeFileSync(
  pidReuseLockFile,
  JSON.stringify({
    pid: process.pid,
    acquiredAt: "2000-01-01T00:00:00.000Z",
    token: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    processIdentity: "different-process-start-identity",
    processIdentitySource: currentProcessIdentity.source
  }),
  "utf8"
);
assert.equal(
  recordPaidImageSubmitted({ productDir: pidReuseProduct.productDir, slot: 1, providerTaskId: "pid-reuse-recovered-task" })
    .state,
  "submitted",
  "same pid with different process-start identity must recover"
);
assert.equal(fs.existsSync(pidReuseLockFile), false);

const liveLockProduct = initializePaidImageProductLedger({
  ...identity,
  batchFingerprint: "batch-live-lock",
  recordId: "record-live-lock"
});
reservePaidImageSlot({
  productDir: liveLockProduct.productDir,
  slot: 1,
  requestDigest: "live-lock-request",
  promptDigest: "live-lock-prompt",
  owner: ownerA
});
const liveLockFile = path.join(liveLockProduct.productDir, "slots", "01.json.lock");
const liveLockToken = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
fs.writeFileSync(
  liveLockFile,
  JSON.stringify({
    pid: process.pid,
    acquiredAt: "2000-01-01T00:00:00.000Z",
    token: liveLockToken,
    processIdentity: currentProcessIdentity.identity,
    processIdentitySource: currentProcessIdentity.source
  }),
  "utf8"
);
const liveLockWorker = `
  import { recordPaidImageSubmitted } from ${JSON.stringify(ledgerModuleUrl)};
  recordPaidImageSubmitted({
    productDir: ${JSON.stringify(liveLockProduct.productDir)},
    slot: 1,
    providerTaskId: "must-not-steal-live-lock"
  });
`;
const liveLockChild = spawn(process.execPath, ["--input-type=module", "-e", liveLockWorker], {
  stdio: ["ignore", "ignore", "pipe"]
});
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(liveLockChild.exitCode, null, "verified live old lock must continue blocking a competing transition");
assert.equal(JSON.parse(fs.readFileSync(liveLockFile, "utf8")).token, liveLockToken);
liveLockChild.kill("SIGTERM");
await new Promise((resolve) => liveLockChild.on("close", resolve));
fs.unlinkSync(liveLockFile);

const fallbackIdentityProduct = initializePaidImageProductLedger({
  ...identity,
  batchFingerprint: "batch-fallback-identity-lock",
  recordId: "record-fallback-identity-lock"
});
reservePaidImageSlot({
  productDir: fallbackIdentityProduct.productDir,
  slot: 1,
  requestDigest: "fallback-identity-request",
  promptDigest: "fallback-identity-prompt",
  owner: ownerA
});
const fallbackIdentityLockFile = path.join(fallbackIdentityProduct.productDir, "slots", "01.json.lock");
const fallbackIdentityToken = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
fs.writeFileSync(
  fallbackIdentityLockFile,
  JSON.stringify({
    pid: process.pid,
    acquiredAt: "2000-01-01T00:00:00.000Z",
    token: fallbackIdentityToken,
    processIdentity: "fallback-created-identity",
    processIdentitySource: "local-fallback"
  }),
  "utf8"
);
const fallbackIdentityWorker = spawn(process.execPath, ["--input-type=module", "-e", `
  import { recordPaidImageSubmitted } from ${JSON.stringify(ledgerModuleUrl)};
  recordPaidImageSubmitted({
    productDir: ${JSON.stringify(fallbackIdentityProduct.productDir)},
    slot: 1,
    providerTaskId: "must-not-steal-fallback-identity-lock"
  });
`], { stdio: ["ignore", "ignore", "pipe"] });
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(fallbackIdentityWorker.exitCode, null, "fallback-created live lock must fail closed against authoritative check");
assert.equal(JSON.parse(fs.readFileSync(fallbackIdentityLockFile, "utf8")).token, fallbackIdentityToken);
fallbackIdentityWorker.kill("SIGTERM");
await new Promise((resolve) => fallbackIdentityWorker.on("close", resolve));
fs.unlinkSync(fallbackIdentityLockFile);

function assertMalformedSlotRejected(label, mutate) {
  const malformedProduct = initializePaidImageProductLedger({
    ...identity,
    batchFingerprint: `batch-malformed-${label}`,
    recordId: `record-malformed-${label}`
  });
  reservePaidImageSlot({
    productDir: malformedProduct.productDir,
    slot: 1,
    requestDigest: "malformed-request",
    promptDigest: "malformed-prompt",
    owner: ownerA
  });
  const file = path.join(malformedProduct.productDir, "slots", "01.json");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(record);
  fs.writeFileSync(file, JSON.stringify(record), "utf8");
  assert.throws(() => resolvePaidImageSlotAction({ productDir: malformedProduct.productDir, slot: 1 }), /invalid paid image slot record/i);
}
assertMalformedSlotRejected("provider-task-type", (record) => (record.providerTaskId = { payload: true }));
assertMalformedSlotRejected(
  "provider-summary-secret",
  (record) => (record.providerResponseSummary = { message: "Bearer existing-secret-must-fail-closed" })
);
assertMalformedSlotRejected("result-file-type", (record) => (record.resultFile = 123));
assertMalformedSlotRejected("result-file-format", (record) => (record.resultFile = "relative/result.png"));
assertMalformedSlotRejected("result-digest-format", (record) => (record.resultDigest = "not-a-sha256"));
assertMalformedSlotRejected("audit-final-state", (record) => (record.audit.at(-1).state = "ambiguous"));
assertMalformedSlotRejected(
  "audit-owner-secret",
  (record) => (record.audit[0].owner.runId = "Bearer existing-audit-owner-secret")
);
assertMalformedSlotRejected(
  "audit-owner-extra-secret",
  (record) => (record.audit[0].owner.token = "existing-audit-owner-token")
);
assertMalformedSlotRejected("top-level-owner-secret", (record) => (record.owner.taskId = "access_token=existing-secret"));
assertMalformedSlotRejected(
  "audit-reason-base64",
  (record) => (record.audit[0].reason = "data:image/png;base64," + "A".repeat(200))
);
assertMalformedSlotRejected("top-level-reason-secret", (record) => (record.reason = "api_key=existing-secret"));

const cleanupLedgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paid-image-ledger-cleanup-"));
const cleanupProductA = initializePaidImageProductLedger({
  rootDir: cleanupLedgerRoot,
  batchFingerprint: "cleanup-batch",
  recordId: "cleanup-record-a",
  expectedSlotCount: 1,
  providerIdentity: "cleanup-provider",
  sourceImageDigest: "cleanup-source-a"
});
initializePaidImageProductLedger({
  rootDir: cleanupLedgerRoot,
  batchFingerprint: "cleanup-batch",
  recordId: "cleanup-record-b",
  expectedSlotCount: 1,
  providerIdentity: "cleanup-provider",
  sourceImageDigest: "cleanup-source-b"
});
assert.equal(removePaidImageProductLedger(cleanupLedgerRoot, "cleanup-batch", "cleanup-record-a"), true);
assert.equal(fs.existsSync(cleanupProductA.productDir), false, "A safely completed product ledger must be removable immediately.");
assert.equal(removePaidImageBatchLedger(cleanupLedgerRoot, "cleanup-batch"), true);
assert.equal(fs.readdirSync(cleanupLedgerRoot).length, 0, "Confirmed batch rerun or batch completion must remove the whole batch ledger.");
fs.rmSync(cleanupLedgerRoot, { recursive: true, force: true });

console.log("paid image submission ledger tests passed");
