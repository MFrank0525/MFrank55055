import assert from "node:assert/strict";
import fs from "node:fs";

const publishSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");

function sliceFunction(name) {
  const start = publishSource.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `function not found: ${name}`);
  const next = publishSource.indexOf("\nasync function ", start + 1);
  return publishSource.slice(start, next === -1 ? publishSource.length : next);
}

const basicGateSource = sliceFunction("assertBasicPublishCompletionOnPage");
assert.equal(
  basicGateSource.includes("ensurePublishSectionTab"),
  false,
  "basic-info readback gates must be read-only and must not switch the active publish tab"
);

const finalGraphicVerifierSource = sliceFunction("verifyForbiddenGraphicSectionsEmptyOnPage");
assert.equal(
  finalGraphicVerifierSource.includes("ensurePublishSectionTab"),
  false,
  "final forbidden graphic verification must not switch back to the graphic module"
);
assert.equal(
  finalGraphicVerifierSource.includes("purgeForbiddenGraphicSectionsStrict"),
  false,
  "final forbidden graphic verification must not repair a previous module after the flow has moved on"
);

const afterMedicalStart = publishSource.indexOf('stages.push({ step: "apply_medical_device_certificate", status: "completed" });');
const publishClickStart = publishSource.indexOf("const publishResult = await clickPublishProductOnPage", afterMedicalStart);
assert.notEqual(afterMedicalStart, -1, "medical certificate stage not found");
assert.notEqual(publishClickStart, -1, "publish click stage not found");
const afterMedicalBeforeSubmit = publishSource.slice(afterMedicalStart, publishClickStart);
assert.equal(
  afterMedicalBeforeSubmit.includes("enforceForbiddenGraphicSectionsEmpty("),
  false,
  "after leaving the graphic module, publish flow must not jump back to repair forbidden graphic sections"
);
assert.match(
  afterMedicalBeforeSubmit,
  /verifyForbiddenGraphicSectionsEmptyOnPage/,
  "after leaving the graphic module, final graphic checks must be read-only verification"
);

console.log("publish module sequence rule passed");
