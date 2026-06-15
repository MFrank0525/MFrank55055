import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isManifestEntrySafelyPublishedForIdentity,
  loadPublishManifest,
  normalizePublishProductIdentity,
  savePublishManifest
} from "../dist/src/autolist/publish-manifest.js";
import { loadCheckpoint, saveCheckpoint } from "../dist/src/business/publish-from-spu/checkpoint.js";

const oldGenericEntry = {
  productFolder: "/tmp/shop/延草纲目医用重组胶原蛋白护理软膏水印01",
  runtimeKey: "shop__延草纲目医用重组胶原蛋白护理软膏水印01",
  shopFolder: "/tmp/shop",
  watermarkNo: 1,
  status: "published",
  finalVerifyStatus: "publish_signal_confirmed",
  resultFile: "/tmp/runtime/publish/shop__old/result.json",
  message: "Published before identity tracking.",
  updatedAt: "2026-05-28T00:00:00.000Z"
};

const rowFiveIdentity = normalizePublishProductIdentity({
  sourceImagePath: "/Users/mfrank/MFrank55055/input/auto-listing/feishu-images/05-晋械注准20252140075-医用凡士林唇部软膏-白底图-01.png",
  recordId: "rec-row-5",
  userCognitionName: "医用凡士林唇部软膏",
  genericName: "医用重组胶原蛋白护理软膏"
});

const rowTwoEntry = {
  ...oldGenericEntry,
  sourceImagePath: "/Users/mfrank/MFrank55055/input/auto-listing/feishu-images/02-晋械注准20252140075-医用凡士林润唇软膏-白底图-01.png",
  recordId: "rec-row-2",
  userCognitionName: "医用凡士林润唇软膏",
  genericName: "医用重组胶原蛋白护理软膏"
};

const rowFiveEntry = {
  ...oldGenericEntry,
  sourceImagePath: rowFiveIdentity.sourceImagePath,
  recordId: rowFiveIdentity.recordId,
  userCognitionName: rowFiveIdentity.userCognitionName,
  genericName: rowFiveIdentity.genericName
};

const acceptedUnconfirmedEntry = {
  ...rowFiveEntry,
  finalVerifyStatus: "submit_accepted_unconfirmed",
  message: "Publish button click was accepted; platform success page was not observed."
};

assert.equal(
  isManifestEntrySafelyPublishedForIdentity(oldGenericEntry, rowFiveIdentity),
  false,
  "Legacy manifest entries without product identity must not skip current-product publishing."
);

assert.equal(
  isManifestEntrySafelyPublishedForIdentity(rowTwoEntry, rowFiveIdentity),
  false,
  "Same generic-name products from different Feishu rows must not share publish checkpoints."
);

assert.equal(
  isManifestEntrySafelyPublishedForIdentity(rowFiveEntry, rowFiveIdentity),
  true,
  "A publish checkpoint can be reused only when the source image and Feishu record identity match."
);

assert.equal(
  isManifestEntrySafelyPublishedForIdentity(rowFiveEntry),
  true,
  "Legacy callers without identity keep the original safe-published behavior."
);

assert.equal(
  isManifestEntrySafelyPublishedForIdentity(acceptedUnconfirmedEntry, rowFiveIdentity),
  false,
  "A final submit click without a platform success signal must not be reused as a safe publish checkpoint for resume."
);

const manifestRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-manifest-"));
fs.writeFileSync(path.join(manifestRuntimeDir, "publish-manifest.json"), '{"entries":[', "utf8");
assert.throws(
  () => loadPublishManifest(manifestRuntimeDir),
  /invalid publish manifest/i,
  "A damaged publish checkpoint must fail closed instead of being treated as an empty manifest."
);
fs.rmSync(manifestRuntimeDir, { recursive: true, force: true });

const savedManifestRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-manifest-save-"));
savePublishManifest(savedManifestRuntimeDir, {
  generatedAt: "2026-06-13T00:00:00.000Z",
  entries: [rowFiveEntry]
});
assert.equal(loadPublishManifest(savedManifestRuntimeDir).entries.length, 1);
assert.equal(
  fs.readdirSync(savedManifestRuntimeDir).some((name) => name.includes(".tmp")),
  false,
  "Atomic publish manifest writes must not leave temporary files after success."
);
fs.rmSync(savedManifestRuntimeDir, { recursive: true, force: true });

const checkpointRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-checkpoint-"));
fs.writeFileSync(path.join(checkpointRuntimeDir, "publish-checkpoint.json"), "[", "utf8");
assert.throws(
  () => loadCheckpoint(checkpointRuntimeDir),
  /invalid publish checkpoint/i,
  "A damaged publish-stage checkpoint must stop recovery instead of replaying stages from an empty checkpoint."
);
fs.rmSync(checkpointRuntimeDir, { recursive: true, force: true });

const savedCheckpointRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-checkpoint-save-"));
saveCheckpoint(savedCheckpointRuntimeDir, [{ step: "publish_flow", status: "completed" }]);
assert.deepEqual(loadCheckpoint(savedCheckpointRuntimeDir), [{ step: "publish_flow", status: "completed" }]);
fs.rmSync(savedCheckpointRuntimeDir, { recursive: true, force: true });
