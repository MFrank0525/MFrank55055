import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFeishuBitableConfig } from "../dist/src/feishu/config.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-config-source-fields-"));
const configFile = path.join(tempDir, "feishu-bitable.config.json");
fs.writeFileSync(
  configFile,
  JSON.stringify(
    {
      bitableUrl: "https://example.feishu.cn/wiki/wikiToken?table=tbl123&view=vew456",
      fieldMap: {
        userCognitionName: "用户认知名",
        genericName: "通用名称",
        brand: "品牌",
        spu: "SPU",
        sellingPointText: "产品卖点",
        deepseekPromptText: "DeepSeek提示词",
        titleKeywordText: "标题关键词",
        shortTitle: "导购短标题",
        productCategory: "产品类目",
        qualificationImages: "资质图片",
        whiteBackgroundImages: "白底图"
      }
    },
    null,
    2
  ),
  "utf8"
);

const config = loadFeishuBitableConfig(configFile);
assert.equal(config.fieldMap.deepseekPromptText, "DeepSeek提示词");
assert.equal(config.fieldMap.titleKeywordText, "标题关键词");
assert.ok(config.requiredFields?.includes("deepseekPromptText"));
assert.ok(config.requiredFields?.includes("titleKeywordText"));
