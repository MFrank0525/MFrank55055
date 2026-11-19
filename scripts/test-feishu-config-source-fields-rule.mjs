import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFeishuBitableConfig } from "../dist/src/feishu/config.js";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-config-"));
const file = path.join(dir, "config.json");
fs.writeFileSync(file, JSON.stringify({ bitableUrl: "https://example.feishu.cn/wiki/a?table=tbl1", fieldMap: {
  userCognitionName: "用户认知名", genericName: "通用名称", brand: "品牌", spu: "SPU",
  mainImageHeadlineCandidateText: "主图主标题", mainImageSubtitleCandidateText: "主图副标题",
  mainImageSellingPointCandidateText: "主图卖点", mainImageInstructionText: "主图指令",
  positivePromptText: "正向提示词", negativePromptText: "反向提示词", titleKeywordText: "标题关键词",
  titleSuffixText: "标题固定后缀", productPriceText: "产品价格", specTemplate: "规格模板",
  shortTitle: "导购短标题", productCategory: "产品类目", qualificationImages: "资质图片", whiteBackgroundImages: "白底图"
} }), "utf8");
const config = loadFeishuBitableConfig(file);
assert.equal(config.fieldMap.mainImageHeadlineCandidateText, "主图主标题");
assert.equal(config.fieldMap.mainImageSubtitleCandidateText, "主图副标题");
assert.equal(config.fieldMap.mainImageSellingPointCandidateText, "主图卖点");
for (const key of ["mainImageHeadlineCandidateText", "mainImageSubtitleCandidateText", "mainImageSellingPointCandidateText"]) assert.ok(config.requiredFields?.includes(key));
