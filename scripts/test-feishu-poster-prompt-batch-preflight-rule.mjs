import assert from "node:assert/strict";
import { validateFeishuPosterPromptBatch } from "../dist/src/autolist/deepseek-prompts.js";

const validPromptText = [
  "医美术后修复室场景,医用冷敷面膜包装展示,冰蓝降温波纹,使用步骤图",
  "夏季晒后修复场景,医用面部冷敷贴盒装前景,水润冷敷粒子,医疗器械认证",
  "熬夜急救补水场景,医用冷敷面膜贴敷示意,补水保湿光效,官方正品视觉",
  "敏感肌换季泛红场景,医用面部冷敷贴舒缓护理,无激素无酒精标签,清爽构图",
  "晚间护肤冷敷仪式场景,医用冷敷面膜产品陈列,物理降温护理,电商主图排版"
].join("\n");

const result = validateFeishuPosterPromptBatch([
  {
    recordId: "rec-short",
    userCognitionName: "医用冷敷面膜",
    genericName: "医用面部冷敷贴",
    brand: "延草纲目",
    spu: "粤穗械备20230018",
    sellingPointText: "用户认知名为医用冷敷面膜，产品通用名称为医用面部冷敷贴",
    deepseekPromptText: "海边暴晒后泛红脱皮场景，沙滩遮阳伞边缘，墨镜防晒霜",
    titleKeywordText: "医用冷敷贴面膜",
    shortTitle: "医用冷敷贴面膜白盒",
    productCategory: "医疗器械",
    qualificationImages: [],
    whiteBackgroundImages: []
  },
  {
    recordId: "rec-valid",
    userCognitionName: "医用冷敷面膜",
    genericName: "医用面部冷敷贴",
    brand: "延草纲目",
    spu: "粤穗械备20230018",
    sellingPointText: "用户认知名为医用冷敷面膜，产品通用名称为医用面部冷敷贴，物理降温，补水保湿",
    deepseekPromptText: validPromptText,
    titleKeywordText: "医用冷敷贴面膜",
    shortTitle: "医用冷敷贴面膜白盒",
    productCategory: "医疗器械",
    qualificationImages: [],
    whiteBackgroundImages: []
  }
]);

assert.equal(result.ok, false);
assert.equal(result.errors.length, 1);
assert.equal(result.errors[0].recordId, "rec-short");
assert.equal(result.errors[0].requiredPromptCount, 5);
assert.match(result.errors[0].message, /must provide 5 poster prompt paragraph/);
assert.match(result.summary, /rec-short/);
