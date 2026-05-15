import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { captureConversation } from "../doubao/capture.js";
import { sanitizeFileName } from "../doubao/paths.js";
import { submitPrompt } from "../doubao/submit.js";
import { launchPersistentBrowser } from "../browser/launch.js";
import type { SellingPointArtifact } from "./types.js";
import { buildDoubaoSellingPointPrompt, getDoubaoConversationTitle, DOUBAO_URL } from "./rule-text.js";

function ensureTaskDir(runtimeDir: string, taskId: string): string {
  const taskDir = path.join(runtimeDir, "tasks", sanitizeFileName(taskId));
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

function writePromptFile(taskDir: string): string {
  const promptFile = path.join(taskDir, "doubao-selling-points-prompt.txt");
  fs.writeFileSync(promptFile, `${buildDoubaoSellingPointPrompt()}\n`, "utf8");
  return promptFile;
}

export function normalizeSellingPointText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/\s+/g, "")
    .replace(/[，、]/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "");
}

function looksLikeSellingPointParagraph(text: string): boolean {
  return (
    text.includes("官方正品") &&
    text.includes("正品保证") &&
    text.includes("匠心甄选") &&
    text.includes("不展示批准文号信息") &&
    /医疗器械认证|蓝帽保健食品认证|OTC药品认证/.test(text)
  );
}

function extractCandidateParagraphs(rawText: string): string[] {
  const normalizedRaw = normalizeSellingPointText(rawText);
  const lineCandidates = rawText
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => normalizeSellingPointText(line))
    .filter(Boolean)
    .filter(looksLikeSellingPointParagraph);

  if (lineCandidates.length > 0) {
    return lineCandidates;
  }

  const tailAnchor = "不展示批准文号信息";
  const tailIndex = normalizedRaw.lastIndexOf(tailAnchor);
  if (tailIndex >= 0) {
    const tailText = normalizedRaw.slice(0, tailIndex + tailAnchor.length);
    const thirdPointMarkers = ["医疗器械认证", "蓝帽保健食品认证", "OTC药品认证"];
    const thirdPointStart = thirdPointMarkers
      .map((marker) => tailText.lastIndexOf(marker))
      .filter((index) => index >= 0)
      .sort((a, b) => b - a)[0];

    if (thirdPointStart >= 0) {
      const prefixSlice = tailText.slice(0, thirdPointStart);
      const prefixTokens = prefixSlice.split(",").map((item) => item.trim()).filter(Boolean);
      if (prefixTokens.length >= 2) {
        const startTokenIndex = Math.max(0, prefixTokens.length - 2);
        const candidate = `${prefixTokens.slice(startTokenIndex).join(",")},${tailText.slice(thirdPointStart)}`;
        if (looksLikeSellingPointParagraph(candidate)) {
          return [candidate];
        }
      }
    }
  }

  return [];
}

function extractBrand(userCognitionName: string, brandedGenericName: string): string {
  const normalizedUser = normalizeSellingPointText(userCognitionName);
  const normalizedBranded = normalizeSellingPointText(brandedGenericName);
  if (!normalizedBranded || normalizedBranded === normalizedUser) {
    return "";
  }

  const descriptors = ["医用", "喷剂", "喷雾", "凝胶", "软膏", "乳膏", "乳霜", "膏贴", "贴", "冷敷", "热敷", "敷贴"];
  const positions = descriptors.map((item) => normalizedBranded.indexOf(item)).filter((index) => index > 0);
  const cutIndex = positions.length ? Math.min(...positions) : -1;
  const candidate = cutIndex > 0 ? normalizedBranded.slice(0, cutIndex) : "";
  if (!candidate || candidate.length < 2 || candidate.length > 8 || candidate === normalizedUser) {
    return "";
  }
  return candidate;
}

export function validateSellingPointText(text: string): {
  normalizedText: string;
  segments: string[];
  brand: string;
  userCognitionName: string;
  brandedGenericName: string;
  segmentCount: number;
} {
  const normalizedText = normalizeSellingPointText(text);
  if (!looksLikeSellingPointParagraph(normalizedText)) {
    throw new Error("Doubao selling points did not contain the required fixed markers.");
  }

  const segments = normalizedText.split(",").map((item) => item.trim()).filter(Boolean);
  if (segments.length < 8) {
    throw new Error(`Doubao selling points looked incomplete, got only ${segments.length} token(s).`);
  }

  const userCognitionName = segments[0] || "";
  const brandedGenericName = segments[1] || "";
  if (!userCognitionName || !brandedGenericName) {
    throw new Error("Doubao selling points must expose user cognition name and branded generic name in the first two positions.");
  }

  return {
    normalizedText,
    segments,
    brand: extractBrand(userCognitionName, brandedGenericName),
    userCognitionName,
    brandedGenericName,
    segmentCount: segments.length
  };
}

function buildSimulatedArtifact(taskDir: string): SellingPointArtifact {
  const promptFile = writePromptFile(taskDir);
  const rawFile = path.join(taskDir, "doubao-selling-points-raw.txt");
  const screenshotFile = path.join(taskDir, "doubao-selling-points.png");
  const sellingPointText = [
    "宝元堂医用膝盖喷剂",
    "宝元堂膝盖部位医用喷剂",
    "医疗器械认证",
    "成分科学严谨",
    "不添加科技狠活",
    "官方正品",
    "正品保证",
    "匠心甄选",
    "远红外陶瓷粉",
    "30g/瓶",
    "为膝盖不适问题研发",
    "为关节护理人群研发",
    "图示产品使用步骤",
    "突出产品的使用部位",
    "不展示批准文号信息"
  ].join(",");
  fs.writeFileSync(rawFile, `${sellingPointText}\n`, "utf8");

  const validated = validateSellingPointText(sellingPointText);
  return {
    promptFile,
    rawFile,
    screenshotFile,
    sellingPointText: validated.normalizedText,
    segments: validated.segments,
    brand: validated.brand,
    userCognitionName: validated.userCognitionName,
    brandedGenericName: validated.brandedGenericName,
    segmentCount: validated.segmentCount,
    simulated: true
  };
}

async function tryReuseDoubaoHistoryConversation(page: Page): Promise<void> {
  const conversationTitle = getDoubaoConversationTitle();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (bodyText.includes(conversationTitle)) {
    return;
  }

  const historyLinks = page.locator('a[href*="/chat/"]');
  const count = await historyLinks.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const link = historyLinks.nth(index);
    const text = ((await link.innerText().catch(() => "")) || "").trim();
    if (!text.includes(conversationTitle)) {
      continue;
    }
    await link.click({ delay: 80 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1200);
    return;
  }
}

export async function generateSellingPointsWithDoubao(options: {
  runtimeDir: string;
  taskId: string;
  imagePath: string;
  imageName: string;
  simulateOnly: boolean;
}): Promise<SellingPointArtifact> {
  const taskDir = ensureTaskDir(options.runtimeDir, options.taskId);
  if (options.simulateOnly) {
    return buildSimulatedArtifact(taskDir);
  }

  const promptFile = writePromptFile(taskDir);
  const rawFile = path.join(taskDir, "doubao-selling-points-raw.txt");
  const screenshotFile = path.join(taskDir, "doubao-selling-points.png");

  const context = await launchPersistentBrowser();
  const page =
    context.pages().find((item) => !item.isClosed() && item.url().startsWith(DOUBAO_URL)) ||
    context.pages().find((item) => !item.isClosed()) ||
    (await context.newPage());
  await page.bringToFront();
  if (!page.url().startsWith(DOUBAO_URL)) {
    await page.goto(DOUBAO_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
  }
  await tryReuseDoubaoHistoryConversation(page);
  const activeConversationUrl = page.url();

  const submitResult = await submitPrompt({
    imagePath: options.imagePath,
    promptFile,
    conversationUrl: activeConversationUrl
  });
  const captureResult = await captureConversation({
    outputDir: taskDir,
    rawFileOut: rawFile,
    screenshotOut: screenshotFile,
    waitMs: 20000,
    conversationUrl: activeConversationUrl,
    mode: "selling_points"
  });

  const candidate = extractCandidateParagraphs(fs.readFileSync(rawFile, "utf8")).at(-1);
  if (!candidate) {
    throw new Error("Could not isolate Doubao selling points from captured conversation.");
  }

  const validated = validateSellingPointText(candidate);
  return {
    promptFile,
    rawFile,
    screenshotFile,
    sellingPointText: validated.normalizedText,
    segments: validated.segments,
    brand: validated.brand,
    userCognitionName: validated.userCognitionName,
    brandedGenericName: validated.brandedGenericName,
    segmentCount: validated.segmentCount,
    submittedAt: submitResult.submittedAt,
    capturedAt: captureResult.capturedAt,
    simulated: false
  };
}
