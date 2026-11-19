import assert from "node:assert/strict";
import {
  matchRetainedExternalProductTarget,
  validateExternalProductConflict
} from "../dist/src/autolist/external-product-resolution.js";

const resolution = validateExternalProductConflict({
  version: 1,
  status: "resolved_retain_and_skip",
  disposition: "retain_existing_and_skip_exact_target",
  detectedAt: "2026-11-19T04:37:00.000Z",
  resolvedAt: "2026-11-19T05:10:00.000Z",
  batchFingerprint: "batch-1",
  recordId: "record-1",
  taskId: "image-001",
  shopCode: "01",
  watermarkNo: 1,
  shopName: "shop-01",
  externalProductId: "product-1",
  exactTitle: "old title",
  message: "operator retained existing product"
});
assert.equal(matchRetainedExternalProductTarget(resolution, {
  batchFingerprint: "batch-1",
  recordId: "record-1",
  taskId: "image-001",
  shopCode: "01",
  watermarkNo: 1
})?.externalProductId, "product-1");
assert.equal(matchRetainedExternalProductTarget(resolution, {
  batchFingerprint: "batch-1",
  recordId: "record-1",
  taskId: "image-001",
  shopCode: "02",
  watermarkNo: 2
}), undefined);
assert.throws(
  () => validateExternalProductConflict({
    ...resolution,
    status: "resolved_retain_and_skip",
    disposition: undefined
  }),
  /disposition/
);

console.log("external product resolution rules passed");
