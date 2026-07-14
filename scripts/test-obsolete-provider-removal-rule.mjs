import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" });
const removedChatProvider = ["dou", "bao"].join("");
const removedImageModule = ["ji", "meng"].join("");
const removedImageCli = ["dream", "ina"].join("");
const excludedRootDirs = new Set([".git", ".codegraph", "data", "node_modules"]);
const obsoleteProviderTokens = [
  ["media", "generate"].join("-"),
  ["/images", "edits"].join("/"),
  ["/v1/media", "generate"].join("/"),
  ["tmp", "files.org"].join(""),
  ["b64", "_json"].join(""),
  ["response", "Format"].join(""),
  ["response", "_format"].join("")
];

function listOperationalPaths(dir = ".", relativeDir = "") {
  const paths = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!relativeDir && excludedRootDirs.has(entry.name)) {
      continue;
    }
    if (entry.name === "node_modules") {
      continue;
    }
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    paths.push(relativePath);
    if (entry.isDirectory()) {
      for (const childPath of listOperationalPaths(`${dir}/${entry.name}`, relativePath)) {
        paths.push(childPath);
      }
    }
  }
  return paths;
}

for (const filePath of listOperationalPaths()) {
  const normalizedPath = filePath.toLowerCase();
  for (const token of [removedChatProvider, removedImageModule, removedImageCli]) {
    assert.equal(normalizedPath.includes(token), false, `obsolete provider path remains: ${filePath}`);
  }
}

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

const activeProviderFiles = [
  ...tracked
    .split("\n")
    .filter(Boolean)
    .filter((file) =>
      file === "README.md" ||
      file === "README.ai.md" ||
      file === "package.json" ||
      file.startsWith("src/") ||
      file.startsWith("input/") ||
      file.startsWith("schemas/") ||
      file.startsWith("docs/auto-listing/")
    )
    .filter((file) => !file.endsWith("image-generation.config.json"))
    .filter((file) => fs.existsSync(file))
];

for (const file of activeProviderFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const token of obsoleteProviderTokens) {
    assert.equal(source.includes(token), false, `obsolete image-provider path remains in ${file}: ${token}`);
  }
  if (file.endsWith(".ts") || file.endsWith(".json")) {
    const obsoleteModeLiteral = ["gener", "ations"].join("");
    assert.equal(
      source.includes(`\"${obsoleteModeLiteral}\"`),
      false,
      `obsolete synchronous image mode remains in ${file}: ${obsoleteModeLiteral}`
    );
  }
}

for (const obsoleteExample of [
  "input/image-generation.config.example.json",
  ["input/image-generation.config.", "media", "generate.example.json"].join("").replace("mediagenerate", "media-generate")
]) {
  assert.equal(fs.existsSync(obsoleteExample), false, `obsolete image-provider example remains: ${obsoleteExample}`);
}

const paidLedgerSource = fs.readFileSync("src/autolist/paid-image-submission-ledger.ts", "utf8");
const mainImageSource = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
for (const source of [paidLedgerSource, mainImageSource]) {
  assert.equal(
    source.includes("migrateLegacyPaidImageProductLedgers"),
    false,
    "paid-image recovery must use only the centralized ledger, never historical runtime ledgers"
  );
}
assert.equal(
  mainImageSource.includes('path.dirname(options.paidImageLedger.rootDir), "runs"'),
  false,
  "image generation must not scan previous run directories for billing state"
);

const operationalFiles = [
  ".gitignore",
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

execFileSync(process.execPath, ["scripts/test-build-output-cleanup-rule.mjs"], { stdio: "inherit" });

console.log("obsolete provider removal rule passed");
