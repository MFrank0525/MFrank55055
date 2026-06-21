export interface RuleContract {
  label: string;
  text: string;
  includes: string[];
}

export const RULE_CONTRACT_MARKERS = {
  doubaoConversationTitle: ["产品卖点生成"],
  doubaoPrompt: [
    "产品卖点生成规则（完整整理版严格执行版）",
    "注意：用户认知产品名不含品牌",
    "01 品牌 + 用户认知产品名",
    "02 带品牌的产品通用名称",
    "严格按照 8 个卖点顺序输出"
  ],
  posterPromptSourceRule: ["飞书 `DeepSeek提示词`", "主流程不打开 DeepSeek 网页", "提示词唯一来源"],
  mainImagePromptSourceRule: ["飞书 `主图指令`", "飞书 `正向提示词`", "飞书 `反向提示词`", "五段"],
  titleKeywordSourceRule: ["飞书 `标题关键词`", "飞书 `标题固定后缀`", "主流程不打开豆包网页", "唯一来源"]
} as const;
