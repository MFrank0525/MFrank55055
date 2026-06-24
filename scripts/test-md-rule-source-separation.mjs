import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

const imageManual = read("docs/auto-listing/steps/03-main-image-generation.md");
const publishManual = read("docs/auto-listing/steps/10-publish.md");
const mainImageSource = read("src/autolist/main-image-assets.ts");
const publishSource = read("src/business/publish-from-spu.ts");
const publishConstantsSource = read("src/business/publish-from-spu/constants.ts");

for (const marker of [
  "### 飞书主图提示词来源规则",
  "飞书 `主图指令`",
  "飞书 `正向提示词`",
  "飞书 `反向提示词`",
  "五段"
]) {
  assert.match(imageManual, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `image manual missing block: ${marker}`);
}

for (const marker of [
  "### 标品检索规则",
  "### 发布模块顺序规则",
  "### 保健食品发布模块顺序规则",
  "### 类目属性填写规则",
  "### 保健食品类目属性规则",
  "### 图文信息规则",
  "### 运费模板规则",
  "### 规格模板规则",
  "### 商品规格模块规则",
  "### 保健食品包装标签规则"
]) {
  assert.match(publishManual, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `publish manual missing block: ${marker}`);
}

for (const forbidden of [
  "PRODUCT_REFERENCE_GUARDRAIL",
  "IMAGE_EDIT_OUTPUT_GUARDRAIL",
  "【产品海报设计】请基于输入参考图制作传统电商海报",
  "海报文字只展示：主标题",
  "PLATFORM_SPU_QUERY_RULE =",
  "publishFlowRule:",
  "healthFoodPublishFlowRule:",
  "categoryAttributeRule:",
  "healthFoodCategoryAttributeRule:",
  "healthFoodPackagingLabelRule:",
  "mainImageRule:",
  "freightTemplateRule:",
  "specTemplateRule:",
  "specModuleRule:"
]) {
  assert.equal(
    mainImageSource.includes(forbidden) || publishSource.includes(forbidden) || publishConstantsSource.includes(forbidden),
    false,
    `rule text or rule summary must not be hard-coded in action source: ${forbidden}`
  );
}

const publishRuleTextSource = read("src/business/publish-from-spu/publish-rule-text.ts");
for (const field of [
  "healthFoodPublishFlowRule",
  "healthFoodCategoryAttributeRule",
  "healthFoodPackagingLabelRule"
]) {
  assert.match(publishRuleTextSource, new RegExp(`${field}:\\s*readManualTextBlock`), `publish rule summary must expose ${field}`);
}

console.log("markdown rule source separation passed");
