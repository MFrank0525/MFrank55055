import assert from "node:assert/strict";
import {
  LOCAL_QWEN_SCENE_MODEL,
  LOCAL_QWEN_SCENE_PLANNER_VERSION,
  buildBoundedSceneClauses,
  buildLocalQwenScenePlannerPrompt,
  validateLocalQwenSceneRecords,
  validateScenePlanArtifact
} from "../dist/src/autolist/qwen-scene-planner.js";
import { digestMainImagePromptSource } from "../dist/src/autolist/main-image-prompt-revision-rules.js";

const sellingPointText = "突出放大的有设计感的艺术字：唇部干燥护理，尺寸略小一些的有设计感的艺术字：日常清爽润护，官方正品，聚乙二醇成分，保湿润护，清透凝胶，便携管装，日常可用，图示产品的使用步骤，突出产品使用部位。";
const plannerPrompt = buildLocalQwenScenePlannerPrompt({
  sellingPointText,
  userCognitionName: "唇部干燥护理",
  brandedGenericName: "延草纲目医用聚乙二醇润护敷料"
});
assert.match(plannerPrompt, new RegExp(LOCAL_QWEN_SCENE_PLANNER_VERSION));
assert.match(plannerPrompt, /只规划5个互不重复/);
assert.match(plannerPrompt, /不得描述或猜测包装形态/);
assert.doesNotMatch(plannerPrompt, /官方正品|图示产品的使用步骤|突出放大的有设计感的艺术字/);
assert.equal(LOCAL_QWEN_SCENE_MODEL, "qwen3.6:35b-a3b");

const records = validateLocalQwenSceneRecords({ scenes: [
  { consumerMoment: "晨间出门准备", environment: "冷白窗边台面", mood: "清新克制", interaction: "手部在唇部做局部演示" },
  { consumerMoment: "午后回到日常家中", environment: "灰白客厅绿植旁", mood: "自然松弛", interaction: "人物拿起当前商品准备使用" },
  { consumerMoment: "理解日常润护方式", environment: "青蓝透明材质空间", mood: "理性清晰", interaction: "局部使用部位与原理元素呼应" },
  { consumerMoment: "商品极简静物英雄展示", environment: "冷白极简陈列台", mood: "高级克制", interaction: "商品独立成为画面中心" },
  { consumerMoment: "完成日常使用步骤", environment: "青绿色清洁台面", mood: "清楚有序", interaction: "手部形成连续局部动作" }
] });
const prompts = buildBoundedSceneClauses({ scenes: records, productName: "唇部干燥护理" });
assert.equal(prompts.length, 5);
assert.equal(new Set(prompts).size, 5);
assert.match(prompts[0], /不出现完整人物脸部/);
assert.match(prompts[1], /最多出现一位自然人物/);
assert.match(prompts[3], /不出现人物、面部或手部/);
assert.match(prompts[4], /不描述任何包装结构/);
assert.equal(prompts.some((prompt) => prompt.includes("人物拿起当前商品准备使用")), false);
assert.ok(prompts.every((prompt) => prompt.includes("完整参考商品组必须原样")));
const digest = digestMainImagePromptSource(sellingPointText);
assert.deepEqual(validateScenePlanArtifact({ prompts, promptCount: 5, plannerModel: LOCAL_QWEN_SCENE_MODEL, plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION, sellingPointDigest: digest, expectedSellingPointDigest: digest }), prompts);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.slice(0, 4) }), /exactly 5/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, environment: "医院诊室" } : item) }), /visual boundary/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 3 ? { ...item, interaction: "消费者手持商品" } : item) }), /visual boundary|no person or body interaction/);
assert.throws(() => validateScenePlanArtifact({ prompts, promptCount: 5, plannerModel: LOCAL_QWEN_SCENE_MODEL, plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION, sellingPointDigest: "old", expectedSellingPointDigest: digest }), /lineage/);
assert.throws(() => validateScenePlanArtifact({ prompts, promptCount: 5, plannerModel: "other", plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION, sellingPointDigest: digest, expectedSellingPointDigest: digest }), /model must be/);

console.log("local Qwen scene planner rule passed");
