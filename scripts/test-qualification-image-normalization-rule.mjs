import assert from "node:assert/strict";

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
  { action: "resize", targetWidth: 4900, targetHeight: 3666 }
);
assert.deepEqual(
  resolveQualificationImageResize({ width: 1655, height: 2338 }),
  { action: "reuse", targetWidth: 1655, targetHeight: 2338 }
);
assert.deepEqual(
  resolveQualificationImageResize({ width: 5000, height: 3200 }),
  { action: "reuse", targetWidth: 5000, targetHeight: 3200 }
);
assert.throws(
  () => resolveQualificationImageResize({ width: 0, height: 4141 }),
  /invalid qualification image dimensions/i
);
assert.deepEqual(
  verifyNormalizedQualificationImage({ width: 4900, height: 3666, targetWidth: 4900, targetHeight: 3666 }),
  { passed: true, issue: "" }
);
assert.match(
  verifyNormalizedQualificationImage({ width: 5001, height: 3666, targetWidth: 4900, targetHeight: 3666 }).issue,
  /exceeded target dimensions/i
);
assert.match(
  verifyNormalizedQualificationImage({ width: 4900, height: 3665, targetWidth: 4900, targetHeight: 3666 }).issue,
  /did not match requested dimensions/i
);

console.log("qualification image normalization rule passed");
