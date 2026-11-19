import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { applyMainImageFrame, prepareMainImageFrameLayoutReference } from "../dist/src/autolist/main-image-frame-action.js";
import { applyLocalWatermark } from "../dist/src/autolist/local-watermark.js";
import { DEFAULT_MAIN_IMAGE_FRAME_FILE, MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, shouldApplyDefaultMainImageFrame } from "../dist/src/autolist/main-image-frame-rules.js";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../dist/src/utils/platform.js";
import { buildAutoListingBusinessRuleFingerprint } from "../dist/src/autolist/business-rule-fingerprint.js";

assert.equal(shouldApplyDefaultMainImageFrame("延草纲目"), true);
assert.equal(shouldApplyDefaultMainImageFrame("宝元堂"), false);
assert.equal(shouldApplyDefaultMainImageFrame("延草纲目宝元堂"), false);
assert.equal(shouldApplyDefaultMainImageFrame("久光小泽"), false);
assert.throws(() => shouldApplyDefaultMainImageFrame(""), /requires Feishu brand/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /左上角/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /横向0%至63%/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /纵向0%至15%/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /唯一参考图已经把白底商品与最终固定品牌图框合成/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /右上角未被品牌条占用的区域可以继续用于/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /顶边必须位于画布纵向18%以下/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /禁止放大、横向延长、复制、仿制/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /禁止把整张海报缩成居中的小图/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /不会缩放、裁切或移动海报/);
assert.ok(fs.existsSync(DEFAULT_MAIN_IMAGE_FRAME_FILE));
const businessRuleFingerprintSource = fs.readFileSync("src/autolist/business-rule-fingerprint.ts", "utf8");
assert.match(businessRuleFingerprintSource, /MAIN_IMAGE_FRAME_LAYOUT_VERSION/);
assert.match(businessRuleFingerprintSource, /MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT/);
assert.match(buildAutoListingBusinessRuleFingerprint(), /^[a-f0-9]{24}$/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "main-image-frame-"));
const layoutReferenceFile = path.join(tempDir, "layout-reference.png");
await prepareMainImageFrameLayoutReference({
  sourceFile: path.resolve("input/fixed-main-images/辅助图02.png"),
  frameFile: DEFAULT_MAIN_IMAGE_FRAME_FILE,
  outputFile: layoutReferenceFile
});
const outputFile = path.join(tempDir, "framed.png");
await applyMainImageFrame({ inputFile: path.resolve("input/fixed-main-images/辅助图02.png"), frameFile: DEFAULT_MAIN_IMAGE_FRAME_FILE, outputFile });
const checkScript = [
  "from PIL import Image", "import sys", "frame=Image.open(sys.argv[1]).convert('RGBA')",
  "out=Image.open(sys.argv[2]).convert('RGBA')", "assert out.size == frame.size == (800,800)",
  "for f,o in zip(frame.getdata(),out.getdata()):", "    if f[3] == 255: assert f == o", "print('ok')"
].join("\n");
assert.equal(execFileSync(getPythonCommand(), ["-c", checkScript, DEFAULT_MAIN_IMAGE_FRAME_FILE, outputFile], {
  encoding: "utf8", env: sanitizePythonRuntimeEnv(process.env)
}).trim(), "ok");
const [watermarkedFile] = await applyLocalWatermark({
  inputFiles: [outputFile], outputDir: path.join(tempDir, "watermarked"),
  watermarkText: "测试店铺水印", protectedFrameFile: DEFAULT_MAIN_IMAGE_FRAME_FILE
});
assert.equal(execFileSync(getPythonCommand(), ["-c", checkScript, DEFAULT_MAIN_IMAGE_FRAME_FILE, watermarkedFile], {
  encoding: "utf8", env: sanitizePythonRuntimeEnv(process.env)
}).trim(), "ok");

const preservedInput = path.join(tempDir, "preserved-input.png");
fs.copyFileSync(path.resolve("input/fixed-main-images/辅助图02.png"), preservedInput);
await (await import("../dist/src/autolist/main-image-frame-action.js")).ensureMainImageFrameApplied(
  preservedInput,
  DEFAULT_MAIN_IMAGE_FRAME_FILE
);
assert.ok(fs.existsSync(`${preservedInput}.unframed.png`), "Framing must preserve the provider output for visual QA");
assert.ok(fs.existsSync(`${preservedInput}.frame-ready.png`), "Framing must preserve the deterministic safe-layout preview");
const frameMarker = JSON.parse(fs.readFileSync(`${preservedInput}.frame.json`, "utf8"));
assert.equal(frameMarker.layoutVersion, "full-bleed-layout-guide-v2");
assert.deepEqual(frameMarker.contentRect, { x: 0, y: 0, width: 800, height: 800 });
const fullBleedLayoutScript = [
  "from PIL import Image, ImageChops", "import sys",
  "source=Image.open(sys.argv[1]).convert('RGBA').resize((800,800), Image.Resampling.LANCZOS)",
  "ready=Image.open(sys.argv[2]).convert('RGBA')", "frame=Image.open(sys.argv[3]).convert('RGBA')",
  "guide=Image.open(sys.argv[4]).convert('RGBA')",
  "assert ImageChops.difference(source, ready).getbbox() is None",
  "assert ImageChops.difference(Image.alpha_composite(source,frame), guide).getbbox() is None",
  "print('full-bleed')"
].join("\n");
assert.equal(execFileSync(getPythonCommand(), ["-c", fullBleedLayoutScript, `${preservedInput}.unframed.png`, `${preservedInput}.frame-ready.png`, DEFAULT_MAIN_IMAGE_FRAME_FILE, layoutReferenceFile], {
  encoding: "utf8", env: sanitizePythonRuntimeEnv(process.env)
}).trim(), "full-bleed", "Provider output must remain full-size while its single reference visibly contains the fixed brand bar");

const legacyInput = path.join(tempDir, "legacy-safe-inset.png");
fs.copyFileSync(path.resolve("input/fixed-main-images/辅助图02.png"), legacyInput);
fs.copyFileSync(legacyInput, `${legacyInput}.unframed.png`);
fs.writeFileSync(`${legacyInput}.frame.json`, JSON.stringify({ layoutVersion: "safe-inset-v1" }));
await assert.rejects(
  () => (import("../dist/src/autolist/main-image-frame-action.js")).then(({ ensureMainImageFrameApplied }) =>
    ensureMainImageFrameApplied(legacyInput, DEFAULT_MAIN_IMAGE_FRAME_FILE)),
  /obsolete frame layout safe-inset-v1/,
  "Legacy shrink-layout outputs must never be silently reused by the full-bleed flow"
);

const providerSource = fs.readFileSync("src/autolist/main-image-provider-action.ts", "utf8");
assert.match(providerSource, /urls: \[sourceImageToDataUrl\(preparedReferenceImagePath\)\]/);
assert.doesNotMatch(providerSource, /additionalReferenceImagePaths/);
assert.doesNotMatch(
  providerSource,
  /ensureMainImageFrameApplied/,
  "Provider transport must persist the original paid result; framing belongs after download and square normalization"
);
const assetsSource = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
assert.doesNotMatch(assetsSource, /additionalReferenceImagePaths/);
assert.match(assetsSource, /ensureSquareMainImageFile[\s\S]*ensureMainImageFrameApplied\(result\.file, protectedFrameFile\)/);

const qualityTestSource = fs.readFileSync("src/cli/main-image-quality-test.ts", "utf8");
assert.match(qualityTestSource, /expectedImageCount: 1/);
assert.match(qualityTestSource, /referenceImageCount: 1/);
assert.match(qualityTestSource, /providerReferenceFile/);
assert.match(qualityTestSource, /publishAllowed: false/);
assert.doesNotMatch(qualityTestSource, /publishDistributedProducts|publish-from-spu|auto-listing:hermes-continue/);
