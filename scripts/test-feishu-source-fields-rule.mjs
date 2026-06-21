import assert from "node:assert/strict";
import { normalizeFeishuProductRecord, validateFeishuProductRecord } from "../dist/src/feishu/product-records.js";

const baseRecord = {
  recordId: "rec-1",
  fields: {
    用户认知名: "医用唇部保湿凝胶",
    产品类目: "医疗器械",
    通用名称: "医用聚乙二醇润护敷料",
    品牌: "延草纲目",
    SPU: "湘械注准20212141816",
    产品卖点: "适用于唇部干燥护理，保湿润护。",
    DeepSeek提示词: "唇部护理场景,聚乙二醇凝胶,保湿润护,电商主图",
    主图指令: "飞书主图指令：锁定白底图主体，传统电商主图。",
    正向提示词: "飞书正向提示词：C4D质感，高级光影。",
    反向提示词: "飞书反向提示词：不要治疗暗示，不要前后对比。",
    标题关键词: "唇部护理,保湿凝胶,聚乙二醇,润护敷料",
    标题固定后缀: "医用聚乙二醇润护敷料",
    产品价格: "129,99,79,59",
    导购短标题: "唇部保湿凝胶",
    白底图: [{ file_token: "white-token", name: "white.png" }],
    资质图片: [{ file_token: "cert-token", name: "cert.png" }]
  }
};

const config = {
  appToken: "app",
  tableId: "tbl",
  fieldMap: {
    userCognitionName: "用户认知名",
    genericName: "通用名称",
    brand: "品牌",
    spu: "SPU",
    sellingPointText: "产品卖点",
    deepseekPromptText: "DeepSeek提示词",
    mainImageInstructionText: "主图指令",
    positivePromptText: "正向提示词",
    negativePromptText: "反向提示词",
    titleKeywordText: "标题关键词",
    titleSuffixText: "标题固定后缀",
    productPriceText: "产品价格",
    shortTitle: "导购短标题",
    productCategory: "产品类目",
    qualificationImages: "资质图片",
    whiteBackgroundImages: "白底图"
  }
};

const normalized = normalizeFeishuProductRecord(baseRecord, config);
assert.equal(normalized.deepseekPromptText, "唇部护理场景,聚乙二醇凝胶,保湿润护,电商主图");
assert.equal(normalized.mainImageInstructionText, "飞书主图指令：锁定白底图主体，传统电商主图。");
assert.equal(normalized.positivePromptText, "飞书正向提示词：C4D质感，高级光影。");
assert.equal(normalized.negativePromptText, "飞书反向提示词：不要治疗暗示，不要前后对比。");
assert.equal(normalized.titleKeywordText, "唇部护理,保湿凝胶,聚乙二醇,润护敷料");
assert.equal(normalized.titleSuffixText, "医用聚乙二醇润护敷料");
assert.equal(normalized.productPriceText, "129,99,79,59");
assert.deepEqual(validateFeishuProductRecord(normalized), []);

const richTextRecord = normalizeFeishuProductRecord(
  {
    ...baseRecord,
    recordId: "rec-rich-text",
    fields: {
      ...baseRecord.fields,
      DeepSeek提示词: [
        { text: "第一段提示词,唇部护理,保湿滋润,主图构图\n", type: "text" },
        { text: "\n", type: "text" },
        { text: "第二段提示词,凡士林成分,水润修护,产品特写", type: "text" }
      ]
    }
  },
  config
);
assert.equal(
  richTextRecord.deepseekPromptText,
  "第一段提示词,唇部护理,保湿滋润,主图构图\n\n第二段提示词,凡士林成分,水润修护,产品特写"
);

const missing = normalizeFeishuProductRecord(
  {
    ...baseRecord,
    recordId: "rec-2",
    fields: {
      ...baseRecord.fields,
      DeepSeek提示词: "",
      主图指令: "",
      正向提示词: "",
      反向提示词: "",
      标题关键词: "",
      标题固定后缀: "",
      产品价格: ""
    }
  },
  config
);
assert.deepEqual(validateFeishuProductRecord(missing).filter((item) => item.includes("Text")), [
  "deepseekPromptText",
  "mainImageInstructionText",
  "positivePromptText",
  "negativePromptText",
  "titleKeywordText",
  "titleSuffixText",
  "productPriceText"
]);
