import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDeepSeekPosterPrompt, DEEPSEEK_POSTER_INSTRUCTION, generatePosterPromptsWithDeepSeek, parseDeepSeekPosterPrompts, recoverValidPosterPromptsFromRaw, validatePosterPrompts } from "../dist/src/autolist/deepseek-prompts.js";
const sellingPointText = "突出放大的有设计感的艺术字：唇部干燥护理，尺寸略小一些的有设计感的艺术字：日常清爽润护，官方正品，聚乙二醇成分，保湿润护，清透凝胶，便携管装，日常可用，图示产品的使用步骤，突出产品使用部位。";
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

const variableLengthPrompts = [
  "葡聚糖创面护理敷料,明亮居家场景,产品大图,使用部位,包装保持原样",
  `葡聚糖创面护理敷料,${"明亮丰富场景".repeat(30)},产品主体突出,静态使用展示,包装保持原样`,
  "葡聚糖配方,户外急救场景,擦伤部位展示,产品近景,包装保持原样",
  "创面护理敷料,学校医务室,手肘护理场景,产品占比突出,包装保持原样",
  "B-葡聚糖,社区健身场景,小腿护理展示,产品清晰可见,包装保持原样"
];
assert.ok(Array.from(variableLengthPrompts[0]).length < 100);
assert.ok(Array.from(variableLengthPrompts[1]).length > 150);
assert.deepEqual(validatePosterPrompts(variableLengthPrompts, {
  sellingPointText,
  userCognitionName: "葡聚糖创面护理敷料",
  brandedGenericName: "延草纲目B-葡聚糖创面护理敷料",
  genericName: "葡聚糖创面护理敷料"
}, 5), variableLengthPrompts);

const recoveryTaskDir = path.join(runtimeDir, "tasks", "image-recovery");
fs.mkdirSync(recoveryTaskDir, { recursive: true });
fs.writeFileSync(path.join(recoveryTaskDir, "deepseek-raw.txt"), `${variableLengthPrompts.join("\n")}\n`);
const recovered = recoverValidPosterPromptsFromRaw({
  taskDir: recoveryTaskDir,
  record: {
    sellingPointText,
    userCognitionName: "葡聚糖创面护理敷料",
    brandedGenericName: "延草纲目B-葡聚糖创面护理敷料",
    genericName: "葡聚糖创面护理敷料"
  },
  promptCount: 5
});
assert.deepEqual(recovered?.prompts, variableLengthPrompts);
assert.equal(recovered?.rawFile, path.join(recoveryTaskDir, "deepseek-raw.txt"));
