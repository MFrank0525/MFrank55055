import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" });
const removedChatProvider = ["dou", "bao"].join("");
const removedImageModule = ["ji", "meng"].join("");
const removedImageCli = ["dream", "ina"].join("");
for (const forbidden of [
  `src/${removedChatProvider}/`,
  `src/browser/${removedChatProvider}.ts`,
  `src/cli/${removedChatProvider}-`,
  `scripts/${removedImageCli}-cli/`,
  `input/${removedChatProvider}-job.example.json`,
  `schemas/${removedChatProvider}-job.schema.json`,
  "schemas/legacy-task.schema.json",
  `src/autolist/${removedImageModule}-assets.ts`
]) {
  assert.equal(tracked.includes(forbidden), false, `obsolete path remains: ${forbidden}`);
}

const packageJson = fs.readFileSync("package.json", "utf8");
for (const token of [removedChatProvider, removedImageModule, removedImageCli]) {
  assert.equal(packageJson.toLowerCase().includes(token), false, `obsolete package entry remains: ${token}`);
}

const operationalFiles = [
  "README.md",
  "README.ai.md",
  ...fs.readdirSync("docs/auto-listing/steps").map((name) => `docs/auto-listing/steps/${name}`),
  "docs/auto-listing/script-map.md",
  "docs/auto-listing/FLOW_NODE_CONTRACT.md"
].filter((file) => fs.existsSync(file));

for (const file of operationalFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const token of [removedChatProvider, removedImageModule, removedImageCli, "\u8c46\u5305", "\u5373\u68a6"]) {
    assert.equal(source.toLowerCase().includes(token), false, `obsolete provider wording remains in ${file}: ${token}`);
  }
}

console.log("obsolete provider removal rule passed");
