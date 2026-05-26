import assert from "node:assert/strict";
import fs from "node:fs";

const launchSource = fs.readFileSync("src/browser/launch.ts", "utf8");
const start = launchSource.indexOf("async function canConnectOverCdp");
assert.notEqual(start, -1, "canConnectOverCdp function not found");
const end = launchSource.indexOf("\nfunction ", start + 1);
const probeSource = launchSource.slice(start, end === -1 ? launchSource.length : end);

assert.match(
  probeSource,
  /\/json\/version/,
  "CDP probe must use the read-only version endpoint instead of creating a Browser connection"
);
assert.equal(
  probeSource.includes("connectOverCDP"),
  false,
  "CDP probe must not create a Browser connection during health checks"
);
assert.equal(
  probeSource.includes("browser.close()"),
  false,
  "CDP probe must not close the reusable browser during health checks"
);

console.log("browser cdp probe rule passed");
