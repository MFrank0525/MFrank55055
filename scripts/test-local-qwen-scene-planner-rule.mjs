import assert from "node:assert/strict";
import fs from "node:fs";
import {
  LOCAL_QWEN_SCENE_MODEL,
  LOCAL_QWEN_SCENE_PLANNER_VERSION,
  buildBoundedSceneClauses,
  buildLocalQwenScenePlannerPrompt,
  validateLocalQwenSceneRecords,
  validateScenePlanArtifact
} from "../dist/src/autolist/qwen-scene-planner.js";
import { digestMainImagePromptSource } from "../dist/src/autolist/main-image-prompt-revision-rules.js";
import { classifySceneLocationConcepts } from "../dist/src/autolist/scene-location-rules.js";

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
assert.match(plannerPrompt, /主要用户任务锚点（不可被核心卖点替换）：唇部干燥护理；日常清爽润护/);
assert.match(plannerPrompt, /五个userNeed都必须直接重述上面的同一个主要用户任务锚点/);
assert.match(plannerPrompt, /只选阳光暴露明确、需求强烈的白天场景/);
assert.match(plannerPrompt, /不得原样复制商品名、主标题或副标题充当需求/);
assert.match(plannerPrompt, /每个对象的地点与动作必须属于同一消费时刻/);
assert.match(plannerPrompt, /每个对象必须写出一个具体可拍地点/);
assert.match(plannerPrompt, /locationConcept只能从/);
assert.match(plannerPrompt, /五个对象必须选择五个不同类别/);
assert.match(plannerPrompt, /不得描述或猜测包装形态/);
assert.doesNotMatch(plannerPrompt, /图示产品的使用步骤|突出放大的有设计感的艺术字/);
assert.equal(LOCAL_QWEN_SCENE_MODEL, "qwen3.6:35b-a3b");
const credentialHeavyPrompt = buildLocalQwenScenePlannerPrompt({
  sellingPointText: "突出放大的有设计感的艺术字：延草纲目 械字号防晒，尺寸略小一些的有设计感的艺术字：医用面部无菌防晒，官方正品，医用无菌型，为面部护理研发，品牌保障，户外防护，清爽肤感，图示产品的使用步骤，突出产品使用部位。",
  userCognitionName: "YCGM医用面部无菌防晒"
});
assert.match(credentialHeavyPrompt, /主要用户任务锚点（不可被核心卖点替换）：防晒；面部防晒/);
assert.doesNotMatch(credentialHeavyPrompt, /主要用户任务锚点（不可被核心卖点替换）：[^\n]*(?:医用|无菌|械字号)/);
const productNameOnlyPrompt = buildLocalQwenScenePlannerPrompt({
  sellingPointText: "突出放大的有设计感的艺术字：延草纲目医用痛风凝胶，尺寸略小一些的有设计感的艺术字：延草纲目痛风远红外凝胶，官方正品，第二类医疗器械产品，辅助治疗痛风性骨关节炎，远红外理疗技术，20g/支，手指脚趾关节，图示产品的使用步骤，突出产品使用部位。",
  userCognitionName: "YCGM痛风凝胶",
  genericName: "延草纲目痛风凝胶"
});
assert.match(productNameOnlyPrompt, /主要用户任务锚点（不可被核心卖点替换）：围绕痛风相关的手指脚趾关节进行日常护理/);
assert.doesNotMatch(productNameOnlyPrompt, /主要用户任务锚点（不可被核心卖点替换）：(?:痛风凝胶|痛风远红外凝胶)/);
assert.match(productNameOnlyPrompt, /不得退回商品名、主标题或副标题/);
assert.deepEqual(classifySceneLocationConcepts("温馨明亮的客厅沙发旁"), ["home-care"]);
assert.deepEqual(classifySceneLocationConcepts("明亮整洁的高铁车厢内部"), ["travel-transit"]);
const plannerSource = fs.readFileSync("src/autolist/qwen-scene-planner.ts", "utf8");
assert.doesNotMatch(
  plannerSource.replaceAll("http://127.0.0.1:11434", ""),
  /playwright|puppeteer|createBrowser|browserContext|page\.goto|https?:\/\//i
);
const plannerManual = fs.readFileSync("docs/auto-listing/steps/02-local-qwen-scenes.md", "utf8");
assert.match(plannerManual, /外部网页不得参与场景规划/);
assert.match(plannerManual, /`locationConcept`、`userNeed`、`consumerMoment`、`environment`、`mood`、`interaction`/);
assert.doesNotMatch(plannerManual, /按轮次追加固定人物策略|临床信息图：只允许|科技原理：不出现完整人物/);

const records = validateLocalQwenSceneRecords({ scenes: [
  { locationConcept: "city-street", userNeed: "出门前获得清爽润护", consumerMoment: "晨间出门准备", environment: "城市商业街区", mood: "清新克制", interaction: "唇部与商品建立自然使用关系" },
  { locationConcept: "home-care", userNeed: "随时进行便捷日常护理", consumerMoment: "午后居家使用", environment: "卧室梳妆台", mood: "自然松弛", interaction: "人物与当前商品形成生活化关系" },
  { locationConcept: "office", userNeed: "理解清透凝胶的润护价值", consumerMoment: "工作间隙了解商品", environment: "办公室工位", mood: "理性清晰", interaction: "商品与清透质感线索呼应" },
  { locationConcept: "retail", userNeed: "选购时快速确认核心价值", consumerMoment: "比较选择日常护理商品时", environment: "商场专柜", mood: "明确可信", interaction: "商品与润护需求建立直接视觉联系" },
  { locationConcept: "park-camping", userNeed: "轻松理解日常使用方式", consumerMoment: "周末户外护理时", environment: "公园草坪", mood: "清楚有序", interaction: "自然使用关系说明商品如何融入护理需求" }
] });
const prompts = buildBoundedSceneClauses({ scenes: records, productName: "唇部干燥护理" });
assert.equal(prompts.length, 5);
assert.ok(prompts.every((prompt) => prompt.includes("地点类别：")));
assert.equal(new Set(prompts).size, 5);
assert.ok(prompts.every((prompt) => prompt.includes("用户需求：")));
assert.ok(prompts.every((prompt) => prompt.includes("需求匹配：")));
assert.equal(prompts[1].includes("人物与当前商品形成生活化关系"), true);
assert.ok(prompts.every((prompt) => prompt.includes("完整参考商品组必须原样")));
const digest = digestMainImagePromptSource(sellingPointText);
assert.deepEqual(validateScenePlanArtifact({ prompts, promptCount: 5, plannerModel: LOCAL_QWEN_SCENE_MODEL, plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION, sellingPointDigest: digest, expectedSellingPointDigest: digest }), prompts);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.slice(0, 4) }), /exactly 5/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, locationConcept: "beach" } : item) }), /does not match described city-street/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, environment: "医院诊室" } : item) }), /visual boundary/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 3 ? { ...item, interaction: "消费者手持瓶身" } : item) }), /visual boundary/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, userNeed: "官方正品" } : item) }), /feature or credential/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, interaction: "商品帮助抵御细菌" } : item) }), /visual boundary/);
assert.throws(
  () => validateLocalQwenSceneRecords(
    { scenes: records.map((item, index) => index === 0 ? { ...item, userNeed: "唇部干燥护理" } : item) },
    { disallowedExactUserNeeds: ["唇部干燥护理"] }
  ),
  /copied a product title/
);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, environment: "户外海边", interaction: "商品放在浴室洗漱台" } : item) }), /outdoor environment with an indoor interaction/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, locationConcept: "beach", environment: "海边沙滩" } : index === 1 ? { ...item, locationConcept: "beach", consumerMoment: "午后海滩休息", environment: "海滩日光下", interaction: "商品与海边休息需求形成自然关系" } : item) }), /repeat the same beach location concept/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, environment: "城市商业街区" } : index === 1 ? { ...item, locationConcept: "city-street", consumerMoment: "午后街边休息", environment: "办公楼外人行道", interaction: "商品与城市出行需求形成自然关系" } : item) }), /repeat the same city-street location concept/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, environment: "明亮的户外空间" } : item) }), /exactly one concrete location concept/);
assert.throws(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, environment: "公园草坪或露天广场" } : item) }), /exactly one concrete location concept/);
assert.doesNotThrow(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) => index === 0 ? { ...item, interaction: "人物自然站立或轻触面部" } : item) }));
assert.doesNotThrow(() => validateLocalQwenSceneRecords({ scenes: records.map((item, index) =>
  index === 0 ? { ...item, locationConcept: "park-camping", environment: "城市公园草坪" }
    : index === 4 ? { ...item, locationConcept: "mountain", consumerMoment: "周末登山休息时", environment: "山林步道", interaction: "商品与登山需求建立直接视觉联系" }
      : item
) }));
assert.throws(() => validateScenePlanArtifact({ prompts, promptCount: 5, plannerModel: LOCAL_QWEN_SCENE_MODEL, plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION, sellingPointDigest: "old", expectedSellingPointDigest: digest }), /lineage/);
assert.throws(() => validateScenePlanArtifact({ prompts, promptCount: 5, plannerModel: "other", plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION, sellingPointDigest: digest, expectedSellingPointDigest: digest }), /model must be/);

console.log("local Qwen scene planner rule passed");
