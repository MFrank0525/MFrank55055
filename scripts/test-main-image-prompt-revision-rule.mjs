import assert from "node:assert/strict";
import {
  assertPromptWordRevisionMatches,
  createMainImagePromptRevision,
  digestMainImagePromptSource,
  selectNextFeishuMainImageSellingPointText
} from "../dist/src/autolist/main-image-prompt-revision-rules.js";

const current = "突出放大的有设计感的艺术字：头部皮肤不适护理，尺寸略小一些的有设计感的艺术字：形成物理屏障保持湿性状态，官方正品，阳离子瓜尔胶配方，泵头挤压，外用，图示产品的使用步骤，突出产品使用部位。";
const next = selectNextFeishuMainImageSellingPointText({
  headlineCandidateText: "头部皮肤不适护理，重组胶原蛋白头部敷料，头皮护理敷料",
  subtitleCandidateText: "形成物理屏障保持湿性状态，200ml大容量，泵头挤压设计",
  sellingPointCandidateText: "阳离子瓜尔胶配方，泵头挤压，外用，重组胶原蛋白，卡波姆基材，200ml大容量",
  currentSellingPointText: current
});
assert.notEqual(next, current);
assert.match(next, /^突出放大的有设计感的艺术字：重组胶原蛋白头部敷料，尺寸略小一些的有设计感的艺术字：200ml大容量，官方正品，重组胶原蛋白，卡波姆基材，200ml大容量，图示产品的使用步骤，突出产品使用部位。$/);

const revision = createMainImagePromptRevision({
  previousSellingPointText: current,
  sellingPointText: next,
  createdAt: "2026-11-19T00:00:00.000Z"
});
assert.equal(revision.sellingPointDigest, digestMainImagePromptSource(next));
assert.notEqual(revision.sellingPointDigest, revision.previousSellingPointDigest);

assert.doesNotThrow(() => assertPromptWordRevisionMatches({
  paragraphs: ["主图指令", next, "新的DeepSeek提示词", "正向提示词", "反向提示词"],
  sellingPointText: next,
  deepseekPrompt: "新的DeepSeek提示词"
}));
assert.throws(() => assertPromptWordRevisionMatches({
  paragraphs: ["主图指令", next, "老的DeepSeek提示词", "正向提示词", "反向提示词"],
  sellingPointText: next,
  deepseekPrompt: "新的DeepSeek提示词"
}), /stale DeepSeek prompt revision/);
assert.throws(() => assertPromptWordRevisionMatches({
  paragraphs: ["主图指令", current, "新的DeepSeek提示词", "正向提示词", "反向提示词"],
  sellingPointText: next,
  deepseekPrompt: "新的DeepSeek提示词"
}), /stale selling-point revision/);

console.log("main-image prompt revision rules passed");
