export interface RuleContract {
  label: string;
  text: string;
  includes: string[];
}

export const RULE_CONTRACT_MARKERS = {
  posterPromptSourceRule: ["主图主标题", "主图副标题", "主图卖点", "本地 `qwen3.6:35b-a3b`"],
  mainImagePromptSourceRule: ["固定生成契约", "两段变量", "不再需要 `主图指令`", "不维护“违禁词清单”"],
  titleKeywordSourceRule: ["飞书 `标题关键词`", "飞书 `标题固定后缀`", "唯一来源"]
} as const;
