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

const productDir = initialized.productDir;
const first = reservePaidImageSlot({
  productDir,
  slot: 1,
  requestDigest: "request-1",
  promptDigest: "prompt-1",
  owner: ownerA
});
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

const submitted = recordPaidImageSubmitted({
  productDir,
  slot: 1,
  providerTaskId: "provider-task-1",
  providerResponse: {
    id: "provider-task-1",
    status: "submitted",
    authorization: "Bearer must-not-be-written",
    image: "data:image/png;base64,must-not-be-written"
  }
});
assert.equal(submitted.state, "submitted");
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 1 }).action, "poll");
assert.equal(resolvePaidImageSlotAction({ productDir, slot: 1 }).providerTaskId, "provider-task-1");

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

const invalidSlotFile = path.join(productDir, "slots", "21.json");
fs.writeFileSync(invalidSlotFile, JSON.stringify({ slot: 21, state: "reserved" }), "utf8");
assert.throws(() => summarizePaidImageProductLedger(productDir), /outside expected range/i);

console.log("paid image submission ledger tests passed");
