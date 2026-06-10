import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/autolist/jimeng-assets.ts", "utf8");
const example = JSON.parse(fs.readFileSync("input/image-generation.config.media-generate.example.json", "utf8"));

assert.equal(example.mode, "media-generate");
assert.equal(example.apiUrl.includes("/v1/media/generate"), true);
assert.equal(Array.isArray(example.mediaParams.images), true);
assert.match(source, /mode\?: "generations" \| "edits" \| "media-generate"/);
assert.match(source, /resolveMediaGenerateStatusUrl/);
assert.match(source, /\/v1\/skills\/task-status/);
assert.match(source, /extractMediaGenerateTaskId/);
assert.match(source, /extractMediaGenerateResultUrl/);
assert.match(source, /hasMediaGenerateReferenceImage/);
assert.match(source, /requires a public reference image URL/);
assert.match(source, /downloadGeneratedImage\(resultUrl/);
