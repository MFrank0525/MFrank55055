import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { applyMainImageFrame } from "../dist/src/autolist/main-image-frame-action.js";
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
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /横向0%–63%/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /纵向0%–15%/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /生成后覆盖一次真实品牌框/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /不得生成、模仿或延长品牌条/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /主标题顶边必须低于纵向18%/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /不得缩成小图/);
assert.match(MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT, /不会缩放、裁切或移动生成结果/);
assert.ok(fs.existsSync(DEFAULT_MAIN_IMAGE_FRAME_FILE));
assert.match(DEFAULT_MAIN_IMAGE_FRAME_FILE, /default-main-image-frame-v2\.png$/);
const originalFrameFile = path.resolve("assets/auto-listing/default-main-image-frame.png");
const cleanFrameScript = [
  "from PIL import Image, ImageChops", "import sys",
  "old=Image.open(sys.argv[1]).convert('RGBA')", "new=Image.open(sys.argv[2]).convert('RGBA')",
  "assert old.size == new.size == (800,800)",
  "assert ImageChops.difference(old.crop((0,0,430,90)),new.crop((0,0,430,90))).getbbox() is None",
  "assert all(new.getpixel((x,y))[3] == 0 for y in range(96,790) for x in range(10,790))",
  "assert any(old.getpixel((x,y))[3] > 0 for y in range(96,106) for x in range(10,440))",
  "print('clean-frame')"
].join("\n");
assert.equal(execFileSync(getPythonCommand(), ["-c", cleanFrameScript, originalFrameFile, DEFAULT_MAIN_IMAGE_FRAME_FILE], {
  encoding: "utf8", env: sanitizePythonRuntimeEnv(process.env)
}).trim(), "clean-frame");
const businessRuleFingerprintSource = fs.readFileSync("src/autolist/business-rule-fingerprint.ts", "utf8");
assert.match(businessRuleFingerprintSource, /MAIN_IMAGE_FRAME_LAYOUT_VERSION/);
assert.match(businessRuleFingerprintSource, /MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT/);
assert.match(buildAutoListingBusinessRuleFingerprint(), /^[a-f0-9]{24}$/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "main-image-frame-"));
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
assert.equal(frameMarker.layoutVersion, "post-compose-clean-frame-v3");
assert.deepEqual(frameMarker.contentRect, { x: 0, y: 0, width: 800, height: 800 });
const postComposeScript = [
  "from PIL import Image, ImageChops", "import sys",
  "source=Image.open(sys.argv[1]).convert('RGBA').resize((800,800), Image.Resampling.LANCZOS)",
  "ready=Image.open(sys.argv[2]).convert('RGBA')",
  "assert ImageChops.difference(source, ready).getbbox() is None",
  "print('post-compose')"
].join("\n");
assert.equal(execFileSync(getPythonCommand(), ["-c", postComposeScript, `${preservedInput}.unframed.png`, `${preservedInput}.frame-ready.png`], {
  encoding: "utf8", env: sanitizePythonRuntimeEnv(process.env)
}).trim(), "post-compose", "Provider output must remain unchanged before the clean frame is composed once");

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
assert.doesNotMatch(assetsSource, /prepareMainImageFrameLayoutReference/);
assert.match(assetsSource, /const providerSourceImagePath = options\.sourceImagePath/);
assert.match(assetsSource, /ensureSquareMainImageFile[\s\S]*ensureMainImageFrameApplied\(result\.file, protectedFrameFile\)/);

const qualityTestSource = fs.readFileSync("src/cli/main-image-quality-test.ts", "utf8");
assert.match(qualityTestSource, /expectedImageCount: 1/);
assert.match(qualityTestSource, /referenceImageCount: 1/);
assert.match(qualityTestSource, /const providerReferenceFile = sourceImagePath/);
assert.match(qualityTestSource, /publishAllowed: false/);
assert.doesNotMatch(qualityTestSource, /publishDistributedProducts|publish-from-spu|auto-listing:hermes-continue/);
