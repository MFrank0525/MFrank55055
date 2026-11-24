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
  sellingPointText: "突出放大的有设计感的艺术字：标题一，尺寸略小一些的有设计感的艺术字：副标题一，官方正品，卖点一，卖点二，卖点三，卖点四，卖点五，图示产品的使用步骤，突出产品使用部位。",
  mainImageHeadlineCandidateText: "标题一\n标题二",
  mainImageSubtitleCandidateText: "副标题一\n副标题二",
  mainImageSellingPointCandidateText: "卖点一\n卖点二\n卖点三\n卖点四\n卖点五",
  titleKeywordText: "关键词A,关键词B",
  titleSuffixText: "固定后缀",
  productPriceText: "129,99,79,59",
  specTemplate: "久光小泽",
  shortTitle: "短标题",
  productCategory: "医疗器械",
  qualificationImages: [{ fileToken: "q", name: "q.png", raw: {} }],
  detailExpansionImages: [{ fileToken: "d", name: "d.png", raw: {} }],
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
assert.notEqual(
  buildFeishuBatchFingerprint([completeRecord]),
  buildFeishuBatchFingerprint([{
    ...completeRecord,
    detailExpansionImages: [{ ...completeRecord.detailExpansionImages[0], fileToken: "d-changed" }]
  }]),
  "Changing a 详情页展开图 attachment must invalidate resumable batch identity"
);
assert.notEqual(
  buildFeishuBatchFingerprint([{ ...completeRecord, productCategory: "保健食品", shelfLife: 24, storageCondition: "常温" }]),
  buildFeishuBatchFingerprint([{ ...completeRecord, productCategory: "保健食品", shelfLife: 36, storageCondition: "阴凉干燥处" }]),
  "Changing Feishu 保质期 or 储藏条件 must invalidate resumable batch identity"
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
