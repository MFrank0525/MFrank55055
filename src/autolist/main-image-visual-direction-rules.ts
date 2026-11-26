import {
  isSceneLocationConcept,
  type SceneLocationConcept
} from "./scene-location-rules.js";

export const MAIN_IMAGE_VISUAL_DIRECTION_VERSION = "need-matched-scene-first-palette-layout-v5";

const SCENE_FIRST_DIRECTION =
  "场景优先：完整执行当前轮已经规划的用户需求、消费时刻、环境、氛围和互动关系。人物、局部、纯商品、步骤、原理、配色和光线均由当前需求决定，不因轮次或模板被强制加入、删除或替换。画面首先让目标用户理解‘为什么这个商品适合此刻的我’，同时保持商品完整、清晰、可信。";

const FRAME_AWARE_TITLE_LAYOUT =
  "固定品牌框版式：主标题与副标题组成同一信息组，整体从画布纵向24%开始并只能放在纵向24%–42%；不得贴顶，不得把任何标题笔画、描边、投影、丝带或标题色块放进顶部0%–23%。商品、卖点和人物继续位于该信息组下方或两侧，禁止用后期品牌框覆盖标题来伪造避让。";

const VARIANT_COMPOSITIONS = [
  "本轮第1张采用左侧产品、右侧场景的非对称构图，信息层级沿对角线展开。",
  "本轮第2张采用右侧产品、左侧使用部位的镜像构图，镜头距离和道具组合不得复用第1张。",
  "本轮第3张采用中央产品英雄构图，辅助信息沿单侧竖向排列，不得使用底部圆形步骤条。",
  "本轮第4张采用近景或轻俯视构图，产品与场景形成前中后景层次，不得复制本轮前三张的产品位置。"
] as const;

const SCENE_PALETTE_DIRECTIONS: Record<SceneLocationConcept, string> = {
  beach: "背景主导色使用海水蓝、青绿与珊瑚红，保留明亮海滩感；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  mountain: "背景主导色使用高山蓝、岩灰与冷杉绿，保持高海拔的清透冷感；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  "city-street": "背景主导色使用城市青蓝、石墨灰与少量霓虹紫，保持晴日街道的现代感；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  vehicle: "背景主导色使用车内炭灰、冷调蓝与清洁白，阳光只用中性高光表达；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  "park-camping": "背景主导色使用公园草木绿、天空蓝与帐篷红，保持晴朗白天的自然户外层次；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  sports: "背景主导色使用运动场青绿、深海蓝与活力红，保持清爽运动感；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  office: "背景主导色使用办公空间冷灰、雾蓝与少量青绿，保持清洁有序；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  "home-care": "背景主导色使用居家灰粉、鼠尾草绿与柔和蓝，保持自然生活感；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  retail: "背景主导色使用零售空间冷白、深蓝与少量品牌红，保持明亮陈列感；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  "cafe-patio": "背景主导色使用露台青绿、天空蓝与陶土红，避免以咖啡棕统摄画面；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  "kitchen-dining": "背景主导色使用餐厨冷白、香草绿与瓷器蓝，保持洁净日常感；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。",
  "travel-transit": "背景主导色使用交通空间钢蓝、冷灰与信号红，保持清晰出行感；包装原有暖金色不计入背景配色，暖金、米黄、橙棕不得成为大面积背景、底栏或标题牌。"
};

function resolveScenePaletteDirection(sceneText: string): string {
  const matches = [...sceneText.matchAll(/地点类别：([a-z-]+)/gu)].map((match) => match[1]);
  const uniqueConcepts = [...new Set(matches)];
  if (uniqueConcepts.length !== 1 || !isSceneLocationConcept(uniqueConcepts[0])) {
    throw new Error(
      `Main-image visual direction requires exactly one scene location concept; received ${uniqueConcepts.join(",") || "none"}.`
    );
  }
  return SCENE_PALETTE_DIRECTIONS[uniqueConcepts[0]];
}

const TYPOGRAPHY_SYSTEMS = [
  [
    "文字系统01：主标题采用清晰的切角立体字，颜色取自当前场景与包装的协调色；副标题使用斜切异形牌；卖点图标逐条表达当前用户需求，不套用固定行业符号。",
    "文字系统02：主标题采用双层错位字与细网格投影，色彩跟随当前场景；副标题使用不对称折角标签；卖点用与各自语义直接相关且互不重复的图形。",
    "文字系统03：主标题采用浮雕字、内阴影和克制高光；副标题使用透明磨砂长牌；卖点使用不同轮廓的功能图形，禁止统一盾牌或统一对勾。",
    "文字系统04：主标题采用窄体动势字与光线穿插；副标题使用阶梯形铭牌；卖点组成单侧视觉路径，图形语义必须服务当前需求且不得使用重复外框。"
  ],
  [
    "文字系统05：主标题采用自然手写刷笔字与符合当前需求的笔锋细节；副标题放入半透明弧带；卖点用五种与当前场景语义对应的插画图标。",
    "文字系统06：主标题采用柔和圆润字、双色描边和轻微压印；副标题使用有机形色块；卖点分别放入不同形状的信息签，禁止整齐统一徽章列。",
    "文字系统07：主标题采用清爽拼贴艺术字，局部融合当前环境的光影或物件负形；副标题使用波浪形磨砂玻璃牌；卖点用互不相同的场景小图案承载。",
    "文字系统08：主标题采用杂志衬线字与手写强调字混排；副标题使用撕纸边异形标签；卖点以不同需求线索轮廓的小卡片自由错落，禁止统一尺寸。"
  ],
  [
    "文字系统09：主标题采用金属渐变字、锐利高光和克制外沿，色彩服从当前场景；副标题放入透明棱镜牌；卖点分别融合与需求相关的不同证据图形。",
    "文字系统10：主标题采用全息切片字与错层透视；副标题使用悬浮晶体异形牌；卖点用五种不同的纹理窗口表达，禁止通用盾牌。",
    "文字系统11：主标题采用线框字与实心关键字交替组合；副标题放入弧形轨道；卖点以不同节点形状组成非对称路径，不得排成统一列表。",
    "文字系统12：主标题采用透明亚克力厚字、折射边和局部光线；副标题使用切面标签；卖点使用与当前需求对应的不同材质或场景图案组合。"
  ],
  [
    "文字系统13：主标题采用极简高对比编辑字体，包装或场景强调色只用于关键字内部的小面积几何嵌字；副标题放入细长不规则色带；卖点以不同留白符号和短线构成杂志式信息组。",
    "文字系统14：主标题采用与场景协调的浮雕压印字与大幅字号对比；副标题使用悬浮圆角材质牌；卖点用五种不同几何负形图标，保持克制且不重复。",
    "文字系统15：主标题采用几何宽体字、局部镂空和错位色块；副标题使用L形折页标签；卖点以不同形状的单色图案沿单侧自由排列。",
    "文字系统16：主标题采用竖向杂志标题与横向强调字组合；副标题使用半包围框；卖点用五枚不同轮廓、不同内部图案的极简印记，禁止统一圆框。"
  ],
  [
    "文字系统17：主标题采用与当前场景协调的动势刷字、清晰描边和方向性笔画；副标题放入倾斜丝带；卖点以不同需求相关插画贴纸沿弧线展开。",
    "文字系统18：主标题采用路径字，部分笔画与当前场景动线自然连接；副标题使用波浪异形牌；卖点分别使用不同需求、动作或场景图案，不得统一外框。",
    "文字系统19：主标题采用双色贴纸拼字与不规则白边；副标题使用折纸标签；卖点用尺寸和轮廓各不相同的功能贴纸错落布局，禁止徽章阵列。",
    "文字系统20：主标题采用层叠速度字、斜向切面和局部光效；副标题放入转折形承载图；卖点以不同图形节点沿折线路径串联，每个节点造型必须不同。"
  ]
] as const;

export function buildMainImageVisualDirectionContract(input: {
  roundIndex: number;
  variantIndex: number;
  hasFixedFrame: boolean;
  sceneText: string;
}): string {
  const validRound = Number.isInteger(input.roundIndex) && input.roundIndex >= 0 && input.roundIndex <= 4;
  const variantComposition = VARIANT_COMPOSITIONS[input.variantIndex];
  const typographySystem = TYPOGRAPHY_SYSTEMS[input.roundIndex]?.[input.variantIndex];
  if (!validRound || !variantComposition || !typographySystem) {
    throw new Error(
      `Main-image visual direction requires roundIndex 0-4 and variantIndex 0-3; received ${input.roundIndex}/${input.variantIndex}.`
    );
  }
  return [
    `【视觉方向契约 ${MAIN_IMAGE_VISUAL_DIRECTION_VERSION}】`,
    SCENE_FIRST_DIRECTION,
    resolveScenePaletteDirection(input.sceneText),
    input.hasFixedFrame ? FRAME_AWARE_TITLE_LAYOUT : "",
    variantComposition,
    typographySystem,
    "本张必须完整执行以上专属文字系统：主标题、副标题承载图形和全部卖点图标都要形成统一设计语言，并与其余19张的字形、载体、图标轮廓和排列方式明显不同；不得退化为默认黑体、纯文字列表、统一盾牌或统一对勾。",
    "需求裁决：如果构图或文字系统的装饰建议与当前用户需求、消费时刻或真实场景冲突，必须调整装饰并完整保留需求场景；不得为了凑人物、步骤、科技感、纯商品感或指定色彩而改变需求含义。",
    "产品、人物、使用部位、道具和背景必须与当前需求直接相关；本契约只提供版式与文字差异化，不改写场景、产品事实或文案。"
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
    buildMainImageVisualDirectionContract({
      roundIndex: input.roundIndex,
      variantIndex: input.variantIndex,
      hasFixedFrame: input.hasFixedFrame,
      sceneText: input.basePromptText
    }),
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
