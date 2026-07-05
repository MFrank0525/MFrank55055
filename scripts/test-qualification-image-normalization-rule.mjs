import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let rules;
try {
  rules = await import("../dist/src/business/publish-from-spu/qualification-image-rules.js");
} catch {
  rules = undefined;
}

assert.ok(rules, "qualification image dimension rules must exist");

const {
  resolveQualificationImageResize,
  verifyNormalizedQualificationImage
} = rules;

assert.deepEqual(
  resolveQualificationImageResize({ width: 5534, height: 4141 }),
  { action: "resize", targetWidth: 1900, targetHeight: 1421 }
);
assert.deepEqual(
  resolveQualificationImageResize({ width: 1655, height: 2338 }),
  { action: "resize", targetWidth: 1344, targetHeight: 1900 }
);
assert.deepEqual(
  resolveQualificationImageResize({ width: 5000, height: 3200 }),
  { action: "resize", targetWidth: 1900, targetHeight: 1216 }
);
assert.deepEqual(
  resolveQualificationImageResize({ width: 1721, height: 2435 }),
  { action: "resize", targetWidth: 1342, targetHeight: 1900 },
  "medical-device certificate images above the platform <2000px height limit must be normalized before upload"
);
assert.throws(
  () => resolveQualificationImageResize({ width: 0, height: 4141 }),
  /invalid qualification image dimensions/i
);
assert.deepEqual(
  verifyNormalizedQualificationImage({ width: 1900, height: 1421, targetWidth: 1900, targetHeight: 1421 }),
  { passed: true, issue: "" }
);
assert.match(
  verifyNormalizedQualificationImage({ width: 2000, height: 1421, targetWidth: 1900, targetHeight: 1421 }).issue,
  /exceeded target dimensions/i
);
assert.match(
  verifyNormalizedQualificationImage({ width: 1900, height: 1420, targetWidth: 1900, targetHeight: 1421 }).issue,
  /did not match requested dimensions/i
);

let normalizer;
try {
  normalizer = await import("../dist/src/business/publish-from-spu/qualification-image-normalizer.js");
} catch {
  normalizer = undefined;
}
assert.ok(normalizer, "qualification image normalization action must exist");

const hashFile = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qualification-image-normalization-"));
try {
  const oversizedPng = path.join(tempDir, "oversized.png");
  const oversizedJpeg = path.join(tempDir, "oversized.jpg");
  const compliantPng = path.join(tempDir, "compliant.png");
  const corruptPng = path.join(tempDir, "corrupt.png");
  const fixtureScript = [
    "from PIL import Image",
    `Image.new('RGB', (5534, 4141), (220, 230, 240)).save(${JSON.stringify(oversizedPng)})`,
    `Image.new('RGB', (5200, 2600), (230, 220, 210)).save(${JSON.stringify(oversizedJpeg)}, quality=90)`,
    `Image.new('RGB', (1655, 2338), (210, 230, 220)).save(${JSON.stringify(compliantPng)})`
  ].join("\n");
  execFileSync(process.env.PYTHON_BIN || "/usr/bin/python3", ["-c", fixtureScript]);
  fs.writeFileSync(corruptPng, "not an image");

  const sourceHashes = new Map(
    [oversizedPng, oversizedJpeg, compliantPng].map((file) => [file, hashFile(file)])
  );
  const prepared = await normalizer.prepareQualificationImagesForUpload({
    files: [oversizedPng, oversizedJpeg, compliantPng],
    outputDir: path.join(tempDir, "normalized")
  });

  assert.equal(prepared.files.length, 3);
  assert.equal(prepared.entries[0].action, "resize");
  assert.deepEqual(prepared.entries[0].outputDimensions, { width: 1900, height: 1421 });
  assert.notEqual(prepared.files[0], oversizedPng);
  assert.deepEqual(prepared.entries[1].outputDimensions, { width: 1900, height: 950 });
  assert.notEqual(prepared.files[1], oversizedJpeg);
  assert.equal(prepared.entries[2].action, "resize");
  assert.notEqual(prepared.files[2], compliantPng);
  for (const [file, originalHash] of sourceHashes) {
    assert.equal(hashFile(file), originalHash, `source image must remain unchanged: ${path.basename(file)}`);
  }

  await assert.rejects(
    normalizer.prepareQualificationImagesForUpload({
      files: [corruptPng],
      outputDir: path.join(tempDir, "corrupt")
    }),
    /dimension probe failed/i
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("qualification image normalization rule passed");
