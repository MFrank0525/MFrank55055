import type { AnalysisResult, ProductInput } from "../types/index.js";

export function buildPrompt(product: ProductInput, analysis: AnalysisResult): string {
  return [
    "你是中文电商搜索标题优化助手，负责生成偏抖音电商风格的搜索标题。",
    "标题要求尽量接近 60 个字，优先品类词、人群词、场景词、功能词、热搜联想词。",
    "请严格避免夸大、绝对化、疗效承诺、违规医疗宣传。",
    `核心关键词：${product.productName}`,
    `竞品高频词：${analysis.highFreqTerms.join("、")}`,
    `搜索联想词：${analysis.suggestionTerms.join("、")}`,
    `宣传热词：${analysis.promotionTerms.join("、")}`,
    `商品信息：${JSON.stringify(product)}`,
    "输出 8 个候选标题，JSON 数组，每项包含 title、type、reason。"
  ].join("\n");
}
