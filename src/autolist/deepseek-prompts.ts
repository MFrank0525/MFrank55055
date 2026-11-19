import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/path-names.js";
import type { DeepSeekArtifact } from "./types.js";
import type { FeishuProductRecord } from "../feishu/types.js";
import { assertDeepSeekPromptsBelongToCurrentProduct, buildDeepSeekPromptValidationContext } from "./deepseek-prompt-rules.js";
import { getProductCategoryPlan } from "./product-category.js";
import { submitDeepSeekPrompt } from "./deepseek-browser-action.js";
import { digestMainImagePromptSource } from "./main-image-prompt-revision-rules.js";

export const DEEPSEEK_POSTER_INSTRUCTION =
  "设计出5款电商海报，要产品在对应部位使用的静态场景，海报场景元素要丰富，用文字描述海报的视觉设计。且你回复我的每款的格式要求是：由很多个关键词组成的段落，关键词之间用逗号隔开，不要太繁琐。场景要明亮，100-150个字之间，不要修改我的包装，不能在包装上加任何字，场景要丰富些，突出产品图在图片上的占比。";

function ensureTaskDir(runtimeDir: string, taskId: string): string {
  const taskDir = path.join(runtimeDir, "tasks", sanitizeFileName(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

function cleanPromptParagraph(value: string): string {
  return value.replace(/\r/g, "")
    .replace(/^\s*(?:[-*•]\s*)?(?:第?[一二三四五六七八九十]+[款段条]?|[0-9]{1,2})?\s*[、.．:：)）\]-]?\s*/, "")
    .trim().replace(/[，、]/g, ",").replace(/\s+/g, "").replace(/,+/g, ",").replace(/^,|,$/g, "");
}

export function buildDeepSeekPosterPrompt(sellingPointText: string): string {
  const sellingPoints = sellingPointText.trim();
  if (!sellingPoints) throw new Error("DeepSeek prompt generation requires generated 产品卖点.");
  return `${sellingPoints}\n\n${DEEPSEEK_POSTER_INSTRUCTION}`;
}

export function parseDeepSeekPosterPrompts(text: string): string[] {
  const lines = text.replace(/\r/g, "\n").split(/\n+/).map(cleanPromptParagraph)
    .filter((line) => line.split(",").filter(Boolean).length >= 5)
    .filter((line) => !line.includes("100-150个字之间") && !line.includes("设计出5款电商海报"));
  return Array.from(new Set(lines)).slice(-5);
}

function validatePosterPrompts(prompts: string[], record: {
  sellingPointText: string;
  userCognitionName?: string;
  brandedGenericName?: string;
  genericName?: string;
}, promptCount: number): string[] {
  if (prompts.length !== promptCount) throw new Error(`DeepSeek must return ${promptCount} keyword paragraphs, got ${prompts.length}.`);
  for (const prompt of prompts) {
    const length = Array.from(prompt.replace(/\s/g, "")).length;
    if (length < 100 || length > 150) throw new Error(`DeepSeek paragraph length must be 100-150 characters, got ${length}.`);
    if (prompt.split(",").filter(Boolean).length < 5) throw new Error(`DeepSeek paragraph is not keyword-like enough: ${prompt}`);
  }
  assertDeepSeekPromptsBelongToCurrentProduct(prompts, buildDeepSeekPromptValidationContext(record), promptCount);
  return prompts;
}

function simulatedPrompts(sellingPointText: string): string[] {
  const headline = sellingPointText.match(/突出放大的有设计感的艺术字：([^，]+)/)?.[1] || "产品护理";
  return [
    `明亮居家晨间护理场景,通透自然窗光,${headline}产品包装完整保持原样,产品主体置于前景占画面约三分之二,对应使用部位局部静态展示,浅色木质台面,柔软毛巾,透明水杯,绿植与收纳托盘丰富层次,细腻高光与柔和阴影,清爽电商海报构图,不在包装添加任何文字`,
    `明亮现代浴室护理场景,暖白镜前灯与自然光交融,${headline}产品包装完整清晰,产品大特写居中占据主要画面,对应使用部位局部静态呈现,大理石台面,白色棉巾,水珠反光,绿植和护理工具点缀,前中后景层次丰富,干净高级商业摄影,包装无新增文字`,
    `明亮卧室梳妆台使用场景,晨光穿过纱帘形成柔和光带,${headline}产品完整包装放大展示,主体占画面约三分之二,对应使用部位局部静态展示,圆镜,棉柔巾,玻璃杯,浅色书本与绿植构成丰富环境,材质纹理清晰,轻盈高光,温暖电商视觉,不改变包装内容`,
    `明亮专业护理空间,均匀冷白光与柔和侧光,${headline}产品包装原貌作为绝对视觉中心,产品图占画面主要比例,对应部位静态使用细节清晰,洁净托盘,棉片,透明器皿,毛巾与小型绿植丰富场景,金属与玻璃反射细腻,空间层次通透,可信赖商业海报质感,包装不加字`,
    `明亮客厅窗边护理场景,大面积自然光营造清透氛围,${headline}产品原包装近景放大并保持全部细节,产品主体占据画面约三分之二,对应使用部位局部静态呈现,浅木茶几,柔软靠垫,水杯,杂志,护理收纳盒与绿植形成丰富生活元素,光影层次柔和,高转化电商构图,包装禁止新增文字`
  ];
}

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
    const valid = parts.length === 8 && /^突出放大的有设计感的艺术字：.+/.test(parts[0]) &&
      /^尺寸略小一些的有设计感的艺术字：.+/.test(parts[1]) && parts[2] === "官方正品" &&
      parts[3] !== parts[4] && parts[3] !== parts[5] && parts[4] !== parts[5] &&
      parts[6] === "图示产品的使用步骤" && parts[7] === "突出产品使用部位";
    if (valid) return [];
    return [{ recordId: record.recordId, rowNumber: index + 1, userCognitionName: record.userCognitionName, spu: record.spu,
      requiredPromptCount: getProductCategoryPlan(record.productCategory).promptCount,
      message: "产品卖点必须使用固定整段结构，并填入1个主图主标题、1个主图副标题和3个不同主图卖点。" }];
  });
  return { ok: errors.length === 0, errors, summary: errors.length
    ? `飞书主图候选词预检失败：${errors.map((error) => `cache item ${error.rowNumber} ${error.recordId}: ${error.message}`).join(" | ")}`
    : `飞书主图候选词预检通过：${records.length} record(s).` };
}

export async function generatePosterPromptsWithDeepSeek(options: {
  runtimeDir: string;
  taskId: string;
  sellingPointText: string;
  userCognitionName?: string;
  brandedGenericName?: string;
  genericName?: string;
  conversationUrl?: string;
  promptCount: number;
  simulateOnly: boolean;
}): Promise<DeepSeekArtifact> {
  if (options.promptCount !== 5) throw new Error(`DeepSeek poster generation requires exactly 5 prompts, got ${options.promptCount}.`);
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  const promptText = buildDeepSeekPosterPrompt(options.sellingPointText);
  const promptFile = path.join(taskDir, "deepseek-poster-prompt.txt");
  const rawFile = path.join(taskDir, "deepseek-raw.txt");
  const extractedFile = path.join(taskDir, "deepseek-extracted.txt");
  const screenshotFile = path.join(taskDir, "deepseek.png");
  const previousPromptText = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, "utf8").trim() : "";
  const savedPromptMatches = previousPromptText === promptText;
  fs.writeFileSync(promptFile, `${promptText}\n`, "utf8");
  const sellingPointDigest = digestMainImagePromptSource(options.sellingPointText);
  const validationRecord = { sellingPointText: options.sellingPointText, userCognitionName: options.userCognitionName,
    brandedGenericName: options.brandedGenericName, genericName: options.genericName };
  if (options.simulateOnly) {
    const prompts = validatePosterPrompts(simulatedPrompts(options.sellingPointText), validationRecord, 5);
    fs.writeFileSync(rawFile, `${prompts.join("\n")}\n`, "utf8");
    fs.writeFileSync(extractedFile, `${prompts.join("\n")}\n`, "utf8");
    return { promptFile, rawFile, extractedFile, screenshotFile, prompts, sellingPointDigest, simulated: true };
  }
  if (fs.existsSync(extractedFile) && savedPromptMatches) {
    try {
      const prompts = validatePosterPrompts(parseDeepSeekPosterPrompts(fs.readFileSync(extractedFile, "utf8")), validationRecord, 5);
      return { promptFile, rawFile, extractedFile, screenshotFile, prompts, sellingPointDigest, simulated: false };
    } catch {
      // The saved reply is incomplete or belongs to an obsolete prompt; generate again below.
    }
  }
  const errors: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const attemptRawFile = attempt === 1 ? rawFile : path.join(taskDir, `deepseek-retry-${attempt - 1}-raw.txt`);
    const attemptScreenshotFile = attempt === 1 ? screenshotFile : path.join(taskDir, `deepseek-retry-${attempt - 1}.png`);
    try {
      const response = await submitDeepSeekPrompt({ conversationUrl: options.conversationUrl, promptText,
        rawFile: attemptRawFile, screenshotFile: attemptScreenshotFile, extractPrompts: parseDeepSeekPosterPrompts });
      const prompts = validatePosterPrompts(response.prompts, validationRecord, 5);
      fs.writeFileSync(extractedFile, `${prompts.join("\n")}\n`, "utf8");
      return { promptFile, rawFile: attemptRawFile, extractedFile, screenshotFile: attemptScreenshotFile, prompts,
        submittedAt: response.submittedAt, capturedAt: response.capturedAt, sellingPointDigest, simulated: false };
    } catch (error) {
      errors.push(`attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`DeepSeek did not produce 5 stable poster prompts after 3 attempts. ${errors.join(" | ")}`);
}
