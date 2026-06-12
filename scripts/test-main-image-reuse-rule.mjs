import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedCurrentProductMainImageReuse } from "../dist/src/autolist/jimeng-assets.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "main-image-reuse-"));
const sourceImagePath = path.join(tmp, "input", "row-7.png");
fs.mkdirSync(path.dirname(sourceImagePath), { recursive: true });
fs.writeFileSync(sourceImagePath, "source", "utf8");

const oldTaskDir = path.join(tmp, "runs", "old-run", "tasks", "image-003");
const oldRawDir = path.join(oldTaskDir, "main-image-01", "openai-compatible", "raw");
fs.mkdirSync(oldRawDir, { recursive: true });
fs.writeFileSync(path.join(oldTaskDir, "reuse-identity.json"), JSON.stringify({ sourceImagePath }, null, 2), "utf8");
for (let index = 1; index <= 4; index += 1) {
  fs.writeFileSync(path.join(oldRawDir, `generated-${String(index).padStart(2, "0")}.png`), `old-${index}`, "utf8");
}

const wrongTaskDir = path.join(tmp, "runs", "wrong-run", "tasks", "image-001");
const wrongRawDir = path.join(wrongTaskDir, "main-image-01", "openai-compatible", "raw");
fs.mkdirSync(wrongRawDir, { recursive: true });
fs.writeFileSync(path.join(wrongTaskDir, "reuse-identity.json"), JSON.stringify({ sourceImagePath: path.join(tmp, "input", "other.png") }, null, 2), "utf8");
fs.writeFileSync(path.join(wrongRawDir, "generated-05.png"), "wrong-product", "utf8");

const currentRunDir = path.join(tmp, "runs", "current-run");
const currentRawDir = path.join(currentRunDir, "tasks", "image-001", "main-image-01", "openai-compatible", "raw");
fs.mkdirSync(currentRawDir, { recursive: true });
fs.writeFileSync(path.join(currentRawDir, "generated-01.png"), "current-1", "utf8");
fs.writeFileSync(path.join(currentRawDir, "generated-02.png"), "current-2", "utf8");

const result = seedCurrentProductMainImageReuse({
  runtimeDir: currentRunDir,
  taskId: "image-001",
  sourceImagePath,
  feishuRecordId: "record-reused-by-new-batch"
});

assert.equal(result.copiedRawImageCount, 0);
assert.equal(fs.readFileSync(path.join(currentRawDir, "generated-01.png"), "utf8"), "current-1");
assert.equal(fs.readFileSync(path.join(currentRawDir, "generated-02.png"), "utf8"), "current-2");
assert.equal(fs.existsSync(path.join(currentRawDir, "generated-03.png")), false);
assert.equal(fs.existsSync(path.join(currentRawDir, "generated-04.png")), false);
assert.equal(fs.existsSync(path.join(currentRawDir, "generated-05.png")), false);
