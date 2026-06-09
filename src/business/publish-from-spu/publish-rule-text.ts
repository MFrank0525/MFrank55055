import { readManualTextBlock } from "../../autolist/operation-manual.js";

export interface PublishRuleSummary {
  platformSpuQueryRule: string;
  publishFlowRule: string;
  categoryAttributeRule: string;
  mainImageRule: string;
  freightTemplateRule: string;
  specTemplateRule: string;
  specModuleRule: string;
}

export function readPublishRuleSummary(): PublishRuleSummary {
  return {
    platformSpuQueryRule: readManualTextBlock("published", "标品检索规则"),
    publishFlowRule: readManualTextBlock("published", "发布模块顺序规则"),
    categoryAttributeRule: readManualTextBlock("published", "类目属性填写规则"),
    mainImageRule: readManualTextBlock("published", "图文信息规则"),
    freightTemplateRule: readManualTextBlock("published", "运费模板规则"),
    specTemplateRule: readManualTextBlock("published", "规格模板规则"),
    specModuleRule: readManualTextBlock("published", "商品规格模块规则")
  };
}
