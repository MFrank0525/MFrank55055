import assert from "node:assert/strict";
import {
  isManifestEntrySafelyPublishedForIdentity,
  normalizePublishProductIdentity
} from "../dist/src/autolist/publish-manifest.js";

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
