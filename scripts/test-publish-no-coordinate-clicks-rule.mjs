import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");

assert.ok(
  !/page\.mouse\.click|activePage\.mouse\.click/.test(source),
  "publish flow must use locator/DOM structure actions instead of coordinate mouse clicks"
);

assert.ok(
  !/boundingBox\([\s\S]{0,260}mouse\.click|mouse\.click[\s\S]{0,260}boundingBox\(/.test(source),
  "publish flow must not convert bounding boxes into click coordinates"
);

console.log("publish no coordinate clicks rule passed");
