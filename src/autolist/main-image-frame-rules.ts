import path from "node:path";

export const DEFAULT_MAIN_IMAGE_FRAME_FILE = path.resolve(
  process.cwd(),
  "assets",
  "auto-listing",
  "default-main-image-frame-v2.png"
);

export const MAIN_IMAGE_FRAME_EXCLUDED_BRANDS = ["宝元堂", "久光小泽"] as const;
export const MAIN_IMAGE_FRAME_LAYOUT_VERSION = "post-compose-clean-frame-v3";

function normalizeBrand(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function shouldApplyDefaultMainImageFrame(brand: string): boolean {
  const normalized = normalizeBrand(brand);
  if (!normalized) {
    throw new Error("Main image frame policy requires Feishu brand.");
  }
  return !MAIN_IMAGE_FRAME_EXCLUDED_BRANDS.some((excluded) => normalized.includes(normalizeBrand(excluded)));
}

export const MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT = [
  "【固定品牌区】程序会在生成后覆盖一次真实品牌框；模型不得生成、模仿或延长品牌条、Logo、印章、品牌文字及其阴影。",
  "左上角横向0%–63%、纵向0%–15%只保留连续自然背景，不放标题、商品、人物或图标；主标题顶边必须低于纵向18%。",
  "画面保持800×800满版，背景和光影延展到四边，充分利用品牌区之外的空间；不得缩成小图、留空边、模糊包边、套娃或卡片内框。",
  "程序只在原尺寸逐像素覆盖图框，不会缩放、裁切或移动生成结果。"
].join("");
