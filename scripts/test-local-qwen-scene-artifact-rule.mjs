import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePosterScenesWithLocalQwen } from "../dist/src/autolist/qwen-scene-planner.js";
import { writeScenePromptWordFiles } from "../dist/src/autolist/scene-word-docs.js";
import { readSimpleWordDocument } from "../dist/src/autolist/docx-lite.js";

const sellingPointText = "突出放大的有设计感的艺术字：唇部干燥护理，尺寸略小一些的有设计感的艺术字：日常清爽润护，官方正品，聚乙二醇成分，保湿润护，清透凝胶，便携管装，日常可用，图示产品的使用步骤，突出产品使用部位。";
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-qwen-scenes-"));
const artifact = await generatePosterScenesWithLocalQwen({
  runtimeDir,
  taskId: "image-001",
  sellingPointText,
  userCognitionName: "唇部干燥护理",
  brandedGenericName: "延草纲目医用聚乙二醇润护敷料",
  genericName: "医用聚乙二醇润护敷料",
  promptCount: 5,
  simulateOnly: true
});
assert.equal(artifact.prompts.length, 5);
assert.equal(new Set(artifact.prompts).size, 5);
assert.ok(fs.existsSync(artifact.promptFile));
assert.ok(fs.existsSync(artifact.rawFile));
assert.ok(fs.existsSync(artifact.extractedFile));
assert.ok(fs.existsSync(artifact.artifactFile));
const wordFiles = writeScenePromptWordFiles({
  mainImageWorkDir: path.join(runtimeDir, "words"),
  sellingPointText,
  prompts: artifact.prompts,
  promptCount: 5
});
assert.equal(wordFiles.length, 5);
wordFiles.forEach((file, index) => assert.deepEqual(readSimpleWordDocument(file), [sellingPointText, artifact.prompts[index]]));

console.log("local Qwen scene artifact rule passed");
