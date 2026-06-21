import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFeishuPromptWordFiles } from "../dist/src/autolist/deepseek-word-docs.js";
import { buildImageEditPromptFromWord } from "../dist/src/autolist/main-image-assets.js";
import { readSimpleWordDocument } from "../dist/src/autolist/docx-lite.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-dynamic-image-prompts-"));
const wordFiles = writeFeishuPromptWordFiles({
  mainImageWorkDir: tmp,
  mainImageInstructionText: "飞书主图指令：白底图产品主体锁定，包装文字不改。",
  sellingPointText: "飞书产品卖点：唇部干燥护理，保湿润护。",
  prompts: [
    "唇部护理场景,产品居中,水润光效",
    "保湿润护场景,凝胶特写,蓝白电商",
    "日常护理场景,包装放大,功能模块",
    "使用步骤场景,局部示意,高转化排版",
    "成分质感场景,透明凝胶,光影层次"
  ],
  positivePromptText: "飞书正向提示词：C4D，OC渲染，高级电商海报。",
  negativePromptText: "飞书反向提示词：不要治疗暗示，不要前后对比。",
  promptCount: 5
});

assert.equal(wordFiles.length, 5);
const paragraphs = readSimpleWordDocument(wordFiles[0]);
assert.deepEqual(paragraphs, [
  "飞书主图指令：白底图产品主体锁定，包装文字不改。",
  "飞书产品卖点：唇部干燥护理，保湿润护。",
  "唇部护理场景,产品居中,水润光效",
  "飞书正向提示词：C4D，OC渲染，高级电商海报。",
  "飞书反向提示词：不要治疗暗示，不要前后对比。"
]);

const modelPrompt = buildImageEditPromptFromWord({
  paragraphs,
  promptWordFile: wordFiles[0]
});
assert.equal(modelPrompt, paragraphs.join("\n"));
assert.equal(modelPrompt.includes("主图输出文字护栏"), false);
assert.equal(modelPrompt.includes("本轮第1张"), false);
