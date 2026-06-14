import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPosterPromptArtifactFromFeishu } from "../dist/src/autolist/deepseek-prompts.js";

const mainImageRuleDoc = fs.readFileSync("docs/auto-listing/steps/03-main-image-generation.md", "utf8");
const imageGenerationExampleConfig = fs.readFileSync("input/image-generation.config.example.json", "utf8");
const imageGenerationMediaConfig = fs.readFileSync("input/image-generation.config.media-generate.example.json", "utf8");
const jimengAssetsSource = fs.readFileSync("src/autolist/jimeng-assets.ts", "utf8");

assert.match(
  mainImageRuleDoc,
  /卖点文案.*图案元素|图案化/,
  "main image prompt rules must require selling points to be designed as visual elements"
);
assert.match(
  mainImageRuleDoc,
  /不要在主图里增加.*部位前后对比|前后对比效果图/,
  "main image prompt rules must forbid before-after body-part comparison imagery"
);
for (const forbiddenImageText of [
  "放心使用",
  "过敏",
  "红敏",
  "治疗",
  "泛红",
  "敏感肌",
  "消肿止痛",
  "敏肌",
  "红肿",
  "抗敏",
  "抗炎",
  "炎症",
  "消炎",
  "日本",
  "进口"
]) {
  assert.match(
    mainImageRuleDoc,
    new RegExp(forbiddenImageText),
    `main image prompt rules must list forbidden image text: ${forbiddenImageText}`
  );
}
assert.match(
  mainImageRuleDoc,
  /违禁词不得出现在图片里/,
  "main image prompt rules must explicitly forbid prohibited words from appearing in generated images"
);
assert.doesNotMatch(
  mainImageRuleDoc,
  /绿色对号/,
  "main image prompt rules must not require simple green-check selling point text layout"
);
assert.match(
  imageGenerationExampleConfig,
  /"size":\s*"1024x1024"/,
  "OpenAI-compatible image2 example config must request 1024x1024 square output"
);
assert.match(
  imageGenerationMediaConfig,
  /"size":\s*"1024x1024"/,
  "OpenAI-compatible media-generate example config must request 1024x1024 square output"
);
assert.match(
  jimengAssetsSource,
  /1024x1024/,
  "OpenAI-compatible image2 request fallback size must be 1024x1024"
);

const promptText = [
  "唇部护理洁净场景,聚乙二醇凝胶管装展示,保湿润护水光粒子,电商主图构图",
  "医用唇部保湿凝胶特写,润护敷料透明质地,干燥唇部护理示意,蓝白医疗风",
  "聚乙二醇润护敷料台面陈列,凝胶挤出质感,唇部保湿卖点标签,官方正品视觉",
  "唇部干燥护理步骤海报,保湿凝胶使用场景,水润成膜光效,产品包装前景",
  "医用唇部凝胶主题主图,聚乙二醇成分符号,保湿润护核心卖点,高转化排版"
].join("\n");

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-poster-prompts-"));
const artifact = buildPosterPromptArtifactFromFeishu({
  runtimeDir,
  taskId: "image-001",
  feishuPromptText: promptText,
  sellingPointText: "适用于唇部干燥护理，保湿润护，医用聚乙二醇润护敷料。",
  userCognitionName: "医用唇部保湿凝胶",
  brandedGenericName: "延草纲目医用聚乙二醇润护敷料",
  genericName: "医用聚乙二醇润护敷料",
  promptCount: 5,
  simulated: false
});

assert.equal(artifact.prompts.length, 5);
assert.equal(artifact.simulated, false);
assert.equal(fs.existsSync(artifact.rawFile), true);
assert.equal(fs.readFileSync(artifact.extractedFile, "utf8").trim().split(/\n/).length, 5);

assert.throws(
  () =>
    buildPosterPromptArtifactFromFeishu({
      runtimeDir,
      taskId: "image-002",
      feishuPromptText: promptText.split(/\n/).slice(0, 3).join("\n"),
      sellingPointText: "适用于唇部干燥护理，保湿润护，医用聚乙二醇润护敷料。",
      userCognitionName: "医用唇部保湿凝胶",
      brandedGenericName: "延草纲目医用聚乙二醇润护敷料",
      genericName: "医用聚乙二醇润护敷料",
      promptCount: 5,
      simulated: false
    }),
  /must provide 5/
);
