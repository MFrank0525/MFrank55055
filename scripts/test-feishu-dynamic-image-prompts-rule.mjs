import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFeishuPromptWordFiles } from "../dist/src/autolist/deepseek-word-docs.js";
import { buildImageEditPromptFromWord } from "../dist/src/autolist/main-image-assets.js";
import { buildMainImageProductionPrompt } from "../dist/src/autolist/main-image-visual-direction-rules.js";
import { MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT } from "../dist/src/autolist/main-image-collage-action.js";
import { readSimpleWordDocument } from "../dist/src/autolist/docx-lite.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-dynamic-image-prompts-"));
const approvedSource = "突出放大的有设计感的艺术字：唇部干燥护理，尺寸略小一些的有设计感的艺术字：日常清爽润护，官方正品，聚乙二醇成分，保湿润护，清透凝胶，便携管装，日常可用，图示产品的使用步骤，突出产品使用部位。";
const wordFiles = writeFeishuPromptWordFiles({
  mainImageWorkDir: tmp,
  sellingPointText: approvedSource,
  prompts: [
    "唇部护理场景,产品居中,水润光效",
    "保湿润护场景,凝胶特写,蓝白电商",
    "日常护理场景,包装放大,功能模块",
    "使用步骤场景,局部示意,高转化排版",
    "成分质感场景,透明凝胶,光影层次"
  ],
  promptCount: 5
});

assert.equal(wordFiles.length, 5);
const paragraphs = readSimpleWordDocument(wordFiles[0]);
assert.deepEqual(paragraphs, [
  approvedSource,
  "唇部护理场景,产品居中,水润光效"
]);

const variablePrompt = buildImageEditPromptFromWord({
  paragraphs,
  promptWordFile: wordFiles[0]
});
const modelPrompt = buildMainImageProductionPrompt({
  basePromptText: variablePrompt,
  roundIndex: 0,
  variantIndex: 0,
  hasFixedFrame: false
});
assert.match(modelPrompt, /固定生成契约 single-source-product-poster-v1/);
assert.match(modelPrompt, /一处非对称信息区/);
assert.match(modelPrompt, /避免横跨底部的等宽分栏/);
assert.match(modelPrompt, /已审核产品文案｜随产品变化/);
assert.match(modelPrompt, /当前轮产品场景｜随产品和轮次变化/);
assert.match(modelPrompt, /主标题：唇部干燥护理/);
assert.match(modelPrompt, /副标题：日常清爽润护/);
assert.match(modelPrompt, /核心卖点：聚乙二醇成分；保湿润护；清透凝胶；便携管装；日常可用/);
assert.equal(modelPrompt.includes("突出放大的有设计感的艺术字"), false);
assert.equal(modelPrompt.includes("官方正品"), false);
assert.equal(modelPrompt.includes("图示产品的使用步骤"), false);
assert.equal(modelPrompt.includes(paragraphs[1]), true);
assert.match(modelPrompt, /禁止四宫格、九宫格、2×2网格、4合1、拼图/u);
assert.match(
  modelPrompt,
  /强制画幅约束：最终输出必须为严格的1:1正方形画布（宽度=高度）/,
  "dynamic Feishu prompts must retain the paid main-image square-canvas contract"
);
assert.equal(modelPrompt.includes("主图输出文字护栏"), false);
assert.equal(modelPrompt.includes("正向提示词"), false);
assert.equal(modelPrompt.includes("反向提示词"), false);
assert.equal(modelPrompt.includes("本轮第1张"), true);
