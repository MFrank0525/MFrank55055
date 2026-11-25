import path from "node:path";

export const DEFAULT_MAIN_IMAGE_FRAME_FILE = path.resolve(
  process.cwd(),
  "assets",
  "auto-listing",
  "default-main-image-frame-v2.png"
);

export const MAIN_IMAGE_FRAME_EXCLUDED_BRANDS = ["宝元堂", "久光小泽"] as const;
export const MAIN_IMAGE_FRAME_LAYOUT_VERSION = "full-bleed-visible-frame-guide-v4";

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
  "【最高优先级固定品牌区】唯一参考图已经把当前白底商品与最终固定品牌框合成在同一张1:1画布中；左上角可见品牌框是不可移动、不可覆盖的已占用前景层，必须围绕其真实位置重新设计整张海报。",
  "左上角横向0%–63%、纵向0%–15%为品牌框硬占位区。主标题、副标题、卖点文字、商品、人物、手部、步骤图、图标和装饰不得放在品牌框下方、不得与其重叠或相切；主标题任何笔画的顶边必须低于纵向18%，副标题和卖点必须继续向下排布。",
  "参考图中的品牌框只用于提供精确空间占位，不属于可重新设计的商品包装；不得放大、延长、复制、仿制或在其右侧续接相似条带，也不得新增品牌文字、Logo、印章或阴影。",
  "画面保持800×800满版，背景和光影延展到四边，充分利用品牌区之外的空间；不得缩成小图、留空边、模糊包边、套娃或卡片内框。",
  "程序会在生成后于原尺寸逐像素覆盖一次真实品牌框，不会缩放、裁切或移动生成结果；因此所有有效内容必须在生成阶段就避开品牌框。"
].join("");
