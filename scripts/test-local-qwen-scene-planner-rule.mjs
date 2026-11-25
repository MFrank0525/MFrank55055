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
assert.match(plannerPrompt, /规划5个互不重复/);
assert.match(plannerPrompt, /用户为什么会需要当前商品/);
assert.match(plannerPrompt, /只在能更准确解释当前userNeed和consumerMoment时使用/);
assert.match(plannerPrompt, /不得单独当成userNeed/);
assert.match(plannerPrompt, /允许多个场景服务同一个核心需求/);
assert.match(plannerPrompt, /主要用户任务锚点（不可被核心卖点替换）/);
assert.match(plannerPrompt, /五个userNeed都必须直接重述上面的同一个主要用户任务锚点/);
assert.match(plannerPrompt, /只选阳光暴露明确、需求强烈的白天场景/);
assert.match(plannerPrompt, /不得描述或猜测包装形态/);
assert.doesNotMatch(plannerPrompt, /图示产品的使用步骤|突出放大的有设计感的艺术字/);
assert.equal(LOCAL_QWEN_SCENE_MODEL, "qwen3.6:35b-a3b");

const records = validateLocalQwenSceneRecords({ scenes: [
  { userNeed: "出门前获得清爽润护", consumerMoment: "晨间出门准备", environment: "明亮窗边台面", mood: "清新克制", interaction: "唇部与商品建立自然使用关系" },
  { userNeed: "随时进行便捷日常护理", consumerMoment: "午后回到日常家中", environment: "客厅整洁置物区", mood: "自然松弛", interaction: "人物与当前商品形成生活化关系" },
  { userNeed: "理解清透凝胶的润护价值", consumerMoment: "认真了解商品特点时", environment: "透明材质展示空间", mood: "理性清晰", interaction: "商品与清透质感线索呼应" },
  { userNeed: "选购时快速确认核心价值", consumerMoment: "比较选择日常护理商品时", environment: "简洁商品展示空间", mood: "明确可信", interaction: "商品与润护需求建立直接视觉联系" },
  { userNeed: "轻松理解日常使用方式", consumerMoment: "完成日常护理时", environment: "整洁真实的护理环境", mood: "清楚有序", interaction: "自然使用关系说明商品如何融入护理需求" }
] });
const prompts = buildBoundedSceneClauses({ scenes: records, productName: "唇部干燥护理" });
assert.equal(prompts.length, 5);
assert.equal(new Set(prompts).size, 5);
assert.ok(prompts.every((prompt) => prompt.includes("用户需求：")));
assert.ok(prompts.every((prompt) => prompt.includes("需求匹配：")));
assert.equal(prompts[1].includes("人物与当前商品形成生活化关系"), true);
assert.ok(prompts.every((prompt) => prompt.includes("完整参考商品组必须原样")));
const digest = digestMainImagePromptSource(sellingPointText);
assert.deepEqual(validateScenePlanArtifact({ prompts, promptCount: 5, plannerModel: LOCAL_QWEN_SCENE_MODEL, plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION, sellingPointDigest: digest, expectedSellingPointDigest: digest }), prompts);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.slice(0, 4) }), /exactly 5/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, environment: "医院诊室" } : item) }), /visual boundary/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 3 ? { ...item, interaction: "消费者手持瓶身" } : item) }), /visual boundary/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, userNeed: "官方正品" } : item) }), /feature or credential/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, interaction: "商品帮助抵御细菌" } : item) }), /visual boundary/);
assert.throws(() => validateScenePlanArtifact({ prompts, promptCount: 5, plannerModel: LOCAL_QWEN_SCENE_MODEL, plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION, sellingPointDigest: "old", expectedSellingPointDigest: digest }), /lineage/);
assert.throws(() => validateScenePlanArtifact({ prompts, promptCount: 5, plannerModel: "other", plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION, sellingPointDigest: digest, expectedSellingPointDigest: digest }), /model must be/);

console.log("local Qwen scene planner rule passed");
