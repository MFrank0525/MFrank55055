import assert from "node:assert/strict";
import fs from "node:fs";

const launchSource = fs.readFileSync("src/browser/launch.ts", "utf8");

assert.match(
  launchSource,
  /const DEBUG_ENDPOINT_REQUEST_TIMEOUT_MS = \d+/,
  "CDP debug endpoint probes must have an explicit hard timeout"
);
assert.match(
  launchSource,
  /fetch\([^;]+signal: AbortSignal\.timeout\(DEBUG_ENDPOINT_REQUEST_TIMEOUT_MS\)/s,
  "CDP debug endpoint fetches must abort instead of hanging indefinitely"
);
assert.match(
  launchSource,
  /chromium\.connectOverCDP\([^;]+timeout: CDP_CONNECT_TIMEOUT_MS/s,
  "Playwright CDP connections must have an explicit hard timeout"
);

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
  /for \(const port of REMOTE_DEBUGGING_PORTS\)[\s\S]*activeRemoteDebuggingPort = port[\s\S]*return await connectBrowser\(\)/,
  "CDP recovery must first try to reuse an already-listening browser through the real Playwright connection before launching a new Chrome"
);
assert.match(
  recoverySource,
  /killRemoteDebuggingBrowserProcesses\(userDataDir, activeRemoteDebuggingPort\)/,
  "CDP connect recovery must terminate the stale browser for the profile and port before retrying"
);
assert.doesNotMatch(
  recoverySource,
  /if \(await isDebugEndpointReady\(port\)\)[\s\S]{0,400}killRemoteDebuggingBrowserProcesses\(userDataDir, port\)/,
  "CDP connect recovery must not depend on shallow /json/version readiness before killing stale profile browsers"
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

assert.match(
  launchSource,
  /const stale = killRemoteDebuggingBrowserProcesses\(userDataDir, port\)[\s\S]*cleared stale remote debugging browser process\(es\) before launch on port/,
  "Reusable browser launch must clear stale same-profile browser processes before starting a new remote-debugging Chrome"
);

assert.match(
  launchSource,
  /installPlaywrightDialogRaceGuard/,
  "Reusable browser launch must install the Playwright dialog race guard"
);
assert.match(
  launchSource,
  /Page\\.handleJavaScriptDialog\\\): No dialog is showing/,
  "Playwright dialog race guard must be limited to the no-dialog-showing protocol race"
);
assert.match(
  launchSource,
  /throw reason instanceof Error/,
  "Playwright dialog race guard must rethrow unrelated unhandled rejections"
);

console.log("browser cdp recovery rule passed");
