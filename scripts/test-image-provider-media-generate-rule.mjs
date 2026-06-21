import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
const orchestrator = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const feishuTypes = fs.readFileSync("src/feishu/types.ts", "utf8");
const example = JSON.parse(fs.readFileSync("input/image-generation.config.media-generate.example.json", "utf8"));

assert.equal(example.mode, "media-generate");
assert.equal(example.apiUrl.includes("/v1/media/generate"), true);
assert.equal(example.referenceImageUpload.provider, "tmpfiles");
assert.match(source, /mode\?: "generations" \| "edits" \| "media-generate"/);
assert.match(source, /resolveMediaGenerateStatusUrl/);
assert.match(source, /\/v1\/skills\/task-status/);
assert.match(source, /extractMediaGenerateTaskId/);
assert.match(source, /extractMediaGenerateResultUrl/);
assert.match(source, /hasMediaGenerateReferenceImage/);
assert.match(source, /requires a public reference image URL/);
assert.match(source, /sourceImageReferenceUrl/);
assert.match(source, /images: \[options\.sourceImageReferenceUrl\]/);
assert.match(source, /uploadMediaGenerateReferenceImage/);
assert.match(source, /tmpfiles\.org\/api\/v1\/upload/);
assert.match(source, /tmpfiles\.org\/dl\//);
assert.match(source, /downloadGeneratedImage\(resultUrl/);
assert.match(orchestrator, /sourceImageReferenceUrl/);
assert.match(feishuTypes, /providerReferenceUrl\?: string/);
