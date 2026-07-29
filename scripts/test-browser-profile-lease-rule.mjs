import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireBrowserProfileLease,
  releaseBrowserProfileLease
} from "../dist/src/browser/profile-lease.js";

const launchSource = fs.readFileSync("src/browser/launch.ts", "utf8");
assert.match(
  launchSource,
  /acquireBrowserProfileLease\(\{ leaseFile: browserProfileLeaseFile \}\)[\s\S]*connectBrowserWithRecovery/,
  "Browser launch must acquire the profile lease before any CDP connection"
);
assert.match(
  launchSource,
  /disconnectAutomationBrowserConnections[\s\S]*releaseBrowserProfileLease/,
  "Normal browser disconnection must release the profile lease"
);

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "doudian-browser-lease-"));
const leaseFile = path.join(runtimeDir, "owner.json");

acquireBrowserProfileLease({
  leaseFile,
  ownerPid: 101,
  isPidAlive: () => false,
  now: () => new Date("2026-07-29T11:00:00.000Z")
});
assert.equal(JSON.parse(fs.readFileSync(leaseFile, "utf8")).pid, 101);

acquireBrowserProfileLease({
  leaseFile,
  ownerPid: 101,
  isPidAlive: () => true
});

assert.throws(
  () =>
    acquireBrowserProfileLease({
      leaseFile,
      ownerPid: 202,
      isPidAlive: (pid) => pid === 101
    }),
  /owned by active process PID 101/,
  "A second live process must never share the fixed Doudian profile"
);

releaseBrowserProfileLease({ leaseFile, ownerPid: 202 });
assert.equal(fs.existsSync(leaseFile), true, "A non-owner must not remove the profile lease");
releaseBrowserProfileLease({ leaseFile, ownerPid: 101 });
assert.equal(fs.existsSync(leaseFile), false);

fs.writeFileSync(leaseFile, JSON.stringify({ pid: 303, acquiredAt: "old" }));
acquireBrowserProfileLease({
  leaseFile,
  ownerPid: 404,
  isPidAlive: () => false
});
assert.equal(JSON.parse(fs.readFileSync(leaseFile, "utf8")).pid, 404, "A dead owner lease must be recoverable");

fs.writeFileSync(leaseFile, "{broken");
assert.throws(
  () => acquireBrowserProfileLease({ leaseFile, ownerPid: 505, isPidAlive: () => false }),
  /unreadable/,
  "An unreadable ownership record must fail closed"
);

console.log("browser profile lease rules passed");
