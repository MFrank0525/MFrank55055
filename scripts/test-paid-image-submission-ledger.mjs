import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  initializePaidImageProductLedger,
  paidImageProductLedgerDir,
  recordPaidImageAmbiguous,
  recordPaidImageCompleted,
  recordPaidImageFailedBeforeAcceptance,
  recordPaidImageSubmitted,
  reservePaidImageSlot,
  resolvePaidImageSlotAction,
  sha256File,
  sha256Text,
  summarizePaidImageProductLedger
} from "../dist/src/autolist/paid-image-submission-ledger.js";

const ledgerSource = fs.readFileSync("src/autolist/paid-image-submission-ledger.ts", "utf8");
assert.match(
  ledgerSource,
  /fs\.openSync\(file,\s*"wx"\)/,
  "missing-slot reservation winner must be decided by wx creation of the slot file itself"
);

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
assert.throws(
  () => initializePaidImageProductLedger({ ...identity, providerIdentity: "provider-conflict" }),
  /ledger identity conflict/i
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
const completed = recordPaidImageCompleted({ productDir, slot: 1, sourceFile: resultSource });
assert.equal(completed.state, "completed");
const reuse = resolvePaidImageSlotAction({ productDir, slot: 1 });
assert.equal(reuse.action, "reuse");
assert.equal(fs.readFileSync(reuse.resultFile, "utf8"), "generated-image");
assert.equal(completed.resultDigest, sha256File(reuse.resultFile));
assert.equal(sha256Text("generated-image"), sha256File(resultSource));

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
  "ambiguous slots must remain permanently blocked"
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
  missing: 17,
  reserved: 1,
  submitted: 0,
  completed: 1,
  failedBeforeAcceptance: 0,
  ambiguous: 1
});

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
  JSON.stringify({ pid: 2147483647, acquiredAt: "2000-01-01T00:00:00.000Z", token: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
  "utf8"
);
fs.writeFileSync(
  staleRecoveryLockFile,
  JSON.stringify({ pid: 2147483647, acquiredAt: "2000-01-01T00:00:00.000Z", token: "cccccccc-cccc-cccc-cccc-cccccccccccc" }),
  "utf8"
);
assert.equal(
  recordPaidImageSubmitted({ productDir: staleLockProduct.productDir, slot: 1, providerTaskId: "stale-recovered-task" }).state,
  "submitted",
  "provably stale dead-process lock must be recovered"
);
assert.equal(fs.existsSync(staleLockFile), false);
assert.equal(fs.existsSync(staleRecoveryLockFile), false);

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
  JSON.stringify({ pid: process.pid, acquiredAt: "2000-01-01T00:00:00.000Z", token: liveLockToken }),
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
assert.equal(liveLockChild.exitCode, null, "live lock must continue blocking a competing transition");
assert.equal(JSON.parse(fs.readFileSync(liveLockFile, "utf8")).token, liveLockToken);
liveLockChild.kill("SIGTERM");
await new Promise((resolve) => liveLockChild.on("close", resolve));
fs.unlinkSync(liveLockFile);

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

console.log("paid image submission ledger tests passed");
