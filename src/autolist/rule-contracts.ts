export interface RuleContract {
  label: string;
  text: string;
  includes: string[];
}

export const RULE_CONTRACT_MARKERS = {
  posterPromptSourceRule: ["主图主标题", "主图副标题", "主图卖点", "固定 DeepSeek 对话"],
  mainImagePromptSourceRule: ["飞书 `主图指令`", "飞书 `正向提示词`", "飞书 `反向提示词`", "五段"],
  titleKeywordSourceRule: ["飞书 `标题关键词`", "飞书 `标题固定后缀`", "唯一来源"]
} as const;
