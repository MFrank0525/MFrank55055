import { formatSelectedMainImageCopyForPrompt } from "./selling-point-rules.js";

export const MAIN_IMAGE_PROMPT_CONTRACT_VERSION = "single-source-product-poster-v5";

export const MAIN_IMAGE_SQUARE_PROMPT_CONTRACT =
  "强制画幅约束：最终输出必须为严格的1:1正方形画布（宽度=高度）；不得输出3:4、4:3、2:3、3:2或其他非正方形画幅。完整商品与所有文字、装饰均须在正方形安全区内，不得依赖后续裁剪。";

export const MAIN_IMAGE_FIXED_PROMPT_CONTRACT = [
  `【固定生成契约 ${MAIN_IMAGE_PROMPT_CONTRACT_VERSION}】`,
  "任务：基于唯一一张白底参考图，生成一张高端、可信、适合移动端电商转化的产品主图海报。",
  "产品锁定：参考图是产品外观的唯一事实来源。完整保留包装数量、形状、比例、结构、材质、颜色、图案、品牌标识和包装原有文字；不得改版、替换、增删、遮挡或虚构包装信息。",
  "文案锁定：海报新增文字只能使用下方“已审核产品文案”中的主标题、副标题和卖点，必须保持原意，不得自行新增功效、认证、承诺、促销、参数或品牌口号。",
  "字体与图形：主标题必须采用清晰可读的定制艺术字，使用字形切角、粗细变化、描边、局部高光或产品相关图形融合形成记忆点，不得使用普通默认黑体直接排字；副标题使用与主标题呼应的丝带、弧形色块、半透明材质牌或异形承载图形；卖点不得只是纯文字或统一对勾列表，每条卖点配一个与内容直接相关、风格统一但图形不同的专属小图标。",
  "需求与场景优先：当前轮场景中的用户需求、消费时刻和自然使用关系是画面决策的最高依据。人物、手部、使用部位、纯商品展示、步骤图、材质原理、配色、光线和道具都不是必选项，只在能帮助目标用户更快理解‘为什么此刻需要该商品’时使用；不得为了满足固定模板强加不相关元素。",
  "表现选择：需要说明用法时，可用克制的动作、局部或步骤视觉；需要建立生活代入时，可使用与需求匹配的真实人物和环境；需要突出选择理由时，可聚焦商品、卖点证据或相关细节。任何辅助内容都不得虚构商品事实、夸大结果或压过当前用户需求。",
  "版面优先级：商品必须完整、清晰、可识别，并与用户需求场景形成直接关系；商品、人物和环境的相对大小按当前需求决定，不使用固定比例硬套。主标题、副标题和卖点形成清楚的信息层级，避免底部等宽分栏、徽章阵列和图标堆叠。",
  "视觉目标：在手机缩略图中，目标用户应能同时理解商品是什么、适合什么需求、为什么这个场景与自己有关。画面保持可信、自然、有秩序，视觉语言由当前需求和场景统一，而不是由预设模板统一。",
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
