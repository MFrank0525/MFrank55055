import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/path-names.js";
import type { ScenePlanArtifact } from "./types.js";
import { digestMainImagePromptSource } from "./main-image-prompt-revision-rules.js";
import { formatSelectedMainImageCopyForPrompt } from "./selling-point-rules.js";
import type { FeishuProductRecord } from "../feishu/types.js";
import { getProductCategoryPlan } from "./product-category.js";
import { requireLocalOllamaHost } from "./local-ollama-rules.js";
import {
  SCENE_LOCATION_CONCEPTS,
  isSceneLocationConcept,
  requireSingleSceneLocationConcept,
  type SceneLocationConcept
} from "./scene-location-rules.js";

export const LOCAL_QWEN_SCENE_MODEL = "qwen3.6:35b-a3b";
export const LOCAL_QWEN_SCENE_PLANNER_VERSION = "local-qwen-need-matched-scenes-v7";

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
  locationConcept: SceneLocationConcept;
  userNeed: string;
  consumerMoment: string;
  environment: string;
  mood: string;
  interaction: string;
}

interface QwenSceneValidationOptions {
  disallowedExactUserNeeds?: string[];
}

const OUTDOOR_SCENE_PATTERN = /户外|沙滩|海边|海滩|登山|山林|山顶|公园|草坪|露营|野餐|露天|运动场|网球场|跑步道/u;
const INDOOR_SCENE_PATTERN = /室内|居家|家中|客厅|沙发|浴室|洗漱台|梳妆台|卧室|床头柜|办公室|工位|书房/u;

function normalizeNeedComparison(value: string): string {
  return value.replace(/[\s，。；：、,.!！?？“”‘’"']/gu, "").toLowerCase();
}

function extractPrimaryNeedSourceAnchors(approvedCopy: string): string[] {
  const anchors = approvedCopy
    .split("\n")
    .filter((line) => line.startsWith("主标题：") || line.startsWith("副标题："))
    .map((line) => line.replace(/^.+?：/u, "").trim())
    .map((value) => value
      .replace(/延草纲目|\bYCGM\b/giu, "")
      .replace(/官方正品|械字号|医用|无菌型?|器械级|医疗级|成分|技术/gu, "")
      .replace(/[\s，。；：、,.!！?？“”‘’"']+/gu, "")
      .trim())
    .filter(Boolean);
  return anchors.filter((value, index) => anchors.indexOf(value) === index);
}

const PRODUCT_FORM_SUFFIX_PATTERN = /(远红外)?(?:治疗)?(?:凝胶|膏体敷料|敷料|软膏|乳膏|乳液|喷雾|贴剂|贴|面膜|胶囊|片剂|口服液|粉剂|颗粒|霜|膏|液)$/u;
const USER_TASK_PATTERN = /(?:防晒|防紫外线|护理|润护|清洁|防护|修护|保湿|补水|舒缓|支撑|固定|监测|测量)$/u;

function extractBodySiteHint(approvedCopy: string): string {
  const coreSellingPoints = approvedCopy.split("\n")
    .find((line) => line.startsWith("核心卖点："))
    ?.replace(/^核心卖点：/u, "")
    .split("；") || [];
  return coreSellingPoints.find((part) => /(?:面部|脸部|唇部|口腔|鼻腔|颈部|腰部|腿部|足部|脚部|手部|手指|脚趾|关节|皮肤)$/u.test(part)) || "";
}

function derivePrimaryNeedAnchors(approvedCopy: string): string[] {
  const sourceAnchors = extractPrimaryNeedSourceAnchors(approvedCopy);
  const bodySite = extractBodySiteHint(approvedCopy);
  const taskAnchors = sourceAnchors.map((sourceAnchor) => {
    if (USER_TASK_PATTERN.test(sourceAnchor)) return sourceAnchor;
    const subject = sourceAnchor
      .replace(PRODUCT_FORM_SUFFIX_PATTERN, "")
      .replace(/远红外|理疗技术|技术/gu, "")
      .trim();
    if (!subject) return bodySite ? `${bodySite}日常护理` : "日常使用护理";
    if (USER_TASK_PATTERN.test(subject)) return subject;
    return bodySite
      ? `围绕${subject}相关的${bodySite}进行日常护理`
      : `围绕${subject}相关需求进行日常护理`;
  });
  return taskAnchors.filter((value, index) => taskAnchors.indexOf(value) === index);
}

const FORBIDDEN_SCENE_TERMS = [
  "医院", "诊室", "医生", "护士", "患者", "术后", "治疗", "治愈", "疗效", "前后对比", "使用前", "使用后",
  "红肿", "泛红", "破损", "流血", "疼痛", "刺痛", "灼热", "发烫", "痛苦", "不适", "症状", "创口", "伤口",
  "痕迹", "疗愈",
  "瓶身", "瓶子", "罐体", "罐装", "软管", "管身", "盒装", "纸盒", "容器", "标签区域", "包装形态",
  "泵头", "按压", "外壁", "商品表面", "商品主体", "持握", "托住", "取用", "控制部件", "开盖", "旋盖", "倒出", "挤出", "喷出",
  "数据可视化", "数据界面", "操作界面", "仪表盘", "显示屏", "屏幕文字",
  "抵御细菌", "即时安抚", "医疗级", "医用级", "敏感肌", "特殊医疗护理", "经过验证", "专业护理手段", "协同作用", "持续连接", "标准配置", "证书", "奖状", "促销", "折扣",
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
          locationConcept: { type: "string", enum: SCENE_LOCATION_CONCEPTS },
          userNeed: { type: "string", minLength: 4, maxLength: 80 },
          consumerMoment: { type: "string", minLength: 4, maxLength: 80 },
          environment: { type: "string", minLength: 4, maxLength: 80 },
          mood: { type: "string", minLength: 4, maxLength: 80 },
          interaction: { type: "string", minLength: 4, maxLength: 80 }
        },
        required: ["locationConcept", "userNeed", "consumerMoment", "environment", "mood", "interaction"],
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
  if (label.endsWith(".userNeed") && /(官方正品|无菌|器械|成分|技术)/u.test(text)) {
    throw new Error(`Local Qwen scene field ${label} used a feature or credential as a user need: ${text}.`);
  }
  if (/手持(?:当前)?(?:商品|产品|包装)/u.test(text)) {
    throw new Error(`Local Qwen scene field ${label} guessed a product-holding action.`);
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
  const primaryNeedAnchors = derivePrimaryNeedAnchors(approvedCopy);
  const primaryNeedAnchor = primaryNeedAnchors.join("；");
  return [
    `【本地场景规划契约 ${LOCAL_QWEN_SCENE_PLANNER_VERSION}】`,
    `当前商品：${productName}`,
    approvedCopy,
    `主要用户任务锚点（不可被核心卖点替换）：${primaryNeedAnchor}`,
    "先从已审核产品文案中识别用户为什么会需要当前商品，再规划5个互不重复、真实可拍、能促成理解与购买的场景。每个场景只描述locationConcept、userNeed、consumerMoment、environment、mood、interaction六项。",
    "userNeed必须是用户要完成的事情或要解决的真实使用需求，并直接来自商品名称、通用名称和已审核文案；上面的锚点已经由程序改写成可执行的用户任务，优先原样使用该任务措辞，不得原样复制商品名、主标题或副标题充当需求；不得退回商品名、主标题或副标题。场景必须让目标用户一眼看懂‘这正是我需要它的时刻’。",
    "五个userNeed都必须直接重述上面的同一个主要用户任务锚点，不得用后面的核心卖点替换、扩展或另起次级用途。核心卖点只能作为画面中的选择理由或信任证据，永远不能决定消费场景。若锚点含防晒，五个需求都必须明确是日晒或紫外线环境下的面部防晒，不得写成创面、晒后修复、敏感肌护理、无菌护理或正品查验；只选阳光暴露明确、需求强烈的白天场景，不选夕阳、夜晚或缺少日晒动机的场景。",
    "官方正品、无菌型、器械等级、成分、技术和包装特点属于信任证据或产品特征，不得单独当成userNeed。不要把5条卖点机械改写成5个需求；允许多个场景服务同一个核心需求，只要消费时刻真实且不同。",
    "不得把创面相关卖点外推成术后、医院或患者场景，也不得从无菌、防晒、护理等词外推抵御细菌、治疗、即时安抚、医疗级认证或其他未逐字提供的效果。interaction只描述画面中可见的人物姿态、商品位置和环境关系，不写协同作用、持续连接、标准配置等抽象功效结论。",
    "不得描述或猜测包装形态、瓶管盒罐、容器、标签、颜色、规格、成分、适用人群、治疗结果、医院医生、前后对比、其他商品或任何新增文字。",
    "consumerMoment只回答何时、何地发生消费需求，不写商品接触动作、包装结构或身体异常；interaction只写人与商品或使用部位的高层关系，不写拿、握、托、按、挤、喷、开盖、取用等具体包装动作。",
    "人物、手部、使用部位、纯商品、步骤、材质原理、配色和光线都只是可选表现手段；只在能更准确解释当前userNeed和consumerMoment时使用，禁止为了凑固定模板强加。",
    "userNeed和consumerMoment使用积极的任务表达，不用红肿、疼痛、焦虑等身体异常或痛苦来制造需求；不得呈现伤口、治疗过程、使用前后对比或夸大结果。",
    "五个场景的时间、地点或互动方式必须形成有意义的差异；多个场景可以服务同一核心需求，但必须对应不同的真实消费时刻，而不是换背景重复摆拍。",
    "每个对象必须写出一个具体可拍地点，不能只写‘户外空间、公共场所、自然场景、生活空间’等泛化背景；每个对象的地点与动作必须属于同一消费时刻。五个对象使用五类不同地点，不得重复海边、公园露营、城市街道、车内、运动场、办公室、居家护理、商场、露台、餐厨或交通酒店等地点概念；室外环境不得搭配洗漱台、梳妆台等室内互动。",
    `为保证程序可审计，locationConcept只能从${SCENE_LOCATION_CONCEPTS.join("、")}中选择；五个对象必须选择五个不同类别。consumerMoment和environment必须明确描述并且只命中所选类别，不能包含第二个地点类别或使用二选一；不要使用吸烟区、普通广场、泛化户外空间等分类表之外的地点。`,
    "每个场景都必须通过时间、地点或自然使用关系直接体现当前商品用途，让人不看海报文字也能理解为什么此刻需要该商品；禁止输出可被任意护理品、药品或器械套用的通用场景。",
    "严格按JSON schema输出，不要解释。"
  ].join("\n");
}

export function validateLocalQwenSceneRecords(
  value: unknown,
  options: QwenSceneValidationOptions = {}
): QwenSceneRecord[] {
  const scenes = (value as { scenes?: unknown[] } | null)?.scenes;
  if (!Array.isArray(scenes) || scenes.length !== 5) {
    throw new Error(`Local Qwen must return exactly 5 scene records, got ${Array.isArray(scenes) ? scenes.length : 0}.`);
  }
  const normalized = scenes.map((scene, index) => {
    const item = scene as Partial<QwenSceneRecord>;
    if (!isSceneLocationConcept(item.locationConcept)) {
      throw new Error(`Local Qwen scene ${index + 1} locationConcept is invalid: ${String(item.locationConcept || "missing")}.`);
    }
    return {
      locationConcept: item.locationConcept,
      userNeed: normalizeSceneField(item.userNeed, `${index + 1}.userNeed`),
      consumerMoment: normalizeSceneField(item.consumerMoment, `${index + 1}.consumerMoment`),
      environment: normalizeSceneField(item.environment, `${index + 1}.environment`),
      mood: normalizeSceneField(item.mood, `${index + 1}.mood`),
      interaction: normalizeSceneField(item.interaction, `${index + 1}.interaction`)
    };
  });
  const disallowedExactNeeds = new Set(
    (options.disallowedExactUserNeeds || []).map(normalizeNeedComparison).filter(Boolean)
  );
  normalized.forEach((scene, index) => {
    if (disallowedExactNeeds.has(normalizeNeedComparison(scene.userNeed))) {
      throw new Error(`Local Qwen scene ${index + 1} copied a product title instead of expressing a user job.`);
    }
    if (OUTDOOR_SCENE_PATTERN.test(scene.environment) && INDOOR_SCENE_PATTERN.test(scene.interaction)) {
      throw new Error(`Local Qwen scene ${index + 1} mixes an outdoor environment with an indoor interaction.`);
    }
    if (INDOOR_SCENE_PATTERN.test(scene.environment) && OUTDOOR_SCENE_PATTERN.test(scene.interaction)) {
      throw new Error(`Local Qwen scene ${index + 1} mixes an indoor environment with an outdoor interaction.`);
    }
  });
  for (const key of ["consumerMoment", "environment", "interaction"] as const) {
    if (new Set(normalized.map((scene) => scene[key])).size !== 5) {
      throw new Error(`Local Qwen scene records must use 5 distinct ${key} values.`);
    }
  }
  const usedLocationGroups = new Map<SceneLocationConcept, number>();
  normalized.forEach((scene, index) => {
    const sceneText = `${scene.consumerMoment}${scene.environment}${scene.interaction}`;
    const locationConcept = requireSingleSceneLocationConcept(sceneText, `Local Qwen scene ${index + 1}`);
    if (locationConcept !== scene.locationConcept) {
      throw new Error(
        `Local Qwen scene ${index + 1} locationConcept ${scene.locationConcept} does not match described ${locationConcept}.`
      );
    }
    const previous = usedLocationGroups.get(locationConcept);
    if (previous) {
      throw new Error(`Local Qwen scenes repeat the same ${locationConcept} location concept in scenes ${previous},${index + 1}.`);
    }
    usedLocationGroups.set(locationConcept, index + 1);
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
  return input.scenes.map((scene) => [
    `地点类别：${scene.locationConcept}。`,
    `用户需求：${scene.userNeed}。`,
    `消费者时刻：${scene.consumerMoment}。`,
    `环境：${scene.environment}。`,
    `氛围：${scene.mood}。`,
    `互动关系：${scene.interaction}。`,
    "需求匹配：人物、局部、纯商品、步骤、配色与道具都只在有助于解释上述用户需求时使用，不为凑模板强加。",
    `当前商品仅指${input.productName.trim()}；完整参考商品组必须原样、成组、最大且最清晰地位于前景，包装数量、文字、比例、颜色和标识只以参考图为准。`,
    "场景不得出现症状、伤口、医院医生、治疗结果、前后对比、其他商品、促销元素或任何额外可读文字。"
  ].join(""));
}

function simulatedSceneRecords(): QwenSceneRecord[] {
  return [
    { locationConcept: "city-street", userNeed: "在真实生活中满足当前商品的核心用途", consumerMoment: "晨间城市通勤前的准备", environment: "阳光明亮的城市商业街区", mood: "清新克制", interaction: "人物与商品形成自然关系" },
    { locationConcept: "home-care", userNeed: "在真实生活中满足当前商品的核心用途", consumerMoment: "午后居家日常使用", environment: "整洁的卧室梳妆台", mood: "自然松弛", interaction: "商品位于卧室日常使用区域" },
    { locationConcept: "park-camping", userNeed: "在真实生活中满足当前商品的核心用途", consumerMoment: "户外活动开始前的准备时刻", environment: "明亮开阔的公园草坪", mood: "积极可信", interaction: "商品与公园活动建立直接视觉联系" },
    { locationConcept: "office", userNeed: "在真实生活中满足当前商品的核心用途", consumerMoment: "工作间隙安排日常使用时", environment: "整洁有序的办公室工位", mood: "从容明确", interaction: "商品位于办公室需求发生的自然位置" },
    { locationConcept: "sports", userNeed: "在真实生活中满足当前商品的核心用途", consumerMoment: "周末运动间隙的使用时刻", environment: "阳光充足的网球场", mood: "轻松有序", interaction: "人物、商品与运动需求形成清楚关系" }
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
    const host = requireLocalOllamaHost(options.host);
    const response = await fetch(`${host}/api/generate`, {
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
  const approvedCopy = formatSelectedMainImageCopyForPrompt(options.sellingPointText);
  const sourceNeedAnchors = extractPrimaryNeedSourceAnchors(approvedCopy);
  const taskNeedAnchors = derivePrimaryNeedAnchors(approvedCopy);
  const disallowedExactUserNeeds = [productName, ...sourceNeedAnchors];
  const sellingPointDigest = digestMainImagePromptSource(options.sellingPointText);
  fs.writeFileSync(promptFile, `${promptText}\n`, "utf8");

  const model = options.model || process.env.AUTO_LISTING_SCENE_MODEL?.trim() || LOCAL_QWEN_SCENE_MODEL;
  let scenes: QwenSceneRecord[];
  let rawResponse: string;
  let resolvedModel = model;
  if (options.simulateOnly) {
    scenes = validateLocalQwenSceneRecords({ scenes: simulatedSceneRecords() }, { disallowedExactUserNeeds });
    rawResponse = JSON.stringify({ simulated: true, model, scenes }, null, 2);
  } else {
    const attempts: Array<{ attempt: number; rawResponse?: string; error?: string }> = [];
    let validationError = "";
    let validatedScenes: QwenSceneRecord[] | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const correction = validationError
        ? `\n\n上一次输出被程序拒绝：${validationError}\n五个userNeed请直接使用用户任务“${taskNeedAnchors.join("；")}”，不得使用商品名“${disallowedExactUserNeeds.join("；")}”。重新生成全部5个对象，严格消除该问题，不要解释。`
        : "";
      let attemptRawResponse: string | undefined;
      try {
        const result = await callLocalQwen({
          promptText: `${promptText}${correction}`,
          model,
          host: requireLocalOllamaHost(options.host || process.env.OLLAMA_HOST),
          timeoutMs: 10 * 60_000
        });
        attemptRawResponse = result.rawResponse;
        resolvedModel = result.model;
        validatedScenes = validateLocalQwenSceneRecords(result.payload, { disallowedExactUserNeeds });
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
    if (!prompt.includes("用户需求：") || !prompt.includes("需求匹配：") || !prompt.includes("完整参考商品组必须原样")) {
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
