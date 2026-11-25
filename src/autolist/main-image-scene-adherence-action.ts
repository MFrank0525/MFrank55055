import fs from "node:fs";
import path from "node:path";
import { requireLocalOllamaHost } from "./local-ollama-rules.js";
import {
  assertMainImageSceneAdherenceReport,
  isMainImageSceneAdherenceAccepted,
  LOCAL_QWEN_VISION_MODEL,
  MAIN_IMAGE_SCENE_ADHERENCE_GATE_VERSION,
  type MainImageSceneAdherenceItem,
  type MainImageSceneAdherenceReport,
  validateMainImageSceneAdherencePayload
} from "./main-image-scene-adherence-rules.js";
import { SCENE_LOCATION_CONCEPTS } from "./scene-location-rules.js";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    needMatch: { type: "boolean" },
    environmentMatch: { type: "boolean" },
    interactionMatch: { type: "boolean" },
    productVisible: { type: "boolean" },
    brandFrameClear: { type: "boolean" },
    observedLocationConcept: { type: "string", enum: SCENE_LOCATION_CONCEPTS },
    observedScene: { type: "string" },
    reasons: { type: "array", items: { type: "string" }, minItems: 1 }
  },
  required: ["needMatch", "environmentMatch", "interactionMatch", "productVisible", "brandFrameClear", "observedLocationConcept", "observedScene", "reasons"],
  additionalProperties: false
} as const;

async function inspectOne(options: {
  imageIndex: number;
  imageFile: string;
  scenePrompt: string;
  host: string;
  model: string;
}): Promise<MainImageSceneAdherenceItem> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60_000);
  try {
    const prompt = [
      "你是电商主图验收员。只根据画面中真实可见的环境、人物、动作、商品和固定品牌框判断，不要因为海报文字提到了某个卖点就判定场景匹配。",
      `目标场景：${options.scenePrompt}`,
      "needMatch：画面是否让用户直观看懂目标用户需求；environmentMatch：主要环境是否符合目标消费时刻；interactionMatch：人物/商品关系是否符合，若目标允许可选人物而画面用清楚的纯商品场景表达同一需求，可判 true；productVisible：参考商品组是否完整清晰；brandFrameClear：左上固定品牌框是否完整且未被标题或装饰遮挡。",
      `observedLocationConcept：只按画面占主导的真实地点从 ${SCENE_LOCATION_CONCEPTS.join(", ")} 中选择一个；沙滩、海边和海滩统一选 beach，不得根据目标文字猜测。`,
      "严格输出 JSON。"
    ].join("\n");
    const response = await fetch(`${options.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        stream: false,
        think: false,
        format: RESPONSE_SCHEMA,
        messages: [{
          role: "user",
          content: prompt,
          images: [fs.readFileSync(options.imageFile).toString("base64")]
        }],
        options: { temperature: 0 }
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Local vision scene audit failed with HTTP ${response.status}: ${raw.slice(0, 500)}`);
    }
    const envelope = JSON.parse(raw) as { model?: string; message?: { content?: string } };
    if (!envelope.message?.content) throw new Error("Local vision scene audit returned no response content.");
    const payload = validateMainImageSceneAdherencePayload(JSON.parse(envelope.message.content));
    return {
      imageIndex: options.imageIndex,
      imageFile: options.imageFile,
      scenePrompt: options.scenePrompt,
      model: envelope.model || options.model,
      ...payload
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectMainImageSceneAdherence(options: {
  images: Array<{ imageIndex: number; imageFile: string; scenePrompt: string }>;
  reportFile: string;
  host?: string;
  model?: string;
  concurrency?: number;
  onProgress?: (message: string) => void;
}): Promise<MainImageSceneAdherenceReport> {
  const host = requireLocalOllamaHost(options.host || process.env.OLLAMA_HOST);
  const model = options.model || LOCAL_QWEN_VISION_MODEL;
  if (model !== LOCAL_QWEN_VISION_MODEL) {
    throw new Error(`Local vision scene audit model must be ${LOCAL_QWEN_VISION_MODEL}, got ${model}.`);
  }
  const items = new Array<MainImageSceneAdherenceItem>(options.images.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < options.images.length) {
      const current = nextIndex;
      nextIndex += 1;
      const input = options.images[current];
      const item = await inspectOne({ ...input, host, model });
      items[current] = item;
      options.onProgress?.(
        `Local vision scene gate image ${item.imageIndex}: ${isMainImageSceneAdherenceAccepted(item) ? "passed" : "rejected"}.`
      );
    }
  };
  const concurrency = Math.max(1, Math.min(options.concurrency || 2, options.images.length || 1));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const report: MainImageSceneAdherenceReport = {
    ok: items.every(isMainImageSceneAdherenceAccepted),
    gateVersion: MAIN_IMAGE_SCENE_ADHERENCE_GATE_VERSION,
    model,
    items
  };
  fs.mkdirSync(path.dirname(options.reportFile), { recursive: true });
  fs.writeFileSync(options.reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function assertMainImageSceneAdherence(options: Parameters<typeof inspectMainImageSceneAdherence>[0]): Promise<MainImageSceneAdherenceReport> {
  return assertMainImageSceneAdherenceReport(await inspectMainImageSceneAdherence(options));
}
