import assert from "node:assert/strict";
import "./test-main-image-copy-rotation-rule.mjs";
import { normalizeFeishuProductRecord, validateFeishuProductRecord } from "../dist/src/feishu/product-records.js";
import { parseMainImageCandidateText } from "../dist/src/autolist/selling-point-rules.js";

assert.deepEqual(
  parseMainImageCandidateText("200ml大容量，60g/支，30片装"),
  ["200ml大容量", "60g/支", "30片装"],
  "Numeric product specifications must never be stripped as list ordinals"
);
assert.deepEqual(
  parseMainImageCandidateText("1. 第一卖点\n2、第二卖点\n三）第三卖点"),
  ["第一卖点", "第二卖点", "第三卖点"],
  "Explicit numbered-list markers should still be removed"
);

const config = { appToken: "app", tableId: "tbl", fieldMap: {
  userCognitionName: "用户认知名", genericName: "通用名称", brand: "品牌", spu: "SPU",
  mainImageHeadlineCandidateText: "主图主标题", mainImageSubtitleCandidateText: "主图副标题",
  mainImageSellingPointCandidateText: "主图卖点", titleKeywordText: "标题关键词",
  titleSuffixText: "标题固定后缀", productPriceText: "产品价格", specTemplate: "规格模板",
  shortTitle: "导购短标题", productCategory: "产品类目", qualificationImages: "资质图片",
  detailExpansionImages: "详情页展开图", whiteBackgroundImages: "白底图",
  manufacturerName: "", manufacturerAddress: "", netContent: "", productStandardCode: "", ingredients: "",
  healthFunction: "", specification: "", shelfLife: "", storageCondition: ""
} };
const fields = {
  用户认知名: "医用唇部保湿凝胶", 通用名称: "医用聚乙二醇润护敷料", 品牌: "延草纲目",
  SPU: "湘械注准20212141816", 产品类目: "医疗器械", 主图主标题: "唇部干燥护理\n唇部水润防护",
  主图副标题: "日常润护\n清爽保湿", 主图卖点: "聚乙二醇成分\n保湿润护\n清透凝胶\n便携管装\n日常可用",
  标题关键词: "唇部护理,保湿凝胶", 标题固定后缀: "医用聚乙二醇润护敷料",
  产品价格: "129,99,79,59", 规格模板: "久光小泽", 导购短标题: "唇部保湿凝胶",
  白底图: [{ file_token: "white-token", name: "white.png" }],
  资质图片: [{ file_token: "cert-token", name: "cert.png" }],
  详情页展开图: [{ file_token: "detail-token", name: "detail.png" }]
};
const normalized = normalizeFeishuProductRecord({ recordId: "rec-1", fields }, config);
assert.match(normalized.sellingPointText, /^突出放大的有设计感的艺术字：(唇部干燥护理|唇部水润防护)，/);
assert.match(normalized.sellingPointText, /尺寸略小一些的有设计感的艺术字：(日常润护|清爽保湿)，官方正品，/);
assert.match(normalized.sellingPointText, /，图示产品的使用步骤，突出产品使用部位。$/);
const selected = normalized.sellingPointText.replace(/。$/, "").split("，").slice(3, 8);
assert.equal(selected.length, 5);
assert.equal(new Set(selected).size, 5);
for (const item of selected) assert.ok(["聚乙二醇成分", "保湿润护", "清透凝胶", "便携管装", "日常可用"].includes(item));
const lockedRefresh = normalizeFeishuProductRecord({
  recordId: "rec-1",
  fields: { ...fields, 主图主标题: "不应覆盖的新标题", 主图副标题: "不应覆盖的新副标题", 主图卖点: "新一\n新二\n新三\n新四\n新五" }
}, config, { lockedMainImageCopyRecord: normalized });
assert.equal(lockedRefresh.sellingPointText, normalized.sellingPointText, "A pending locked batch must preserve selected copy");
assert.equal(lockedRefresh.mainImageHeadlineCandidateText, normalized.mainImageHeadlineCandidateText);
assert.equal(lockedRefresh.mainImageSubtitleCandidateText, normalized.mainImageSubtitleCandidateText);
assert.equal(lockedRefresh.mainImageSellingPointCandidateText, normalized.mainImageSellingPointCandidateText);
assert.deepEqual(validateFeishuProductRecord(normalized), []);
assert.equal(normalized.detailExpansionImages[0].fileToken, "detail-token");
assert.throws(() => normalizeFeishuProductRecord({ recordId: "rec-too-few", fields: { ...fields, 主图卖点: "卖点一\n卖点二\n卖点三\n卖点四" } }, config), /至少需要5个不同候选内容/);
