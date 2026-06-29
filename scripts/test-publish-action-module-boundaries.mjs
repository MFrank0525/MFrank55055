import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const requiredActionModules = [
  {
    file: "src/business/publish-from-spu/actions/shop-spu-action.ts",
    exports: ["runShopSpuAction"]
  },
  {
    file: "src/business/publish-from-spu/actions/basic-info-action.ts",
    exports: ["runBasicInfoAction"]
  },
  {
    file: "src/business/publish-from-spu/actions/graphic-info-action.ts",
    exports: ["runGraphicInfoAction"]
  },
  {
    file: "src/business/publish-from-spu/actions/spec-price-action.ts",
    exports: ["runSpecPriceAction"]
  },
  {
    file: "src/business/publish-from-spu/actions/service-action.ts",
    exports: ["runServiceAction"]
  },
  {
    file: "src/business/publish-from-spu/actions/submit-action.ts",
    exports: ["runSubmitAction"]
  }
];

for (const module of requiredActionModules) {
  assert.equal(fs.existsSync(module.file), true, `missing publish action module: ${module.file}`);
  const source = fs.readFileSync(module.file, "utf8");
  for (const exportName of module.exports) {
    assert.match(source, new RegExp(`export async function ${exportName}\\b`), `${module.file} must export ${exportName}`);
  }
  assert.doesNotMatch(source, /from "\.\.\/\.\.\/publish-from-spu\.js"/, `${module.file} must not import from the legacy aggregate module`);
}

function listTypeScriptFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

const publishModuleFiles = listTypeScriptFiles("src/business/publish-from-spu");
const publishModuleFileSet = new Set(publishModuleFiles.map((file) => path.normalize(file)));
const publishModuleImportGraph = new Map();

function resolvePublishModuleImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const resolved = path.normalize(path.join(path.dirname(fromFile), specifier.replace(/\.js$/, ".ts")));
  return publishModuleFileSet.has(resolved) ? resolved : null;
}

for (const file of publishModuleFiles) {
  const source = fs.readFileSync(file, "utf8");
  const relativeImports = Array.from(source.matchAll(/^\s*import(?:\s+type)?[\s\S]*?\sfrom\s+"([^"]+)";/gm))
    .map((match) => resolvePublishModuleImport(file, match[1]))
    .filter(Boolean);
  publishModuleImportGraph.set(path.normalize(file), relativeImports);

  if (file !== "src/business/publish-from-spu/publish-flow.ts") {
    assert.doesNotMatch(
      source,
      /from "\.\/actions\/[^"]+\.js"/,
      `${file} must not import action modules directly; module sequencing belongs in publish-flow.ts`
    );
  }
  if (file.includes("/actions/")) {
    assert.doesNotMatch(
      source,
      /from "\.\.\/publish-flow\.js"/,
      `${file} must not import publish-flow; orchestration depends on actions, not the reverse`
    );
  }
  if (/(?:^|\/)[^/]*rules[^/]*\.ts$/.test(file)) {
    assert.doesNotMatch(
      source,
      /from "\.\/(?:actions\/|publish-flow\.js|.*-action\.js|browser-session\.js)"/,
      `${file} must remain rule-only and must not import browser/action/orchestration modules`
    );
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];

function assertNoPublishModuleCycles(file) {
  if (visited.has(file)) {
    return;
  }
  if (visiting.has(file)) {
    const cycleStart = stack.indexOf(file);
    const cycle = [...stack.slice(cycleStart), file].join(" -> ");
    assert.fail(`publish module imports must be acyclic: ${cycle}`);
  }
  visiting.add(file);
  stack.push(file);
  for (const dependency of publishModuleImportGraph.get(file) || []) {
    assertNoPublishModuleCycles(dependency);
  }
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of publishModuleFileSet) {
  assertNoPublishModuleCycles(file);
}

const aggregateSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
const flowSource = fs.readFileSync("src/business/publish-from-spu/publish-flow.ts", "utf8");
const separationManual = fs.readFileSync("docs/auto-listing/publish-rule-action-separation.md", "utf8");
for (const exportName of requiredActionModules.flatMap((module) => module.exports)) {
  assert.match(
    flowSource,
    new RegExp(`${exportName}\\(`),
    `publish flow module must delegate to ${exportName}`
  );
}

assert.doesNotMatch(
  aggregateSource,
  /\b(?:async function|function)\b|page\.evaluate|querySelector|runShopSpuAction\(/,
  "publish-from-spu.ts must remain a thin export-only entrypoint"
);

assert.doesNotMatch(
  aggregateSource,
  /logInfo\(`publish module started: graphic_info/,
  "graphic-info action sequencing must live in the graphic action module, not the legacy aggregate file"
);
assert.doesNotMatch(
  aggregateSource,
  /logInfo\(`publish module started: service_fulfillment/,
  "service action sequencing must live in the service action module, not the legacy aggregate file"
);

const graphicFlowStart = flowSource.indexOf("export async function runGraphicFlow");
assert.notEqual(graphicFlowStart, -1, "publish flow module must expose runGraphicFlow");
const graphicFlowEnd = flowSource.indexOf("\nexport async function", graphicFlowStart + 1);
const graphicFlowSource = flowSource.slice(graphicFlowStart, graphicFlowEnd === -1 ? flowSource.length : graphicFlowEnd);
for (const action of ["runShopSpuAction", "runBasicInfoAction", "runGraphicInfoAction"]) {
  assert.match(graphicFlowSource, new RegExp(`${action}\\(`), `graphic-only flow must delegate to ${action}`);
}
assert.doesNotMatch(
  graphicFlowSource,
  /for \(let basicAttempt = 0; basicAttempt < 2; basicAttempt \+= 1\)/,
  "graphic-only flow must not keep a second copy of the basic-info retry loop"
);
assert.doesNotMatch(
  flowSource,
  /runShopSpuAction\(\s*\{\s*queryPlatformSpu,/,
  "publish flows must not inline shop/SPU dependency wiring; use the shop-spu action default deps"
);
assert.match(
  fs.readFileSync("src/business/publish-from-spu/actions/shop-spu-action.ts", "utf8"),
  /export function createDefaultShopSpuActionDeps/,
  "shop-spu action module must own the default shop/SPU browser dependency wiring"
);

assert.match(
  separationManual,
  /Publish orchestration: `src\/business\/publish-from-spu\/publish-flow\.ts`/,
  "rule/action separation doc must name publish-flow.ts as the orchestration layer"
);
assert.match(
  separationManual,
  /Module action implementations: `src\/business\/publish-from-spu\/actions\/\*\.ts`/,
  "rule/action separation doc must name actions/*.ts as the module action layer"
);
assert.doesNotMatch(
  separationManual,
  /Extract generic Doudian browser action groups out of `src\/business\/publish-from-spu\.ts`/,
  "rule/action separation doc must not list completed action-module extraction as remaining backlog"
);

console.log("publish action module boundaries passed");
