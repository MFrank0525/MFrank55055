import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPublishTargetIdentity,
  publishTargetKey
} from "../dist/src/autolist/publish-identity.js";
import {
  loadPublishManifest,
  upsertPublishManifestEntry
} from "../dist/src/autolist/publish-manifest.js";

const cold = buildPublishTargetIdentity({
  batchFingerprint: "batch",
  recordId: "cold",
  taskId: "image-005",
  shopCode: "01",
  watermarkNo: 1
});
const warm = buildPublishTargetIdentity({
  batchFingerprint: "batch",
  recordId: "warm",
  taskId: "image-006",
  shopCode: "01",
  watermarkNo: 1
});
assert.notEqual(publishTargetKey(cold), publishTargetKey(warm));
assert.throws(
  () => buildPublishTargetIdentity({ batchFingerprint: "", recordId: "cold", taskId: "image-005", shopCode: "01", watermarkNo: 1 }),
  /batchFingerprint/
);

const sameNameTargets = ["cold", "warm"].flatMap((recordId, taskIndex) =>
  Array.from({ length: 20 }, (_, index) => publishTargetKey(buildPublishTargetIdentity({
    batchFingerprint: "batch",
    recordId,
    taskId: `image-00${taskIndex + 5}`,
    shopCode: String(Math.floor(index / 2) + 1).padStart(2, "0"),
    watermarkNo: index + 1
  })))
);
assert.equal(new Set(sameNameTargets).size, 40);

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-publish-"));
for (const identity of [cold, warm]) {
  upsertPublishManifestEntry(runtimeDir, {
    targetIdentity: identity,
    targetKey: publishTargetKey(identity),
    productFolder: "/tmp/shop/相同展示名水印01",
    runtimeKey: "same-display-path",
    shopFolder: "/tmp/shop",
    watermarkNo: 1,
    status: "published",
    finalVerifyStatus: "publish_signal_confirmed",
    message: "safe"
  });
}
assert.equal(loadPublishManifest(runtimeDir).entries.length, 2);
fs.rmSync(runtimeDir, { recursive: true, force: true });

console.log("publish canonical identity passed");
