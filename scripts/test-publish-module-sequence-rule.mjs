import assert from "node:assert/strict";
import fs from "node:fs";

const publishEntrySource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
const publishImplementationFiles = [
  "src/business/publish-from-spu/basic-info-page-action.ts",
  "src/business/publish-from-spu/spec-service-page-action.ts",
  "src/business/publish-from-spu/service-fulfillment-page-action.ts",
  "src/business/publish-from-spu/graphic-file-input-action.ts",
  "src/business/publish-from-spu/graphic-section-preview-action.ts",
  "src/business/publish-from-spu/graphic-upload-page-action.ts",
  "src/business/publish-from-spu/publish-submit-page-action.ts",
  "src/business/publish-from-spu/publish-flow.ts",
  "src/business/publish-from-spu/job.ts"
];
const publishSource = [publishEntrySource, ...publishImplementationFiles.map((file) => fs.readFileSync(file, "utf8"))].join("\n");
const actionSources = [
  "src/business/publish-from-spu/actions/shop-spu-action.ts",
  "src/business/publish-from-spu/actions/basic-info-action.ts",
  "src/business/publish-from-spu/actions/graphic-info-action.ts",
  "src/business/publish-from-spu/actions/spec-price-action.ts",
  "src/business/publish-from-spu/actions/service-action.ts",
  "src/business/publish-from-spu/actions/submit-action.ts"
].map((file) => fs.readFileSync(file, "utf8"));
const publishActionSource = [publishSource, ...actionSources].join("\n");
const autolistPublishSource = fs.readFileSync("src/autolist/publish.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

function sliceFunction(name, source = publishSource) {
  const start = Math.max(source.indexOf(`async function ${name}`), source.indexOf(`export async function ${name}`));
  assert.notEqual(start, -1, `function not found: ${name}`);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const nextExportAsync = source.indexOf("\nexport async function ", start + 1);
  const nextCandidates = [nextAsync, nextExportAsync].filter((index) => index !== -1);
  const next = nextCandidates.length ? Math.min(...nextCandidates) : -1;
  return source.slice(start, next === -1 ? source.length : next);
}

const basicGateSource = sliceFunction("assertBasicPublishCompletionOnPage");
assert.equal(
  basicGateSource.includes("ensurePublishSectionTab"),
  false,
  "basic-info readback gates must be read-only and must not switch the active publish tab"
);
assert.match(
  basicGateSource,
  /evaluateBasicInfoGateRecovery[\s\S]*PublishCreatePageReopenRequiredError/,
  "basic-info readback must reopen the SPU-prefilled page when all expected fields disappear together"
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

const basicFieldAvailableSource = sliceFunction("isBasicPublishFieldAvailable");
const basicFieldSetterSource = sliceFunction("setBasicPublishFieldValue");
assert.match(
  publishSource,
  /resolveBasicFieldIdAliases/,
  "basic-info field lookup must use rule-layer aliases for Doudian label variants"
);
assert.doesNotMatch(
  basicFieldAvailableSource + basicFieldSetterSource,
  /let fields = collectFields\(root \|\| document\)/,
  "missing attr-field-id must not fall back to an arbitrary page input before the matching field label is found"
);
assert.match(
  basicFieldSetterSource,
  /field: "title" \| "shortTitle" \| "modelSpec"[\s\S]*resolveBasicFieldIdAliases\(field\)/,
  "basic-info field setter must use rule-layer field aliases instead of fragile placeholder/type checks"
);
assert.match(
  basicFieldAvailableSource,
  /field: "title" \| "shortTitle" \| "modelSpec"[\s\S]*resolveBasicFieldIdAliases\(field\)/,
  "basic-info field availability check must use rule-layer aliases instead of one exact label"
);
assert.doesNotMatch(
  basicFieldAvailableSource,
  /getAttribute\("type"\)/,
  "short-title availability check must not require an explicit type=text attribute; HTML text inputs may omit type"
);

const publishFlowSource = sliceFunction("runPublishFlow");
for (const action of [
  "runShopSpuAction",
  "runBasicInfoAction",
  "runGraphicInfoAction",
  "runSpecPriceAction",
  "runServiceAction",
  "runSubmitAction"
]) {
  assert.match(publishFlowSource, new RegExp(`${action}\\(`), `publish flow must delegate to ${action}`);
}

const basicActionSource = sliceFunction("runBasicInfoAction", actionSources.join("\n"));
const publishBasicLoop = basicActionSource.indexOf("for (let basicAttempt = 0; basicAttempt < 2; basicAttempt += 1)");
assert.match(
  publishFlowSource,
  /runShopSpuAction\([\s\S]*reuseOrOpenCreatePage/,
  "publish flow must reuse the create page opened by the platform SPU publish action"
);
assert.notEqual(publishBasicLoop, -1, "publish flow basic-info retry loop not found");
const publishBasicFirstAttemptWindow = basicActionSource.slice(
  publishBasicLoop,
  basicActionSource.indexOf("const fillResult = await deps.fillBasicPublishPageOnPage", publishBasicLoop)
);
assert.doesNotMatch(
  publishBasicFirstAttemptWindow,
  /for \(let basicAttempt = 0; basicAttempt < 2; basicAttempt \+= 1\) \{\s*await gotoWithTolerance\(page, createPageUrl, 3500\);/,
  "publish flow must reuse the already-ready create page on the first basic-info attempt instead of immediately reloading it"
);
assert.match(
  publishBasicFirstAttemptWindow,
  /if \(basicAttempt > 0\)[\s\S]*reuseOrOpenCreatePage\(page\.context\(\), createPageUrl, page\)/,
  "publish flow must reuse a newly SPU-opened create page on an explicit basic-info retry"
);
assert.match(
  publishBasicFirstAttemptWindow,
  /waitForPublishCreatePageReady\([\s\S]*allowPageNavigationRecovery: basicAttempt > 0[\s\S]*\)/,
  "publish flow must not let the first basic-info readiness check reload the already-ready create page"
);
assert.match(
  basicActionSource,
  /input\.emitProgress\("basic_info_attempt"[\s\S]*basicAttempt \+ 1/,
  "basic-info attempts must emit progress heartbeats so Hermes watchdog does not kill a live Doudian recovery"
);
assert.match(
  autolistPublishSource,
  /runPublishFromSpuJob\([\s\S]*onProgress[\s\S]*upsertPublishManifestEntry[\s\S]*options\.onProgress/,
  "publish-from-spu internal heartbeats must update publish manifest and outer task progress"
);
assert.match(
  autolistPublishSource,
  /buildPublishJobMetadata[\s\S]*feishuRecordId:\s*targetIdentity\.recordId[\s\S]*productCategory:\s*feishuProductRecord\.productCategory/,
  "auto-listing publish must build Doudian metadata from canonical target identity plus the current Feishu productCategory"
);
assert.match(
  autolistPublishSource,
  /const metadata = metadataByTargetKey\.get\(targetKey\)[\s\S]*runPublishFromSpuJob\([\s\S]*metadata,/,
  "auto-listing publish must pass the fully built Feishu metadata into Doudian publish jobs"
);
const publishBasicCatchWindow = basicActionSource.slice(
  basicActionSource.indexOf("} catch (error) {", publishBasicLoop),
  basicActionSource.indexOf("if (!basicInfoCompleted)", publishBasicLoop)
);
assert.match(
  publishBasicCatchWindow,
  /isPublishCreatePageReopenRequiredError[\s\S]*queryPlatformSpu/,
  "publish flow must reopen an incomplete SPU-prefilled page from the platform SPU row"
);

const graphicFlowSource = sliceFunction("runGraphicFlow");
for (const action of ["runShopSpuAction", "runBasicInfoAction", "runGraphicInfoAction"]) {
  assert.match(graphicFlowSource, new RegExp(`${action}\\(`), `graphic flow must delegate to ${action}`);
}
assert.doesNotMatch(
  graphicFlowSource,
  /for \(let basicAttempt = 0; basicAttempt < 2; basicAttempt \+= 1\)/,
  "graphic flow must not keep a second copy of the basic-info retry loop"
);
assert.match(
  graphicFlowSource,
  /runBasicInfoAction\([\s\S]*failurePrefix: "Graphic flow stopped"/,
  "graphic flow must preserve graphic-flow failure wording through the shared basic-info action"
);

assert.match(
  publishActionSource,
  /resetGraphicModuleOnPage/,
  "graphic upload failures must first reset the current graphic module instead of reopening from platform SPU"
);
for (const marker of [
  'resetGraphicModuleOnPage(input.page, input.runtimeDir, "publish-page-graphic-module-reset-before-retry.png")'
]) {
  const resetStart = publishActionSource.indexOf(marker);
  assert.notEqual(resetStart, -1, `graphic reset call not found: ${marker}`);
  const resetWindow = publishActionSource.slice(Math.max(0, resetStart - 700), resetStart);
  assert.match(
    resetWindow,
    /waitForPublishCreatePageReady/,
    "graphic upload failure recovery must check/reload publish-page health before resetting the graphic module"
  );
}
const deleteControlFinderSource = sliceFunction("clickLastGraphicSectionPreviewDeleteByDom");
assert.match(
  deleteControlFinderSource,
  /shanchu/,
  "Doudian thumbnail delete controls use SVG #icon-shanchu and must be recognized"
);
assert.match(
  deleteControlFinderSource,
  /previewRoot\.contains\(node\)[\s\S]*nearPreview/,
  "thumbnail delete controls must be selected from the preview DOM/container range instead of viewport coordinates"
);
assert.doesNotMatch(
  fs.readFileSync("src/business/publish-from-spu/constants.ts", "utf8"),
  /FORBIDDEN_GRAPHIC_SECTION_LABELS/,
  "the obsolete forbidden-section constant must be deleted instead of retained as an empty compatibility marker"
);
assert.match(
  fs.readFileSync("src/business/publish-from-spu/publish-rules.ts", "utf8"),
  /OPTIONAL_GRAPHIC_SECTIONS_ARE_OUTSIDE_PUBLISH_FLOW\s*=\s*true/,
  "the rule layer must explicitly declare that white-background and 3:4 slots are outside the publish flow"
);
assert.match(
  publishActionSource,
  /OPTIONAL_GRAPHIC_SECTIONS_ARE_OUTSIDE_PUBLISH_FLOW/,
  "the publisher action layer must consume the optional-graphic-section policy from the rule layer"
);
assert.doesNotMatch(
  publishActionSource,
  /publish-page-forbidden-graphic-sections-before-main-upload/,
  "graphic upload must not inspect or clear stale white-background/3:4 slots before uploading main images"
);
assert.doesNotMatch(
  publishActionSource,
  /Forbidden optional graphic sections still contain images/,
  "white-background/3:4 auto-fill must never become a project-blocking publish error"
);

const afterMedicalStart = publishActionSource.indexOf('stages.push({ step: "apply_medical_device_certificate", status: "completed" });');
const publishClickStart = publishActionSource.indexOf("const publishResult = await deps.clickPublishProductOnPage", afterMedicalStart);
assert.notEqual(afterMedicalStart, -1, "medical certificate stage not found");
assert.notEqual(publishClickStart, -1, "publish click stage not found");
const afterMedicalBeforeSubmit = publishActionSource.slice(afterMedicalStart, publishClickStart);
assert.doesNotMatch(
  afterMedicalBeforeSubmit,
  /verifyForbiddenGraphicSectionsEmptyOnPage/,
  "after leaving the graphic module, publish flow must not check white-background/3:4 slots"
);
assert.doesNotMatch(
  afterMedicalBeforeSubmit,
  /repairForbiddenGraphicSectionsBeforePublish/,
  "publish flow must not repair white-background/3:4 slots before submitting"
);
assert.doesNotMatch(
  publishSource,
  /async function (?:enforceForbiddenGraphicSectionsEmpty|verifyForbiddenGraphicSectionsEmptyOnPage|repairForbiddenGraphicSectionsBeforePublish|clearWhiteBackgroundPreviewsStrict)/,
  "publisher must not retain white-background/3:4 cleanup helpers"
);

assert.match(
  publishSource,
  /prepareQualificationImagesForUpload\(\{[\s\S]*files: classifiedAssets\.detailImages[\s\S]*outputDir: path\.join\(runtimeDir, "qualification-images-normalized"\)/,
  "publish jobs must prepare qualification images in the current runtime before upload"
);
assert.match(
  publishSource,
  /detailImages: preparedQualificationImages\.files/,
  "only prepared qualification paths may populate the in-memory detail image upload set"
);
assert.doesNotMatch(
  publishSource,
  /fs\.(?:copyFileSync|renameSync)\([^\n]*detailImages/,
  "publish preparation must not overwrite or rename distributed qualification evidence"
);
const runJobStart = publishSource.indexOf("export async function runPublishFromSpuJob");
const prepareQualificationIndex = publishSource.indexOf("await prepareQualificationImagesForUpload", runJobStart);
const firstBrowserModeIndex = publishSource.indexOf('if (mode === "open_platform_spu")', runJobStart);
assert.ok(
  prepareQualificationIndex > runJobStart && prepareQualificationIndex < firstBrowserModeIndex,
  "qualification image preparation must finish before the first publish browser mode begins"
);
assert.match(
  packageJson.scripts["rules:check"],
  /node scripts\/test-qualification-image-normalization-rule\.mjs/,
  "the qualification dimension regression must be part of the full rule closure"
);

console.log("publish module sequence rule passed");
