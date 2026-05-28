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
  mainImageInstruction1: ["【产品海报设计】", "延草纲目医用膝盖喷剂", "延草纲目膝盖部位医用喷剂", "绿色对号"],
  titleKeywordSourceRule: ["飞书 `标题关键词`", "主流程不打开豆包网页", "标题关键词唯一来源"]
} as const;
