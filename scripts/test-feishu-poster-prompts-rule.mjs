import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDeepSeekPosterPrompt, DEEPSEEK_POSTER_INSTRUCTION, generatePosterPromptsWithDeepSeek, parseDeepSeekPosterPrompts } from "../dist/src/autolist/deepseek-prompts.js";
const sellingPointText = "突出放大的有设计感的艺术字：唇部干燥护理，尺寸略小一些的有设计感的艺术字：日常清爽润护，官方正品，聚乙二醇成分，保湿润护，清透凝胶，图示产品的使用步骤，突出产品使用部位。";
const fullPrompt = buildDeepSeekPosterPrompt(sellingPointText);
assert.equal(fullPrompt, `${sellingPointText}\n\n${DEEPSEEK_POSTER_INSTRUCTION}`);
for (const marker of ["设计出5款电商海报", "100-150个字之间", "不要修改我的包装", "不能在包装上加任何字"]) assert.match(fullPrompt, new RegExp(marker));
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-prompts-"));
const artifact = await generatePosterPromptsWithDeepSeek({ runtimeDir, taskId: "image-001", sellingPointText,
  userCognitionName: "唇部干燥护理", brandedGenericName: "延草纲目医用聚乙二醇润护敷料",
  genericName: "医用聚乙二醇润护敷料", promptCount: 5, simulateOnly: true });
assert.equal(artifact.prompts.length, 5);
assert.equal(new Set(artifact.prompts).size, 5);
assert.equal(fs.readFileSync(artifact.extractedFile, "utf8").trim().split(/\n/).length, 5);
assert.deepEqual(parseDeepSeekPosterPrompts(artifact.prompts.map((item, i) => `${i + 1}. ${item}`).join("\n")), artifact.prompts);
