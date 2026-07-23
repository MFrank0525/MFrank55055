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
  /isExpectedRemoteBrowserProcessRunning\(userDataDir, port\)[\s\S]*return await connectBrowser\(\)/,
  "CDP recovery must verify the listening browser belongs to the requested user-data-dir before connecting"
);
assert.match(
  launchSource,
  /const REMOTE_DEBUGGING_PORTS = \[[^\]]*9555[^\]]*9666[^\]]*\]/,
  "Reusable browser launch must include project fallback ports beyond shared 9333/9444"
);
assert.match(
  launchSource,
  /remote debugging port.*occupied by another browser profile.*skipping/i,
  "A port owned by another browser profile must be skipped without closing or connecting to it"
);
assert.match(
  launchSource,
  /spawnSync\("lsof", \["-nP", `-iTCP:\$\{port\}`, "-sTCP:LISTEN", "-Fp"\]/,
  "Browser profile validation must resolve the actual listening PID instead of trusting competing Chrome command lines"
);
assert.match(
  launchSource,
  /return listenerPids\.every\(/,
  "A shared port is safe only when every listening PID belongs to the requested browser profile"
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
assert.match(
  recoverySource,
  /if \(!isExpectedRemoteBrowserProcessRunning\(userDataDir, port\)\)[\s\S]*if \(await isDebugEndpointReady\(port\)\)[\s\S]*killRemoteDebuggingBrowserProcesses\(userDataDir, port\)/,
  "Shared-port recovery may relocate only this project's profile after listener-owner validation fails"
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
