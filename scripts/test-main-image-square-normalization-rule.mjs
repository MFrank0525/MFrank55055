import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateMainImageSquareRule } from "../dist/src/autolist/main-image-shape-rules.js";
import { ensureSquareMainImageFile } from "../dist/src/autolist/main-image-square-action.js";
import { readImageDimensions } from "../dist/src/utils/image-dimensions.js";
import { getPythonCommand } from "../dist/src/utils/platform.js";

assert.deepEqual(evaluateMainImageSquareRule({ width: 1254, height: 1254 }), {
  action: "reuse",
  targetSide: 1254,
  issue: ""
});
assert.deepEqual(evaluateMainImageSquareRule({ width: 1199, height: 1312 }), {
  action: "pad_to_square",
  targetSide: 1312,
  issue: "Main image is not square: 1199x1312."
});
assert.throws(() => evaluateMainImageSquareRule({ width: 0, height: 10 }), /positive/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "main-image-square-"));
const sourceFile = path.join(tempDir, "generated-01.png");
const evidenceDir = path.join(tempDir, "provider-original");
execFileSync(getPythonCommand(), [
  "-c",
  "from PIL import Image; import sys; Image.new('RGB', (2, 3), (255, 0, 0)).save(sys.argv[1])",
  sourceFile
]);

const normalized = await ensureSquareMainImageFile({ sourceFile, evidenceDir });
assert.equal(normalized.changed, true);
assert.deepEqual(readImageDimensions(sourceFile), { width: 3, height: 3 });
assert.deepEqual(normalized.sourceDimensions, { width: 2, height: 3 });
assert.deepEqual(normalized.outputDimensions, { width: 3, height: 3 });
assert.ok(normalized.evidenceFile && fs.existsSync(normalized.evidenceFile));
assert.deepEqual(readImageDimensions(normalized.evidenceFile), { width: 2, height: 3 });

const reused = await ensureSquareMainImageFile({ sourceFile, evidenceDir });
assert.equal(reused.changed, false);
assert.deepEqual(reused.outputDimensions, { width: 3, height: 3 });

const mainImageAssetsSource = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
assert.match(
  mainImageAssetsSource,
  /recoverExistingRoundOutputs[\s\S]*ensureSquareMainImageFile/,
  "Recovered paid-image raw files must pass the same square normalization action before watermark reuse."
);
assert.match(
  mainImageAssetsSource,
  /generationResults[\s\S]*ensureSquareMainImageFile[\s\S]*applyLocalWatermark/,
  "New provider outputs must be square-normalized before watermarking."
);
assert.match(
  orchestratorSource,
  /repairMainImageArtifactShapes[\s\S]*assertMainImageCompletionGate[\s\S]*publishDistributedProducts/,
  "Every publish attempt, including a publish-stage resume, must repair legacy main-image shapes before the completion audit and browser mutation."
);

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("main image square normalization rules passed");
