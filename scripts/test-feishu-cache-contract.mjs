import assert from "node:assert/strict";
import {
  FEISHU_CACHE_SCHEMA_VERSION,
  FEISHU_FIELD_MAP_VERSION,
  validateFeishuProductPayload
} from "../dist/src/feishu/cache-contract.js";

const completeRecord = {
  recordId: "rec-1",
  userCognitionName: "认知名",
  genericName: "通用名",
  brand: "品牌",
  spu: "SPU-1",
  sellingPointText: "卖点",
  deepseekPromptText: "1\n2\n3\n4\n5",
  mainImageInstructionText: "主图指令",
  positivePromptText: "正向",
  negativePromptText: "反向",
  titleKeywordText: "关键词A,关键词B",
  titleSuffixText: "固定后缀",
  productPriceText: "129,99,79,59",
  shortTitle: "短标题",
  productCategory: "医疗器械",
  qualificationImages: [{ fileToken: "q", name: "q.png", raw: {} }],
  whiteBackgroundImages: [{ fileToken: "w", name: "w.png", raw: {} }],
  rawFields: {}
};

assert.throws(() => validateFeishuProductPayload({ records: [completeRecord] }), /schemaVersion/);
assert.throws(
  () => validateFeishuProductPayload({
    schemaVersion: FEISHU_CACHE_SCHEMA_VERSION,
    fieldMapVersion: FEISHU_FIELD_MAP_VERSION,
    batchFingerprint: "batch-1",
    records: [{ ...completeRecord, titleSuffixText: "" }]
  }),
  /titleSuffixText/
);

const valid = validateFeishuProductPayload({
  schemaVersion: FEISHU_CACHE_SCHEMA_VERSION,
  fieldMapVersion: FEISHU_FIELD_MAP_VERSION,
  batchFingerprint: "batch-1",
  records: [completeRecord]
});
assert.equal(valid.records.length, 1);
assert.equal(valid.batchFingerprint, "batch-1");

console.log("feishu cache contract passed");
