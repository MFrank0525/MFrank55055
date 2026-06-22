import assert from "node:assert/strict";
import {
  FEISHU_CACHE_SCHEMA_VERSION,
  FEISHU_FIELD_MAP_VERSION,
  validateFeishuProductPayload
} from "../dist/src/feishu/cache-contract.js";
import { buildFeishuBatchFingerprint } from "../dist/src/autolist/feishu-batch-rules.js";
import fs from "node:fs";
import { sanitizeFeishuProductRecord } from "../dist/src/feishu/product-records.js";

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
const sanitizedRecord = sanitizeFeishuProductRecord(completeRecord);
assert.equal(
  buildFeishuBatchFingerprint([sanitizedRecord]),
  buildFeishuBatchFingerprint([completeRecord]),
  "Redacting Feishu file tokens must preserve a stable non-secret attachment identity"
);
assert.notEqual(
  buildFeishuBatchFingerprint([completeRecord]),
  buildFeishuBatchFingerprint([{
    ...completeRecord,
    qualificationImages: [{ ...completeRecord.qualificationImages[0], fileToken: "q-changed" }]
  }]),
  "Changing an attachment token must change the batch fingerprint even when name and size stay unchanged"
);

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
  batchFingerprint: buildFeishuBatchFingerprint([completeRecord]),
  records: [completeRecord]
});
assert.equal(valid.records.length, 1);
assert.equal(valid.batchFingerprint, buildFeishuBatchFingerprint([completeRecord]));
assert.throws(
  () => validateFeishuProductPayload({
    schemaVersion: FEISHU_CACHE_SCHEMA_VERSION,
    fieldMapVersion: FEISHU_FIELD_MAP_VERSION,
    batchFingerprint: "stale-download-before-fingerprint",
    records: [completeRecord]
  }),
  /batchFingerprint mismatch/,
  "Cache validation must reject a fingerprint that was not computed from the exact persisted records"
);
assert.match(
  fs.readFileSync("src/cli/feishu-bitable.ts", "utf8"),
  /batchFingerprint: buildFeishuBatchFingerprint\(assetRecords\)/,
  "Feishu asset refresh must fingerprint the final persisted records after attachment download normalization"
);

console.log("feishu cache contract passed");
