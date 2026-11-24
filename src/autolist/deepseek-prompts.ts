import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/path-names.js";
import type { DeepSeekArtifact } from "./types.js";
import type { FeishuProductRecord } from "../feishu/types.js";
import { assertDeepSeekPromptsBelongToCurrentProduct, buildDeepSeekPromptValidationContext } from "./deepseek-prompt-rules.js";
import { getProductCategoryPlan } from "./product-category.js";
import { submitDeepSeekPrompt } from "./deepseek-browser-action.js";
import { digestMainImagePromptSource } from "./main-image-prompt-revision-rules.js";
import { formatSelectedMainImageCopyForPrompt } from "./selling-point-rules.js";

export const DEEPSEEK_POSTER_INSTRUCTION =
  "只为当前产品输出5行互不重复的产品相关场景素材，每行是一段逗号分隔的关键词，不要编号、标题或解释。每行必须包含当前产品名称、成分、使用部位或当前卖点中的至少一个明确锚点，并描述与该产品直接相关的真实环境、使用关系、成分材质或操作步骤。五行的场景语义和道具组合必须不同，不得混入其他商品、其他包装或无关器械。不要指定主色、字体、版式、镜头、产品位置、艺术风格、渲染软件、奖章或装饰模板；这些由后续生图模块统一决定。保持参考产品包装事实不变。";

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
  const sellingPoints = formatSelectedMainImageCopyForPrompt(sellingPointText);
  if (!sellingPoints) throw new Error("DeepSeek prompt generation requires generated 产品卖点.");
  return `${sellingPoints}\n\n${DEEPSEEK_POSTER_INSTRUCTION}`;
}

export function parseDeepSeekPosterPrompts(text: string): string[] {
  const lines = text.replace(/\r/g, "\n").split(/\n+/).map(cleanPromptParagraph)
    .filter((line) => line.split(",").filter(Boolean).length >= 5)
    .filter((line) => !line.includes("100-150个字之间") && !line.includes("设计出5款电商海报"));
  return Array.from(new Set(lines)).slice(-5);
}

export function validatePosterPrompts(prompts: string[], record: {
  sellingPointText: string;
  userCognitionName?: string;
  brandedGenericName?: string;
  genericName?: string;
}, promptCount: number): string[] {
  if (prompts.length !== promptCount) throw new Error(`DeepSeek must return ${promptCount} keyword paragraphs, got ${prompts.length}.`);
  for (const prompt of prompts) {
    if (prompt.split(",").filter(Boolean).length < 5) throw new Error(`DeepSeek paragraph is not keyword-like enough: ${prompt}`);
  }
  assertDeepSeekPromptsBelongToCurrentProduct(prompts, buildDeepSeekPromptValidationContext(record), promptCount);
  return prompts;
}

export function recoverValidPosterPromptsFromRaw(options: {
  taskDir: string;
  record: {
    sellingPointText: string;
    userCognitionName?: string;
    brandedGenericName?: string;
    genericName?: string;
  };
  promptCount: number;
}): { prompts: string[]; rawFile: string; screenshotFile: string } | undefined {
  const candidates = [
    { rawFile: path.join(options.taskDir, "deepseek-retry-2-raw.txt"), screenshotFile: path.join(options.taskDir, "deepseek-retry-2.png") },
    { rawFile: path.join(options.taskDir, "deepseek-retry-1-raw.txt"), screenshotFile: path.join(options.taskDir, "deepseek-retry-1.png") },
    { rawFile: path.join(options.taskDir, "deepseek-raw.txt"), screenshotFile: path.join(options.taskDir, "deepseek.png") }
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.rawFile)) continue;
    try {
      const prompts = validatePosterPrompts(
        parseDeepSeekPosterPrompts(fs.readFileSync(candidate.rawFile, "utf8")),
        options.record,
        options.promptCount
      );
      return { prompts, ...candidate };
    } catch {
      // A partial or obsolete attempt is ignored; only a complete current-product reply may resume.
    }
  }
  return undefined;
}

function simulatedPrompts(sellingPointText: string): string[] {
  const headline = sellingPointText.match(/突出放大的有设计感的艺术字：([^，]+)/)?.[1] || "产品护理";
  return [
    `${headline}产品使用部位护理场景,参考产品包装事实保持不变,真实使用关系,与当前卖点有关的护理道具,场景元素只服务当前产品`,
    `${headline}产品日常使用环境,对应使用部位局部展示,与当前产品直接相关的生活物品,包装事实保持不变,不混入其他商品`,
    `${headline}产品成分或材质解析场景,当前卖点相关微观结构,产品与成分关系清晰,不引入无关器械,参考包装事实保持不变`,
    `${headline}产品包装与核心卖点展示场景,参考包装数量与信息保持不变,只使用当前产品相关元素,对应使用关系清晰,不引入其他包装`,
    `${headline}产品连续使用方法场景,对应使用部位与操作步骤明确,包装事实保持不变,不混入其他商品,场景道具与当前用途直接相关`
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
    const selectedSellingPoints = parts.slice(3, 8);
    const valid = parts.length === 10 && /^突出放大的有设计感的艺术字：.+/.test(parts[0]) &&
      /^尺寸略小一些的有设计感的艺术字：.+/.test(parts[1]) && parts[2] === "官方正品" &&
      new Set(selectedSellingPoints).size === 5 &&
      parts[8] === "图示产品的使用步骤" && parts[9] === "突出产品使用部位";
    if (valid) return [];
    return [{ recordId: record.recordId, rowNumber: index + 1, userCognitionName: record.userCognitionName, spu: record.spu,
      requiredPromptCount: getProductCategoryPlan(record.productCategory).promptCount,
      message: "产品卖点必须使用固定整段结构，并填入1个主图主标题、1个主图副标题和5个不同主图卖点。" }];
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
  if (savedPromptMatches) {
    if (fs.existsSync(extractedFile)) {
      try {
        const prompts = validatePosterPrompts(parseDeepSeekPosterPrompts(fs.readFileSync(extractedFile, "utf8")), validationRecord, 5);
        return { promptFile, rawFile, extractedFile, screenshotFile, prompts, sellingPointDigest, simulated: false };
      } catch {
        // The saved extraction is incomplete or belongs to an obsolete reply; inspect exact raw attempts below.
      }
    }
    const recovered = recoverValidPosterPromptsFromRaw({ taskDir, record: validationRecord, promptCount: 5 });
    if (recovered) {
      fs.writeFileSync(extractedFile, `${recovered.prompts.join("\n")}\n`, "utf8");
      return { promptFile, rawFile: recovered.rawFile, extractedFile, screenshotFile: recovered.screenshotFile,
        prompts: recovered.prompts, sellingPointDigest, simulated: false };
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
