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
  mainImageInstruction1: [
    "【产品海报设计】",
    "延草纲目医用膝盖喷剂",
    "延草纲目膝盖部位医用喷剂",
    "图案元素",
    "不要在主图里增加作用部位前后对比效果图",
    "违禁词不得出现在图片里",
    "放心使用、过敏、红敏、治疗、泛红、敏感肌、消肿止痛、敏肌、红肿、抗敏、抗炎、炎症、消炎、日本、进口"
  ],
  titleKeywordSourceRule: ["飞书 `标题关键词`", "主流程不打开豆包网页", "标题关键词唯一来源"]
} as const;
