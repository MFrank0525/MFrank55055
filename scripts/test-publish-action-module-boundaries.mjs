import assert from "node:assert/strict";
import fs from "node:fs";

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

const aggregateSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
for (const exportName of requiredActionModules.flatMap((module) => module.exports)) {
  assert.match(
    aggregateSource,
    new RegExp(`${exportName}\\(`),
    `legacy aggregate publish flow must delegate to ${exportName}`
  );
}

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

const graphicFlowStart = aggregateSource.indexOf("async function runGraphicFlow");
assert.notEqual(graphicFlowStart, -1, "legacy aggregate graphic flow must still expose runGraphicFlow");
const graphicFlowEnd = aggregateSource.indexOf("\nexport async function runPublishFromSpuJob", graphicFlowStart);
const graphicFlowSource = aggregateSource.slice(graphicFlowStart, graphicFlowEnd === -1 ? aggregateSource.length : graphicFlowEnd);
for (const action of ["runShopSpuAction", "runBasicInfoAction", "runGraphicInfoAction"]) {
  assert.match(graphicFlowSource, new RegExp(`${action}\\(`), `graphic-only flow must delegate to ${action}`);
}
assert.doesNotMatch(
  graphicFlowSource,
  /for \(let basicAttempt = 0; basicAttempt < 2; basicAttempt \+= 1\)/,
  "graphic-only flow must not keep a second copy of the basic-info retry loop"
);
assert.doesNotMatch(
  aggregateSource,
  /runShopSpuAction\(\s*\{\s*queryPlatformSpu,/,
  "legacy aggregate publish flows must not inline shop/SPU dependency wiring; use the shop-spu action default deps"
);
assert.match(
  fs.readFileSync("src/business/publish-from-spu/actions/shop-spu-action.ts", "utf8"),
  /export function createDefaultShopSpuActionDeps/,
  "shop-spu action module must own the default shop/SPU browser dependency wiring"
);

console.log("publish action module boundaries passed");
