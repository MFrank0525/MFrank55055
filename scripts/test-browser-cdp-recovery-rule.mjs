import assert from "node:assert/strict";
import fs from "node:fs";

const launchSource = fs.readFileSync("src/browser/launch.ts", "utf8");

assert.match(
  launchSource,
  /async function connectBrowserWithRecovery/,
  "launchPersistentBrowser must connect through a recovery wrapper"
);

const recoveryStart = launchSource.indexOf("async function connectBrowserWithRecovery");
assert.notEqual(recoveryStart, -1, "connectBrowserWithRecovery function not found");
const recoveryEnd = launchSource.indexOf("\nexport async function launchPersistentBrowser", recoveryStart);
const recoverySource = launchSource.slice(recoveryStart, recoveryEnd === -1 ? launchSource.length : recoveryEnd);

assert.match(
  recoverySource,
  /catch \(error\)/,
  "CDP connect failures must be caught at the real connectOverCDP boundary"
);
assert.match(
  recoverySource,
  /killRemoteDebuggingBrowserProcesses\(userDataDir, activeRemoteDebuggingPort\)/,
  "CDP connect recovery must terminate the stale browser for the profile and port before retrying"
);
assert.match(
  recoverySource,
  /await waitForDebugEndpointClosed\(activeRemoteDebuggingPort\)/,
  "CDP connect recovery must wait for the stale debug endpoint to close before relaunching"
);
assert.match(
  recoverySource,
  /return connectBrowser\(\)/,
  "CDP connect recovery must retry the real Playwright connection after relaunch"
);

console.log("browser cdp recovery rule passed");
