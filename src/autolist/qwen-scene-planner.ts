import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/path-names.js";
import type { ScenePlanArtifact } from "./types.js";
import { digestMainImagePromptSource } from "./main-image-prompt-revision-rules.js";
import { formatSelectedMainImageCopyForPrompt } from "./selling-point-rules.js";
import type { FeishuProductRecord } from "../feishu/types.js";
import { getProductCategoryPlan } from "./product-category.js";

export const LOCAL_QWEN_SCENE_MODEL = "qwen3.6:35b-a3b";
export const LOCAL_QWEN_SCENE_PLANNER_VERSION = "local-qwen-consumer-scenes-v4";

export interface FeishuPosterPromptBatchValidationError {
  recordId: string;
  rowNumber: number;
  userCognitionName: string;
  spu: string;
  requiredPromptCount: number;
  message: string;
}

export function validateFeishuPosterPromptBatch(records: FeishuProductRecord[]): {
  ok: boolean;
  errors: FeishuPosterPromptBatchValidationError[];
  summary: string;
} {
  const errors = records.flatMap((record, index) => {
    const parts = record.sellingPointText.replace(/。$/, "").split("，").filter(Boolean);
    const selectedSellingPoints = parts.slice(3, 8);
    const valid = parts.length === 10 && /^突出放大的有设计感的艺术字：.+/.test(parts[0]) &&
      /^尺寸略小一些的有设计感的艺术字：.+/.test(parts[1]) && parts[2] === "官方正品" &&
      new Set(selectedSellingPoints).size === 5 && parts[8] === "图示产品的使用步骤" && parts[9] === "突出产品使用部位";
    if (valid) return [];
    return [{
      recordId: record.recordId,
      rowNumber: index + 1,
      userCognitionName: record.userCognitionName,
      spu: record.spu,
      requiredPromptCount: getProductCategoryPlan(record.productCategory).promptCount,
      message: "产品卖点必须使用固定整段结构，并填入1个主图主标题、1个主图副标题和5个不同主图卖点。"
    }];
  });
  return {
    ok: errors.length === 0,
    errors,
    summary: errors.length
      ? `飞书主图候选词预检失败：${errors.map((error) => `cache item ${error.rowNumber} ${error.recordId}: ${error.message}`).join(" | ")}`
      : `飞书主图候选词预检通过：${records.length} record(s).`
  };
}

interface QwenSceneRecord {
  consumerMoment: string;
  environment: string;
  mood: string;
  interaction: string;
}

const SUBJECT_POLICIES = [
  "只出现手部或使用部位局部，不出现完整人物脸部",
  "最多出现一位自然人物，人物只提供生活代入感且不得大于完整商品组",
  "不出现完整人物，只允许局部手部、使用部位或抽象原理元素",
  "不出现人物、面部或手部，采用纯商品英雄展示",
  "只出现手部与使用部位局部步骤，不出现完整人物脸部"
] as const;

const INTERACTION_POLICIES = [
  "手部在使用部位做局部演示，具体商品形态只以参考图为准",
  "一位自然人物与当前商品建立生活化关系，不描述或猜测包装细节",
  "局部使用部位与抽象原理元素呼应，不出现完整人物",
  "不呈现人物互动，商品独立成为画面中心",
  "手部与使用部位局部形成连续步骤，不描述任何包装结构"
] as const;

const SCENE_ROLE_POLICIES = [
  "冷静清晰的局部使用信息场景",
  "真实自然的日常生活场景",
  "与商品卖点相关的材质或原理场景",
  "冷白或浅灰的纯商品极简英雄场景",
  "清楚有序的局部使用步骤场景"
] as const;

const SCENE_ROLE_MARKERS = [
  ["冷白", "清洁", "清晰", "理性", "局部"],
  ["日常", "居家", "通勤", "户外", "自然", "生活"],
  ["青蓝", "透明", "微观", "材质", "原理", "科技"],
  ["冷白", "浅灰", "纯色", "极简"],
  ["步骤", "使用", "有序", "清洁", "台面", "顺序", "流程", "连续", "局部", "操作"]
] as const;

const FORBIDDEN_SCENE_TERMS = [
  "医院", "诊室", "医生", "护士", "患者", "治疗", "治愈", "疗效", "前后对比", "使用前", "使用后",
  "红肿", "泛红", "破损", "流血", "疼痛", "刺痛", "灼热", "发烫", "痛苦", "不适", "症状", "创口", "伤口",
  "晒伤", "晒后", "痕迹", "紧绷", "干燥", "修复", "缓解", "疗愈", "焦虑", "烦躁", "疲惫",
  "瓶身", "瓶子", "罐体", "罐装", "软管", "管身", "盒装", "纸盒", "容器", "标签区域", "包装形态",
  "泵头", "按压", "外壁", "商品表面", "商品主体", "持握", "手持", "托住", "取用", "控制部件", "开盖", "旋盖", "倒出", "挤出", "喷出",
  "暖色", "暖光", "温暖", "暖黄", "橙金", "米黄", "奶油", "木质", "夕阳", "黄昏", "昏暗", "台灯",
  "数据可视化", "数据界面", "操作界面", "仪表盘", "显示屏", "屏幕文字",
  "证书", "奖状", "促销", "折扣",
  "儿童", "婴儿", "孕妇", "老人", "男性", "女性", "男士", "女士", "宝妈", "网红", "明星",
  "其他产品", "其他商品", "其他护理品", "其他药品", "可读文字", "广告牌", "标签文字"
] as const;

const SCENE_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          consumerMoment: { type: "string", minLength: 4, maxLength: 80 },
          environment: { type: "string", minLength: 4, maxLength: 80 },
          mood: { type: "string", minLength: 4, maxLength: 80 },
          interaction: { type: "string", minLength: 4, maxLength: 80 }
        },
        required: ["consumerMoment", "environment", "mood", "interaction"],
        additionalProperties: false
      }
    }
  },
  required: ["scenes"],
  additionalProperties: false
} as const;

function ensureTaskDir(runtimeDir: string, taskId: string): string {
  const taskDir = path.join(runtimeDir, "tasks", sanitizeFileName(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

function normalizeSceneField(value: unknown, label: string): string {
  const text = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 4 || text.length > 80) {
    throw new Error(`Local Qwen scene field ${label} must contain 4-80 characters.`);
  }
  const forbidden = FORBIDDEN_SCENE_TERMS.find((term) => text.includes(term));
  if (forbidden) {
    throw new Error(`Local Qwen scene field ${label} crossed a visual boundary: ${forbidden}.`);
  }
  return text;
}

export function buildLocalQwenScenePlannerPrompt(input: {
  sellingPointText: string;
  userCognitionName?: string;
  brandedGenericName?: string;
  genericName?: string;
}): string {
  const approvedCopy = formatSelectedMainImageCopyForPrompt(input.sellingPointText);
  const productName = input.userCognitionName?.trim() || input.brandedGenericName?.trim() || input.genericName?.trim();
  if (!approvedCopy || !productName) {
    throw new Error("Local Qwen scene planning requires approved Feishu copy and a current product name.");
  }
  return [
    `【本地场景规划契约 ${LOCAL_QWEN_SCENE_PLANNER_VERSION}】`,
    `当前商品：${productName}`,
    approvedCopy,
    "只规划5个互不重复、真实可拍的消费时刻。每个场景只描述consumerMoment、environment、mood、interaction四项。",
    "不得描述或猜测包装形态、瓶管盒罐、容器、标签、颜色、规格、成分、适用人群、皮肤或身体状态、任何症状、不适、治疗结果、医院医生、前后对比、其他商品或任何新增文字。",
    "consumerMoment只回答何时、何地发生消费需求，不写商品接触动作、包装结构或身体异常；interaction只写人与商品或使用部位的高层关系，不写拿、握、托、按、挤、喷、开盖、取用等具体包装动作。",
    "五个对象按顺序严格承担不同角色：1冷静清晰的局部使用信息场景；2真实自然的日常生活场景；3与当前卖点相关的材质或原理场景，使用青蓝、透明、微观或科技空间；4冷白、浅灰或纯色极简商品英雄场景；5清楚有序的局部使用步骤场景。",
    "五个对象按顺序严格执行人物边界：1只写手部或使用部位局部；2最多一位自然人物；3不写完整人物；4纯商品静物展示，四字段都不得出现人物、消费者、面部或手部；5只写手部和使用部位局部步骤。所有环境禁止暖色、暖光、米黄、奶油、木质、夕阳和昏暗灯光。",
    "所有时刻必须是积极、平静、舒适的正常日常状态；不得用问题、痛点、焦虑或身体异常来解释需求。",
    "五个场景的时间、地点和互动方式必须明显不同；interaction只描述人与当前商品或使用部位的自然关系，不写广告文案。",
    "每个场景都必须通过时间、地点或自然使用关系直接体现当前商品用途，让人不看海报文字也能理解为什么此刻需要该商品；禁止输出可被任意护理品、药品或器械套用的通用场景。",
    "严格按JSON schema输出，不要解释。"
  ].join("\n");
}

export function validateLocalQwenSceneRecords(value: unknown): QwenSceneRecord[] {
  const scenes = (value as { scenes?: unknown[] } | null)?.scenes;
  if (!Array.isArray(scenes) || scenes.length !== 5) {
    throw new Error(`Local Qwen must return exactly 5 scene records, got ${Array.isArray(scenes) ? scenes.length : 0}.`);
  }
  const normalized = scenes.map((scene, index) => {
    const item = scene as Partial<QwenSceneRecord>;
    return {
      consumerMoment: normalizeSceneField(item.consumerMoment, `${index + 1}.consumerMoment`),
      environment: normalizeSceneField(item.environment, `${index + 1}.environment`),
      mood: normalizeSceneField(item.mood, `${index + 1}.mood`),
      interaction: normalizeSceneField(item.interaction, `${index + 1}.interaction`)
    };
  });
  for (const key of ["consumerMoment", "environment", "interaction"] as const) {
    if (new Set(normalized.map((scene) => scene[key])).size !== 5) {
      throw new Error(`Local Qwen scene records must use 5 distinct ${key} values.`);
    }
  }
  const productHeroText = Object.values(normalized[3]).join("");
  const productHeroHumanTerm = ["消费者", "人物", "人像", "模特", "面部", "脸", "手部", "手指", "手持", "握", "触碰", "坐", "站"].find((term) =>
    productHeroText.includes(term)
  );
  if (productHeroHumanTerm) {
    throw new Error(`Local Qwen product-hero scene must contain no person or body interaction: ${productHeroHumanTerm}.`);
  }
  normalized.forEach((scene, index) => {
    const sceneText = Object.values(scene).join("");
    if (!SCENE_ROLE_MARKERS[index].some((marker) => sceneText.includes(marker))) {
      throw new Error(`Local Qwen scene ${index + 1} does not satisfy its fixed visual role: ${SCENE_ROLE_POLICIES[index]}.`);
    }
  });
  return normalized;
}

export function buildBoundedSceneClauses(input: {
  scenes: QwenSceneRecord[];
  productName: string;
}): string[] {
  if (input.scenes.length !== 5 || !input.productName.trim()) {
    throw new Error("Bounded scene clauses require five validated scenes and the current product name.");
  }
  return input.scenes.map((scene, index) => [
    `场景角色：${SCENE_ROLE_POLICIES[index]}。`,
    `消费者时刻：${scene.consumerMoment}。`,
    `环境：${scene.environment}。`,
    `氛围：${scene.mood}。`,
    `互动关系：${INTERACTION_POLICIES[index]}。`,
    `人物边界：${SUBJECT_POLICIES[index]}。`,
    `当前商品仅指${input.productName.trim()}；完整参考商品组必须原样、成组、最大且最清晰地位于前景，包装数量、文字、比例、颜色和标识只以参考图为准。`,
    "场景不得出现症状、伤口、医院医生、治疗结果、前后对比、其他商品、促销元素或任何额外可读文字。"
  ].join(""));
}

function simulatedSceneRecords(): QwenSceneRecord[] {
  return [
    { consumerMoment: "晨间出门前的日常准备", environment: "冷调窗边与浅色台面", mood: "清新克制", interaction: "手部在使用部位做局部演示" },
    { consumerMoment: "午后回到日常居家空间", environment: "灰白客厅与鼠尾草绿植物", mood: "自然松弛", interaction: "一位人物与商品形成生活化关系" },
    { consumerMoment: "理解商品材质与作用方式", environment: "青蓝透明材质实验感空间", mood: "理性清晰", interaction: "局部使用部位与抽象原理元素呼应" },
    { consumerMoment: "商品极简静物展示", environment: "冷白极简陈列台", mood: "高级克制", interaction: "商品独立成为画面中心" },
    { consumerMoment: "按步骤完成日常使用", environment: "青绿色清洁台面", mood: "清楚有序", interaction: "手部与使用部位局部形成连续动作" }
  ];
}

async function callLocalQwen(options: {
  promptText: string;
  model: string;
  host: string;
  timeoutMs: number;
}): Promise<{ payload: unknown; rawResponse: string; model: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`${options.host.replace(/\/$/u, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        prompt: options.promptText,
        stream: false,
        think: false,
        format: SCENE_SCHEMA,
        options: { temperature: 0.35, top_p: 0.85 }
      }),
      signal: controller.signal
    });
    const rawResponse = await response.text();
    if (!response.ok) {
      throw new Error(`Local Ollama scene planner failed with HTTP ${response.status}: ${rawResponse.slice(0, 500)}`);
    }
    const envelope = JSON.parse(rawResponse) as { response?: string; model?: string };
    if (!envelope.response) {
      throw new Error("Local Ollama scene planner returned no response text.");
    }
    return { payload: JSON.parse(envelope.response), rawResponse, model: envelope.model || options.model };
  } finally {
    clearTimeout(timer);
  }
}

export async function generatePosterScenesWithLocalQwen(options: {
  runtimeDir: string;
  taskId: string;
  sellingPointText: string;
  userCognitionName?: string;
  brandedGenericName?: string;
  genericName?: string;
  promptCount: number;
  simulateOnly: boolean;
  model?: string;
  host?: string;
}): Promise<ScenePlanArtifact> {
  if (options.promptCount !== 5) {
    throw new Error(`Local Qwen scene planning requires exactly 5 prompts, got ${options.promptCount}.`);
  }
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const promptText = buildLocalQwenScenePlannerPrompt(options);
  const promptFile = path.join(taskDir, "qwen-scene-planner-prompt.txt");
  const rawFile = path.join(taskDir, "qwen-scene-raw.json");
  const extractedFile = path.join(taskDir, "qwen-scene-extracted.txt");
  const artifactFile = path.join(taskDir, "qwen-scene-plan.json");
  const productName = options.userCognitionName?.trim() || options.brandedGenericName?.trim() || options.genericName?.trim() || "";
  const sellingPointDigest = digestMainImagePromptSource(options.sellingPointText);
  fs.writeFileSync(promptFile, `${promptText}\n`, "utf8");

  const model = options.model || process.env.AUTO_LISTING_SCENE_MODEL?.trim() || LOCAL_QWEN_SCENE_MODEL;
  let scenes: QwenSceneRecord[];
  let rawResponse: string;
  let resolvedModel = model;
  if (options.simulateOnly) {
    scenes = validateLocalQwenSceneRecords({ scenes: simulatedSceneRecords() });
    rawResponse = JSON.stringify({ simulated: true, model, scenes }, null, 2);
  } else {
    const attempts: Array<{ attempt: number; rawResponse?: string; error?: string }> = [];
    let validationError = "";
    let validatedScenes: QwenSceneRecord[] | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const correction = validationError
        ? `\n\n上一次输出被程序拒绝：${validationError}\n重新生成全部5个对象，严格消除该问题，不要解释。`
        : "";
      let attemptRawResponse: string | undefined;
      try {
        const result = await callLocalQwen({
          promptText: `${promptText}${correction}`,
          model,
          host: options.host || process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434",
          timeoutMs: 10 * 60_000
        });
        attemptRawResponse = result.rawResponse;
        resolvedModel = result.model;
        validatedScenes = validateLocalQwenSceneRecords(result.payload);
        attempts.push({ attempt, rawResponse: result.rawResponse });
        break;
      } catch (error) {
        validationError = error instanceof Error ? error.message : String(error);
        attempts.push({ attempt, rawResponse: attemptRawResponse, error: validationError });
      }
    }
    if (!validatedScenes) {
      fs.writeFileSync(rawFile, `${JSON.stringify({ model, attempts }, null, 2)}\n`, "utf8");
      throw new Error(`Local Qwen scene planning failed after 3 bounded attempts: ${validationError}`);
    }
    scenes = validatedScenes;
    rawResponse = JSON.stringify({ model: resolvedModel, attempts }, null, 2);
  }
  const prompts = buildBoundedSceneClauses({ scenes, productName });
  fs.writeFileSync(rawFile, `${rawResponse}\n`, "utf8");
  fs.writeFileSync(extractedFile, `${prompts.join("\n")}\n`, "utf8");
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(
    artifactFile,
    `${JSON.stringify({
      plannerModel: resolvedModel,
      plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION,
      sellingPointDigest,
      prompts,
      generatedAt,
      simulated: options.simulateOnly
    }, null, 2)}\n`,
    "utf8"
  );
  return {
    artifactFile,
    promptFile,
    rawFile,
    extractedFile,
    prompts,
    plannerModel: resolvedModel,
    plannerVersion: LOCAL_QWEN_SCENE_PLANNER_VERSION,
    sellingPointDigest,
    generatedAt,
    simulated: options.simulateOnly
  };
}

export function validateScenePlanArtifact(options: {
  prompts: string[];
  promptCount: number;
  plannerModel?: string;
  plannerVersion?: string;
  sellingPointDigest?: string;
  expectedSellingPointDigest: string;
}): string[] {
  if (options.plannerModel !== LOCAL_QWEN_SCENE_MODEL) {
    throw new Error(`Local Qwen scene-plan model must be ${LOCAL_QWEN_SCENE_MODEL}, got ${options.plannerModel || "missing"}.`);
  }
  if (options.plannerVersion !== LOCAL_QWEN_SCENE_PLANNER_VERSION) {
    throw new Error(`Local Qwen scene-plan version must be ${LOCAL_QWEN_SCENE_PLANNER_VERSION}, got ${options.plannerVersion || "missing"}.`);
  }
  if (options.sellingPointDigest !== options.expectedSellingPointDigest) {
    throw new Error("Local Qwen scene-plan lineage does not match the current Feishu selling-point revision.");
  }
  if (options.prompts.length !== options.promptCount || options.promptCount !== 5) {
    throw new Error(`Local Qwen scene plan must contain exactly 5 bounded clauses, got ${options.prompts.length}.`);
  }
  options.prompts.forEach((prompt, index) => {
    if (!prompt.includes(`人物边界：${SUBJECT_POLICIES[index]}`) || !prompt.includes("完整参考商品组必须原样")) {
      throw new Error(`Local Qwen bounded scene clause ${index + 1} is incomplete or obsolete.`);
    }
    const semanticScene = prompt.split("当前商品仅指")[0] || prompt;
    const forbidden = FORBIDDEN_SCENE_TERMS.find((term) => semanticScene.includes(term));
    if (forbidden) {
      throw new Error(`Local Qwen bounded scene clause ${index + 1} contains forbidden content: ${forbidden}.`);
    }
  });
  return options.prompts;
}
