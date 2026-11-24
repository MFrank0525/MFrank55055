export const MAIN_IMAGE_VISUAL_DIRECTION_VERSION = "product-relevant-five-direction-v1";

const ROUND_DIRECTIONS = [
  "方向一：冷静、清晰的临床信息图视觉。主色使用医疗蓝、冷白和少量产品包装色；场景与产品真实用途直接相关；禁止金色主背景、金色奖章、皇冠、麦穗和奢华宫廷装饰。",
  "方向二：真实自然的日常使用场景。使用自然光、低饱和中性色和少量植物绿；产品与使用部位形成明确关系；禁止摄影棚式金色光环、官方正品奖章和底部三圆圈模板。",
  "方向三：成分、材质或工作原理的科技视觉。使用青蓝、紫蓝、透明材质和微观纹理；只展示与当前产品卖点有关的元素；禁止通用金色盾牌、红金绶带和无关医疗器械。",
  "方向四：极简产品英雄图。背景色从包装主色提取，留出明确层级和呼吸感，产品占据主视觉；禁止人物堆叠、徽章堆叠、底部步骤圆圈和大面积金色。",
  "方向五：清晰的使用方法视觉。使用珊瑚色、青绿色或包装互补色，通过一条连续动线表达步骤；禁止底部三个等大圆形步骤、奖章、皇冠、麦穗和复制前四轮构图。"
] as const;

const VARIANT_COMPOSITIONS = [
  "本轮第1张采用左侧产品、右侧场景的非对称构图，信息层级沿对角线展开。",
  "本轮第2张采用右侧产品、左侧使用部位的镜像构图，镜头距离和道具组合不得复用第1张。",
  "本轮第3张采用中央产品英雄构图，辅助信息沿单侧竖向排列，不得使用底部圆形步骤条。",
  "本轮第4张采用近景或轻俯视构图，产品与场景形成前中后景层次，不得复制本轮前三张的产品位置。"
] as const;

export function buildMainImageVisualDirectionContract(input: {
  roundIndex: number;
  variantIndex: number;
  hasFixedFrame: boolean;
}): string {
  const roundDirection = ROUND_DIRECTIONS[input.roundIndex];
  const variantComposition = VARIANT_COMPOSITIONS[input.variantIndex];
  if (!roundDirection || !variantComposition) {
    throw new Error(
      `Main-image visual direction requires roundIndex 0-4 and variantIndex 0-3; received ${input.roundIndex}/${input.variantIndex}.`
    );
  }
  return [
    `【视觉方向契约 ${MAIN_IMAGE_VISUAL_DIRECTION_VERSION}】`,
    roundDirection,
    variantComposition,
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
