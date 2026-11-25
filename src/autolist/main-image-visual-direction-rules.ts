export const MAIN_IMAGE_VISUAL_DIRECTION_VERSION = "product-relevant-five-direction-v2";

const ROUND_DIRECTIONS = [
  "方向一：冷静、清晰的临床信息图视觉。主色严格使用医疗蓝、冷白和少量产品包装色；只允许手部或局部使用动作，不出现完整人物脸部；步骤采用侧边纵向或对角的两个不等大非圆形局部窗。禁止米黄、奶油、橙金、暖木色、金色奖章、皇冠、麦穗和底部横排步骤。",
  "方向二：真实自然的日常使用场景。严格使用冷调自然日光、低饱和灰白和鼠尾草绿，不使用夕阳、暖灯、米黄、奶油、橙金或大面积木色；本轮允许一位自然人物建立生活代入感，但人物不得大于完整产品组；禁止摄影棚式金色光环、官方正品奖章和底部三圆圈模板。",
  "方向三：成分、材质或工作原理的科技视觉。严格使用青蓝、紫蓝、冷白、透明材质和微观纹理；不出现完整人物，仅允许局部手部、使用部位或抽象原理图；禁止米黄、橙金、通用金色盾牌、红金绶带和无关医疗器械。",
  "方向四：冷白极简产品英雄图。背景严格使用冷白、浅灰与包装本身的少量红色或其他包装色，使用冷中性棚拍光；不得出现人物、面部、手部或生活化木质场景，产品必须是绝对第一主体。禁止米黄、奶油、暖木、夕阳、徽章堆叠、底部步骤圆圈和大面积金色。",
  "方向五：清晰的使用方法视觉。严格使用青绿色、冷白和包装互补冷色，通过侧边弧线或斜向折线串联大小不同、轮廓不同的手部或局部步骤窗；不得出现完整人物脸部，产品仍须大于全部步骤图的总视觉重量。禁止珊瑚橙、米黄、奶油、暖木、金色、底部三个等大圆形步骤、等宽三栏、奖章、皇冠和麦穗。"
] as const;

const VARIANT_COMPOSITIONS = [
  "本轮第1张采用左侧产品、右侧场景的非对称构图，信息层级沿对角线展开。",
  "本轮第2张采用右侧产品、左侧使用部位的镜像构图，镜头距离和道具组合不得复用第1张。",
  "本轮第3张采用中央产品英雄构图，辅助信息沿单侧竖向排列，不得使用底部圆形步骤条。",
  "本轮第4张采用近景或轻俯视构图，产品与场景形成前中后景层次，不得复制本轮前三张的产品位置。"
] as const;

const TYPOGRAPHY_SYSTEMS = [
  [
    "文字系统01：主标题采用深蓝白描边的医疗切角立体字，局部融入十字或刻度切口；副标题放入冷蓝斜切胶囊牌；每条卖点使用不同的线性医学图标与独立圆角信息片。",
    "文字系统02：主标题采用蓝白双层错位字与细网格投影，形成检验报告式秩序；副标题使用不对称折角标签；卖点分别使用部位、材质、正品、环境、日晒语义的不同蓝图图标。",
    "文字系统03：主标题采用冷白浮雕字配深蓝内阴影和少量青色高光；副标题使用透明磨砂长牌；卖点使用五种不同轮廓的六边形功能图章，禁止统一盾牌或统一对勾。",
    "文字系统04：主标题采用蓝色窄体速度字与横向光线穿插；副标题使用阶梯形技术铭牌；卖点以不同医学符号组成竖向仪表盘，但不得使用重复外框。"
  ],
  [
    "文字系统05：主标题采用自然手写刷笔字与叶片笔锋收尾，保持清晰可读；副标题放入半透明植物弧带；卖点用五种不同的叶片、水滴、阳光、面部和正品插画图标。",
    "文字系统06：主标题采用柔和圆润字、双色描边和轻微纸张压印；副标题使用有机云朵形色块；卖点分别放入不同形状的植物标本签，禁止整齐统一徽章列。",
    "文字系统07：主标题采用清爽青绿色拼贴艺术字，局部融合窗光和枝叶负形；副标题使用波浪形磨砂玻璃牌；卖点用互不相同的手绘场景小图案承载。",
    "文字系统08：主标题采用低饱和杂志衬线字与手写强调字混排；副标题使用撕纸边异形标签；卖点以不同自然物轮廓的小卡片自由错落，禁止统一尺寸。"
  ],
  [
    "文字系统09：主标题采用青蓝金属渐变字、锐利高光和微弱霓虹外沿；副标题放入透明玻璃棱镜牌；卖点分别融合分子、薄膜、水滴、光束和部位的不同科技图形。",
    "文字系统10：主标题采用紫蓝全息切片字与错层透视；副标题使用悬浮晶体异形牌；卖点用五种不同的微观纹理窗口表达，禁止通用盾牌。",
    "文字系统11：主标题采用发光线框字与实心关键字交替组合；副标题放入弧形数据轨道；卖点以不同节点形状组成非对称科技路径，不得排成统一列表。",
    "文字系统12：主标题采用透明亚克力厚字、青紫折射边和局部扫描线；副标题使用六边形切面标签；卖点使用不同材质样本图案与专属符号组合。"
  ],
  [
    "文字系统13：主标题采用极简黑白高对比编辑字体，关键字使用包装色几何嵌字；副标题放入细长不规则色带；卖点以不同留白符号和短线构成杂志式信息组。",
    "文字系统14：主标题采用包装同色系浮雕压印字与大幅字号对比；副标题使用悬浮圆角材质牌；卖点用五种不同几何负形图标，保持克制且不重复。",
    "文字系统15：主标题采用几何宽体字、局部镂空和错位色块；副标题使用L形折页标签；卖点以不同形状的单色图案沿单侧自由排列。",
    "文字系统16：主标题采用竖向杂志标题与横向强调字组合；副标题使用半包围框；卖点用五枚不同轮廓、不同内部图案的极简印记，禁止统一圆框。"
  ],
  [
    "文字系统17：主标题采用青绿色动势刷字、白色厚描边和箭头笔画；副标题放入倾斜丝带；卖点以不同步骤相关插画贴纸沿弧线展开。",
    "文字系统18：主标题采用青绿色路径字，部分笔画与步骤动线自然连接；副标题使用波浪箭头牌；卖点分别使用不同动作、部位和场景图案，不得统一外框。",
    "文字系统19：主标题采用双色贴纸拼字与不规则白边；副标题使用折纸标签；卖点用尺寸和轮廓各不相同的功能贴纸错落布局，禁止徽章阵列。",
    "文字系统20：主标题采用层叠速度字、斜向切面和局部光效；副标题放入转折箭头形承载图；卖点以不同图形节点沿折线路径串联，每个节点造型必须不同。"
  ]
] as const;

export function buildMainImageVisualDirectionContract(input: {
  roundIndex: number;
  variantIndex: number;
  hasFixedFrame: boolean;
}): string {
  const roundDirection = ROUND_DIRECTIONS[input.roundIndex];
  const variantComposition = VARIANT_COMPOSITIONS[input.variantIndex];
  const typographySystem = TYPOGRAPHY_SYSTEMS[input.roundIndex]?.[input.variantIndex];
  if (!roundDirection || !variantComposition || !typographySystem) {
    throw new Error(
      `Main-image visual direction requires roundIndex 0-4 and variantIndex 0-3; received ${input.roundIndex}/${input.variantIndex}.`
    );
  }
  return [
    `【视觉方向契约 ${MAIN_IMAGE_VISUAL_DIRECTION_VERSION}】`,
    roundDirection,
    variantComposition,
    typographySystem,
    "本张必须完整执行以上专属文字系统：主标题、副标题承载图形和全部卖点图标都要形成统一设计语言，并与其余19张的字形、载体、图标轮廓和排列方式明显不同；不得退化为默认黑体、纯文字列表、统一盾牌或统一对勾。",
    "产品、使用部位、道具和背景必须与当前商品直接相关；本契约只决定本轮配色、构图和装饰风格，不改写产品事实或文案。"
  ].join("\n");
}

export function buildMainImageProductionPrompt(input: {
  basePromptText: string;
  roundIndex: number;
  variantIndex: number;
  hasFixedFrame: boolean;
  frameContract?: string;
}): string {
  const contracts = [
    MAIN_IMAGE_FIXED_PROMPT_CONTRACT,
    input.basePromptText.trim(),
    buildMainImageVisualDirectionContract(input),
    input.hasFixedFrame ? input.frameContract?.trim() : "",
    MAIN_IMAGE_SQUARE_PROMPT_CONTRACT,
    MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT
  ].filter(Boolean);
  return contracts.join("\n\n");
}

import { MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT } from "./main-image-collage-action.js";
import {
  MAIN_IMAGE_FIXED_PROMPT_CONTRACT,
  MAIN_IMAGE_SQUARE_PROMPT_CONTRACT
} from "./main-image-prompt-contract.js";
