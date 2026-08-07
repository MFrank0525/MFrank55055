import assert from "node:assert/strict";
import fs from "node:fs";

const launchSource = fs.readFileSync("src/browser/launch.ts", "utf8");
const doctorSource = fs.readFileSync("src/cli/doctor.ts", "utf8");
const workspaceSection = launchSource.match(/const WORKSPACE_PAGE_SPECS = \[[\s\S]*?\] as const;/)?.[0] || "";

assert.ok(workspaceSection.includes("shop"), "Browser workspace must keep the Doudian shop page.");
assert.equal((workspaceSection.match(/key:/g) || []).length, 1, "Browser workspace must contain only the Doudian shop page.");
assert.match(launchSource, /const DOUYIN_SHOP_URL = "https:\/\/fxg\.jinritemai\.com\/ffa\/g\/spu-record"/);
assert.match(
  launchSource,
  /export function resolveBrowserExecutable\(\): string/,
  "The runtime browser resolver must be exported as the single browser-availability contract."
);
assert.match(
  launchSource,
  /const executable = resolveBrowserExecutable\(\);/,
  "The real CDP launcher must use the shared browser resolver."
);
assert.match(
  doctorSource,
  /import \{ resolveBrowserExecutable \} from "\.\.\/browser\/launch\.js";/,
  "Doctor must import the same browser resolver used by the real publisher."
);
assert.match(
  doctorSource,
  /const executablePath = resolveBrowserExecutable\(\);/,
  "Doctor must validate the actual runtime browser candidate."
);
assert.doesNotMatch(
  doctorSource,
  /chromium\.executablePath\(\)/,
  "Doctor must not require a Hermes-HOME Playwright bundle when runtime uses system Chrome."
);
