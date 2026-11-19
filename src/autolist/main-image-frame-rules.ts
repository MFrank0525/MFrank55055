import path from "node:path";

export const DEFAULT_MAIN_IMAGE_FRAME_FILE = path.resolve(
  process.cwd(),
  "assets",
  "auto-listing",
  "default-main-image-frame.png"
);

export const MAIN_IMAGE_FRAME_EXCLUDED_BRANDS = ["宝元堂", "久光小泽"] as const;
export const MAIN_IMAGE_FRAME_LAYOUT_VERSION = "full-bleed-layout-guide-v2";

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
  "【最高优先级满版构图硬约束】输入的唯一参考图已经把白底商品与最终固定品牌图框合成在同一张1:1画布中；左上角现有的延草纲目品牌条和徽标是不可移动的已占用前景层，必须围绕它重新设计整张海报版式。参考图中的品牌条必须保持原位置、原尺寸和原边界，禁止放大、横向延长、复制、仿制或在其右侧续接相似的米色条带。",
  "左上角横向0%至63%、纵向0%至15%是品牌条实际占位区。主标题、副标题、卖点文字、产品主体、使用步骤、使用部位、人物、手部、图标、徽章和其他有效内容不得放在该品牌条下方、不得与它重叠或相切。长主标题任何笔画的顶边必须位于画布纵向18%以下（按800像素画布即y不得小于144），副标题必须在主标题下方；右上角未被品牌条占用的区域可以继续用于自然背景和装饰光效，但不得用它把长标题重新抬高。",
  "海报必须保持800×800满版视觉：背景、场景和光影延展到四边，主体与信息模块按正常电商主图比例充分利用画布。禁止把整张海报缩成居中的小图，禁止四周留出空边，禁止用大面积模糊背景包围小图，禁止套娃、卡片式内框或人为压缩全部内容。",
  "必须根据左上角品牌条重新组织标题、商品、卖点和步骤图的相对位置，而不是先按普通方图排版再留一条空带。除品牌条真实占位外，其他区域都应被协调利用，整体层级、字号、商品占比和视觉密度保持高质量传统电商主图水准。",
  "输出后程序只会在原尺寸上逐像素覆盖一次原始固定图框，不会缩放、裁切或移动海报；因此所有有效内容必须在生成阶段就与图框适配。"
].join("");
export const MAIN_IMAGE_FRAME_POLICY_COMPATIBLE_PROMPT_CONTRACT = [
  "【最高优先级满版构图硬约束】输入参考图左上角已有固定品牌图框，保持其原位置、原尺寸和原边界，不复制、不延长、不重绘。",
  "左上角横向0%至63%、纵向0%至15%为已占用区域；所有新增标题、标签、商品和装饰均放在该区域之外，标题顶边不得高于画布纵向18%。",
  "保持800×800满版视觉，背景与光影自然延展到四边，商品清晰放大并充分利用剩余画布；禁止缩成居中小图、四周空边、模糊包边、卡片内框或套娃布局。",
  "程序只会在原尺寸覆盖固定图框，不会缩放、裁切或移动生成结果。"
].join("");
