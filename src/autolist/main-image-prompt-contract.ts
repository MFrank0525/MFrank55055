import { formatSelectedMainImageCopyForPrompt } from "./selling-point-rules.js";

export const MAIN_IMAGE_PROMPT_CONTRACT_VERSION = "single-source-product-poster-v1";

export const MAIN_IMAGE_SQUARE_PROMPT_CONTRACT =
  "强制画幅约束：最终输出必须为严格的1:1正方形画布（宽度=高度）；不得输出3:4、4:3、2:3、3:2或其他非正方形画幅。完整商品与所有文字、装饰均须在正方形安全区内，不得依赖后续裁剪。";

export const MAIN_IMAGE_FIXED_PROMPT_CONTRACT = [
  `【固定生成契约 ${MAIN_IMAGE_PROMPT_CONTRACT_VERSION}】`,
  "任务：基于唯一一张白底参考图，生成一张高端、可信、适合移动端电商转化的产品主图海报。",
  "产品锁定：参考图是产品外观的唯一事实来源。完整保留包装数量、形状、比例、结构、材质、颜色、图案、品牌标识和包装原有文字；不得改版、替换、增删、遮挡或虚构包装信息。",
  "文案锁定：海报新增文字只能使用下方“已审核产品文案”中的主标题、副标题和卖点，必须保持原意，不得自行新增功效、认证、承诺、促销、参数或品牌口号。中文应清晰、克制、有层级。",
  "视觉目标：产品必须是第一视觉主体；画面简洁高级、光影真实、材质细腻、留白有秩序，在手机缩略图中仍能快速识别产品和核心卖点。卖点集中在一处非对称信息区，避免横跨底部的等宽分栏、徽章阵列和图标堆叠。",
  "执行边界：场景、使用部位、成分或步骤只用于解释当前产品，不得引入其他商品、其他包装、无关器械、虚构证书、平台水印或额外Logo。"
].join("\n");

export function buildMainImageVariablePrompt(input: {
  sellingPointText: string;
  scenePromptText: string;
}): string {
  const sellingPointText = formatSelectedMainImageCopyForPrompt(input.sellingPointText);
  const scenePromptText = input.scenePromptText.trim();
  if (!sellingPointText || !scenePromptText) {
    throw new Error("Main-image variable prompt requires approved product copy and the current product scene.");
  }
  return [
    "【已审核产品文案｜随产品变化】",
    sellingPointText,
    "【当前轮产品场景｜随产品和轮次变化】",
    scenePromptText
  ].join("\n");
}
