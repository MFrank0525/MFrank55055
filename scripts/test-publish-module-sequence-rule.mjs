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

const titleInputFinderSource = sliceFunction("findTitleInputCenter");
const shortTitleInputFinderSource = sliceFunction("findShortTitleInputCenter");
const basicInputFinderSource = sliceFunction("findBasicInputCenterByFieldId");
assert.doesNotMatch(
  basicInputFinderSource,
  /let fields = collectFields\(root \|\| document\)/,
  "missing attr-field-id must not fall back to an arbitrary page input before the matching field label is found"
);
assert.match(
  titleInputFinderSource,
  /findBasicInputCenterByFieldId\(page, "\\u5546\\u54c1\\u6807\\u9898"/,
  "title input finder must use attr-field-id instead of fragile placeholder/type checks"
);
assert.match(
  shortTitleInputFinderSource,
  /findBasicInputCenterByFieldId\(page, "\\u5bfc\\u8d2d\\u77ed\\u6807\\u9898"/,
  "short-title input finder must use attr-field-id instead of fragile placeholder/type checks"
);
assert.doesNotMatch(
  shortTitleInputFinderSource,
  /getAttribute\("type"\)/,
  "short-title input finder must not require an explicit type=text attribute; HTML text inputs may omit type"
);

const publishFlowSource = sliceFunction("runPublishFlow");
const publishBasicLoop = publishFlowSource.indexOf("for (let basicAttempt = 0; basicAttempt < 2; basicAttempt += 1)");
assert.match(
  publishFlowSource.slice(0, publishBasicLoop),
  /let page = await reuseOrOpenCreatePage\(context, createPageUrl\)/,
  "publish flow must reuse the create page opened by the platform SPU publish action"
);
assert.notEqual(publishBasicLoop, -1, "publish flow basic-info retry loop not found");
const publishBasicFirstAttemptWindow = publishFlowSource.slice(
  publishBasicLoop,
  publishFlowSource.indexOf("const fillResult = await fillBasicPublishPageOnPage", publishBasicLoop)
);
assert.doesNotMatch(
  publishBasicFirstAttemptWindow,
  /for \(let basicAttempt = 0; basicAttempt < 2; basicAttempt \+= 1\) \{\s*await gotoWithTolerance\(page, createPageUrl, 3500\);/,
  "publish flow must reuse the already-ready create page on the first basic-info attempt instead of immediately reloading it"
);
assert.match(
  publishBasicFirstAttemptWindow,
  /if \(basicAttempt > 0\)[\s\S]*reuseOrOpenCreatePage\(context, createPageUrl, page\)/,
  "publish flow must reuse a newly SPU-opened create page on an explicit basic-info retry"
);
assert.match(
  publishBasicFirstAttemptWindow,
  /waitForPublishCreatePageReady\([\s\S]*allowPageNavigationRecovery: basicAttempt > 0[\s\S]*\)/,
  "publish flow must not let the first basic-info readiness check reload the already-ready create page"
);
const publishBasicCatchWindow = publishFlowSource.slice(
  publishFlowSource.indexOf("} catch (error) {", publishBasicLoop),
  publishFlowSource.indexOf("if (!basicInfoCompleted)", publishBasicLoop)
);
assert.match(
  publishBasicCatchWindow,
  /PublishCreatePageReopenRequiredError[\s\S]*queryPlatformSpu/,
  "publish flow must reopen an incomplete SPU-prefilled page from the platform SPU row"
);

const graphicFlowSource = sliceFunction("runGraphicFlow");
const graphicBasicLoop = graphicFlowSource.indexOf("for (let basicAttempt = 0; basicAttempt < 2; basicAttempt += 1)");
assert.match(
  graphicFlowSource.slice(0, graphicBasicLoop),
  /let page = await reuseOrOpenCreatePage\(context, createPageUrl\)/,
  "graphic flow must reuse the create page opened by the platform SPU publish action"
);
assert.notEqual(graphicBasicLoop, -1, "graphic flow basic-info retry loop not found");
const graphicBasicFirstAttemptWindow = graphicFlowSource.slice(
  graphicBasicLoop,
  graphicFlowSource.indexOf("const fillResult = await fillBasicPublishPageOnPage", graphicBasicLoop)
);
assert.doesNotMatch(
  graphicBasicFirstAttemptWindow,
  /for \(let basicAttempt = 0; basicAttempt < 2; basicAttempt \+= 1\) \{\s*await gotoWithTolerance\(page, createPageUrl, 3500\);/,
  "graphic flow must reuse the already-ready create page on the first basic-info attempt instead of immediately reloading it"
);
assert.match(
  graphicBasicFirstAttemptWindow,
  /if \(basicAttempt > 0\)[\s\S]*reuseOrOpenCreatePage\(context, createPageUrl, page\)/,
  "graphic flow must reuse a newly SPU-opened create page on an explicit basic-info retry"
);
assert.match(
  graphicBasicFirstAttemptWindow,
  /waitForPublishCreatePageReady\([\s\S]*allowPageNavigationRecovery: basicAttempt > 0[\s\S]*\)/,
  "graphic flow must not let the first basic-info readiness check reload the already-ready create page"
);
const graphicBasicCatchWindow = graphicFlowSource.slice(
  graphicFlowSource.indexOf("} catch (error) {", graphicBasicLoop),
  graphicFlowSource.indexOf("if (!basicInfoCompleted)", graphicBasicLoop)
);
assert.match(
  graphicBasicCatchWindow,
  /PublishCreatePageReopenRequiredError[\s\S]*queryPlatformSpu/,
  "graphic flow must reopen an incomplete SPU-prefilled page from the platform SPU row"
);

assert.match(
  publishSource,
  /resetGraphicModuleOnPage/,
  "graphic upload failures must first reset the current graphic module instead of reopening from platform SPU"
);
for (const marker of [
  'resetGraphicModuleOnPage(page, runtimeDir, "publish-page-graphic-module-reset-before-retry.png")'
]) {
  const resetStart = publishSource.indexOf(marker);
  assert.notEqual(resetStart, -1, `graphic reset call not found: ${marker}`);
  const resetWindow = publishSource.slice(Math.max(0, resetStart - 700), resetStart);
  assert.match(
    resetWindow,
    /waitForPublishCreatePageReady/,
    "graphic upload failure recovery must check/reload publish-page health before resetting the graphic module"
  );
}
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
