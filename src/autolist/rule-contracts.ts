export interface RuleContract {
  label: string;
  text: string;
  includes: string[];
}

export const RULE_CONTRACT_MARKERS = {
  doubaoConversationTitle: ["产品卖点生成"],
  deepseekConversationTitle: ["日式医用贴膏海报设计"],
  deepseekInstruction1: ["主题海报视觉设计"],
  deepseekRetryInstruction: ["5段"],
  doubaoPrompt: [
    "产品卖点生成规则（完整整理版严格执行版）",
    "注意：用户认知产品名不含品牌",
    "01 品牌 + 用户认知产品名",
    "02 带品牌的产品通用名称",
    "严格按照 8 个卖点顺序输出"
  ],
  deepseekInstruction2: ["海报视觉设计生成规则", "每次需设计5款不同的电商海报", "不展示医疗器械备案注册号"],
  mainImageInstruction1: ["【产品海报设计】", "延草纲目医用膝盖喷剂", "延草纲目膝盖部位医用喷剂", "绿色对号"],
  titleConversationUrl: ["https://www.doubao.com/chat/38417884669014786"],
  titlePromptPrefix: ["完整版通用标题生成执行规则"],
  titleGenerationRule: ["真实抖音商城热搜词", "标题硬性格式规则", "采集用户认知名和产品通用名称"]
} as const;
