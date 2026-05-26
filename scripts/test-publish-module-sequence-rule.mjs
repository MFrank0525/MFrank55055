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

assert.equal(
  publishSource.includes("clickSmartCropForMain34Section"),
  false,
  "publisher must not retain a 3:4 smart-crop helper; current rules forbid touching 主图3:4"
);
assert.equal(
  publishSource.includes("uploadMissingMain34ImagesToSection"),
  false,
  "publisher must not retain a helper that uploads images into 主图3:4"
);
assert.match(
  publishSource,
  /resetGraphicModuleOnPage/,
  "graphic upload failures must first reset the current graphic module instead of reopening from platform SPU"
);
const deleteControlFinderSource = sliceFunction("findDeleteControlNearPreviewSafe");
assert.match(
  deleteControlFinderSource,
  /shanchu/,
  "Doudian thumbnail delete controls use SVG #icon-shanchu and must be recognized"
);
assert.match(
  deleteControlFinderSource,
  /target\.height - 30/,
  "thumbnail delete controls may sit inside the preview bottom edge and must be included in the search range"
);

const afterMedicalStart = publishSource.indexOf('stages.push({ step: "apply_medical_device_certificate", status: "completed" });');
const publishClickStart = publishSource.indexOf("const publishResult = await clickPublishProductOnPage", afterMedicalStart);
assert.notEqual(afterMedicalStart, -1, "medical certificate stage not found");
assert.notEqual(publishClickStart, -1, "publish click stage not found");
const afterMedicalBeforeSubmit = publishSource.slice(afterMedicalStart, publishClickStart);
assert.match(
  afterMedicalBeforeSubmit,
  /verifyForbiddenGraphicSectionsEmptyOnPage/,
  "after leaving the graphic module, final graphic checks must be read-only verification"
);
assert.match(
  afterMedicalBeforeSubmit,
  /repairForbiddenGraphicSectionsBeforePublish/,
  "publish-blocking white-background or 3:4 auto-fill must trigger a controlled final repair before submitting"
);
assert.match(
  afterMedicalBeforeSubmit,
  /pre_publish_forbidden_graphic_repair/,
  "pre-publish forbidden graphic repair must be tracked as its own stage"
);
assert.match(
  afterMedicalBeforeSubmit,
  /final_forbidden_graphic_repair/,
  "final forbidden graphic repair must be tracked separately from ordinary module sequencing"
);

console.log("publish module sequence rule passed");
