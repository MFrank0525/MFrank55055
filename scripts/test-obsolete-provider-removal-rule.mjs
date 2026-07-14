import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { findObsoleteProviderContradictions } from "./markdown-provider-contract.mjs";

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

const activeMarkdownFiles = tracked
  .split("\n")
  .filter(Boolean)
  .filter((file) => file.endsWith(".md"))
  .filter((file) => !file.startsWith("docs/superpowers/specs/"))
  .filter((file) => !file.startsWith("docs/superpowers/plans/"))
  .filter((file) => fs.existsSync(file));

for (const fixture of [
  "- 禁止自动重复提交付费任务。",
  "- 禁止主图 provider 切换。",
  "- The image provider must not be replaceable.",
  "- The image provider is non-replaceable.",
  "- The image provider is nonreplaceable.",
  "- The image provider is non-pluggable.",
  "- The image provider is nonpluggable.",
  "- The image provider is non-switchable.",
  "- The image provider is nonswitchable.",
  "- 禁止使用 query_result 或 fail_reason。",
  "- 严禁迁移历史付费账本。",
  "- 不得兼容旧付费账本。",
  "- Paid-image request must not auto replay after failure.",
  "- The image provider cannot use an alternate model.",
  "- 本地归档变量 imagePath 只用于记录文件路径。",
  '- Image request body uses {"metadata":{"size":"1024x1024"}}.',
  "- 付费账本不得支持从历史 runtime 导入。",
  "- Paid-image ledger must not support import from a historical runtime.",
  "- Image request must not use ImagePath.",
  "- 生图请求固定发送 metadata.size: 1024x1024。",
  "- The downloaded image path is /tmp/result.png.",
  "- Image input processing stores imagePath before normalization."
]) {
  assert.deepEqual(findObsoleteProviderContradictions(fixture), [], `valid rule item must remain allowed: ${fixture}`);
}
for (const [fixture, expectedLabel] of [
  ['- Paid-image request body: {"ImagePath":"/tmp/reference.png"}.', "legacy imagePath request field"],
  ['- 生图请求体 {"size":"1024x1024"}。', "legacy top-level size request field"],
  ["- Paid-image request body size=1024x1024.", "legacy top-level size request field"],
  ["- 主图节点支持更换 provider。", "replaceable paid-image provider wording"],
  ["- The main-image provider is switchable.", "replaceable paid-image provider wording"],
  ["- The image provider is pluggable.", "replaceable paid-image provider wording"],
  ["- The main-image provider supports changing implementations.", "replaceable paid-image provider wording"],
  ["- 自动重复提交付费任务，直到获得四张图。", "automatic repeated paid submission"],
  ['- 生图请求使用 {"mode":"edits"}。', "obsolete image-edit mode"],
  ["- Provider response writes Query_Result.", "legacy query_result artifact"],
  ["- Provider response writes Fail_Reason.", "legacy fail_reason artifact"],
  ["- 恢复流程支持迁移历史付费账本。", "historical paid-ledger migration instruction"],
  ["- 兼容旧付费账本。", "historical paid-ledger migration instruction"],
  ["- Supports legacy paid-image-ledger compatibility.", "historical paid-ledger migration instruction"],
  ["- 自动循环提交付费图片任务直到成功。", "automatic repeated paid submission"],
  ["- Paid-image request is automatically replayed after failure.", "automatic repeated paid submission"],
  ["- 主图允许使用另一 provider。", "replaceable paid-image provider wording"],
  ["- 主图可改用其他模型。", "replaceable paid-image provider wording"],
  ["- The image provider can use an alternate model.", "replaceable paid-image provider wording"],
  ["- Image request input uses imagePath for the reference image.", "legacy imagePath request field"],
  ['- Image request body uses {"size":"1024x1024"}.', "legacy top-level size request field"],
  ["- 主图 provider 可更换。", "replaceable paid-image provider wording"],
  ["- The image provider is interchangeable.", "replaceable paid-image provider wording"],
  ["- 付费账本支持从历史 runtime 导入。", "historical paid-ledger migration instruction"],
  ["- Paid-image ledger supports import from a historical runtime.", "historical paid-ledger migration instruction"],
  ["- Paid-image ledger import from historical runs is supported.", "historical paid-ledger migration instruction"],
  ["- Historical runs support importing the paid-image ledger.", "historical paid-ledger migration instruction"],
  ["- 付费任务失败后自动再次提交。", "automatic repeated paid submission"],
  ["- After failure, the paid-image task automatically submits again.", "automatic repeated paid submission"]
]) {
  assert.equal(
    findObsoleteProviderContradictions(fixture).some((finding) => finding.label === expectedLabel),
    true,
    `obsolete rule item must fail as ${expectedLabel}: ${fixture}`
  );
}
assert.equal(
  findObsoleteProviderContradictions("- 禁止主图 provider 切换；另一个主图 provider 支持更换。").some(
    (finding) => finding.label === "replaceable paid-image provider wording"
  ),
  true,
  "a prohibition in one clause must not mask a positive contradiction in another clause"
);
assert.equal(
  findObsoleteProviderContradictions("- Image request must not use imagePath and uses mode=edits.").some(
    (finding) => finding.label === "obsolete image-edit mode"
  ),
  true,
  "a negated imagePath predicate must not mask a positive edits-mode predicate"
);
assert.equal(
  findObsoleteProviderContradictions("- 主图 provider 不使用旧接口而支持更换 provider。").some(
    (finding) => finding.label === "replaceable paid-image provider wording"
  ),
  true,
  "a negated old-interface predicate must not mask positive provider replaceability"
);
assert.equal(
  findObsoleteProviderContradictions(
    "| 主图 provider 规则 |\n| --- |\n| 不得切换 |\n| 可替换 |"
  ).some((finding) => finding.label === "replaceable paid-image provider wording"),
  true,
  "a prohibited table row must not mask a separate replaceable-provider row"
);
assert.equal(
  findObsoleteProviderContradictions("- 禁止 query_result 且响应写入 query_result。").some(
    (finding) => finding.label === "legacy query_result artifact"
  ),
  true,
  "a negated first legacy artifact must not mask a later affirmative occurrence"
);
assert.equal(
  findObsoleteProviderContradictions("- 禁止 query_result / 响应写入 query_result。").some(
    (finding) => finding.label === "legacy query_result artifact"
  ),
  true,
  "all repeated predicate matches in one semantic subclause must be evaluated independently"
);
assert.equal(
  findObsoleteProviderContradictions("- 禁止主图 provider 切换且主图 provider 可替换。").some(
    (finding) => finding.label === "replaceable paid-image provider wording"
  ),
  true,
  "a negated first provider change must not mask a later affirmative occurrence"
);

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

for (const file of activeMarkdownFiles) {
  const source = fs.readFileSync(file, "utf8");
  const findings = findObsoleteProviderContradictions(source);
  assert.deepEqual(
    findings,
    [],
    `obsolete image-provider contract remains in ${file}: ${findings
      .map((finding) => `${finding.label} [${finding.clause}]`)
      .join("; ")}`
  );
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
