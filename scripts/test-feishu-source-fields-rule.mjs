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

const medicalDeviceWithEmptyHealthFoodColumns = normalizeFeishuProductRecord(
  {
    ...baseRecord,
    recordId: "rec-medical-with-empty-health-food-columns",
    fields: {
      ...baseRecord.fields,
      生产企业名称: "",
      生产企业地址: "",
      净含量: "",
      产品标准代码: "",
      配料表: "",
      保健功能: "",
      规格: ""
    }
  },
  {
    ...config,
    fieldMap: {
      ...config.fieldMap,
      manufacturerName: "生产企业名称",
      manufacturerAddress: "生产企业地址",
      netContent: "净含量",
      productStandardCode: "产品标准代码",
      ingredients: "配料表",
      healthFunction: "保健功能",
      specification: "规格"
    }
  }
);
assert.equal(medicalDeviceWithEmptyHealthFoodColumns.productCategory, "医疗器械");
assert.equal(medicalDeviceWithEmptyHealthFoodColumns.manufacturerName, "");
assert.equal(medicalDeviceWithEmptyHealthFoodColumns.specification, "");
assert.deepEqual(
  validateFeishuProductRecord(medicalDeviceWithEmptyHealthFoodColumns),
  [],
  "医疗器械记录不应因为同表保健食品专用列为空而失败"
);

const shuffledMedicalDeviceRecord = normalizeFeishuProductRecord(
  {
    recordId: "rec-medical-shuffled-extra-columns",
    fields: {
      新增无关表头B: "不参与上架",
      资质图片: [{ file_token: "cert-token", name: "cert.png" }],
      标题固定后缀: "医用聚乙二醇润护敷料",
      白底图: [{ file_token: "white-token", name: "white.png" }],
      新增无关表头A: "顺序变化不应阻塞",
      产品价格: "129,99,79,59",
      品牌: "延草纲目",
      DeepSeek提示词: "唇部护理场景,聚乙二醇凝胶,保湿润护,电商主图",
      产品类目: "医疗器械",
      规格: "",
      用户认知名: "医用唇部保湿凝胶",
      产品卖点: "适用于唇部干燥护理，保湿润护。",
      标题关键词: "唇部护理,保湿凝胶,聚乙二醇,润护敷料",
      通用名称: "医用聚乙二醇润护敷料",
      反向提示词: "飞书反向提示词：不要治疗暗示，不要前后对比。",
      主图指令: "飞书主图指令：锁定白底图主体，传统电商主图。",
      生产企业名称: "",
      SPU: "湘械注准20212141816",
      保健功能: "",
      导购短标题: "唇部保湿凝胶",
      正向提示词: "飞书正向提示词：C4D质感，高级光影。"
    }
  },
  {
    ...config,
    fieldMap: {
      ...config.fieldMap,
      manufacturerName: "生产企业名称",
      healthFunction: "保健功能",
      specification: "规格"
    }
  }
);
assert.equal(shuffledMedicalDeviceRecord.productCategory, "医疗器械");
assert.equal(shuffledMedicalDeviceRecord.userCognitionName, "医用唇部保湿凝胶");
assert.equal(shuffledMedicalDeviceRecord.rawFields.新增无关表头A, "顺序变化不应阻塞");
assert.deepEqual(
  validateFeishuProductRecord(shuffledMedicalDeviceRecord),
  [],
  "表头顺序变化和新增无关表头不应阻塞医疗器械记录"
);

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

const dynamicHealthFoodRecord = normalizeFeishuProductRecord(
  {
    recordId: "rec-health-food",
    fields: {
      消费者认知名称: "蓝帽蛋白粉",
      商品类目: "保健食品",
      商品通用名: "蛋白粉",
      商品品牌: "当前品牌",
      SPU编码: "SPU-HEALTH-001",
      卖点: "补充蛋白质。",
      生图提示词: "蛋白粉罐装产品主图",
      主图要求: "白底主体清晰",
      正向词: "明亮，电商主图",
      反向词: "不出现治疗暗示",
      标题词: "蛋白粉,营养补充",
      产品售价: "199,169,139,109",
      短标题: "蛋白粉",
      资质附件: [{ file_token: "health-cert-token", name: "health-cert.png" }],
      白底附件: [{ file_token: "health-white-token", name: "health-white.png" }],
      生产企业: "当前生产企业",
      生产地址: "当前生产地址",
      净含量规格: "60粒",
      标准号: "Q/CURRENT 001",
      配料: "乳清蛋白",
      功效: "增强免疫力",
      商品规格: "0.5g×60粒"
    }
  },
  config
);

assert.equal(dynamicHealthFoodRecord.productCategory, "保健食品");
assert.equal(dynamicHealthFoodRecord.userCognitionName, "蓝帽蛋白粉");
assert.equal(dynamicHealthFoodRecord.spu, "SPU-HEALTH-001");
assert.equal(dynamicHealthFoodRecord.manufacturerName, "当前生产企业");
assert.equal(dynamicHealthFoodRecord.manufacturerAddress, "当前生产地址");
assert.equal(dynamicHealthFoodRecord.netContent, "60粒");
assert.equal(dynamicHealthFoodRecord.productStandardCode, "Q/CURRENT 001");
assert.equal(dynamicHealthFoodRecord.ingredients, "乳清蛋白");
assert.equal(dynamicHealthFoodRecord.healthFunction, "增强免疫力");
assert.equal(dynamicHealthFoodRecord.specification, "0.5g×60粒");
assert.deepEqual(validateFeishuProductRecord(dynamicHealthFoodRecord), []);
