import fs from "node:fs";
import path from "node:path";
import { verifyPublishedProductInDoudianList } from "../business/publish-from-spu/product-list-verification-action.js";
import { markPublishResultListVerified } from "./publish.js";
import { loadPublishManifest, upsertPublishManifestEntry } from "./publish-manifest.js";
import { atomicWriteJson } from "../utils/atomic-file.js";

export async function reconcilePositiveUncertainPublish(input: {
  runtimeDir: string;
  shopFolder: string;
  verify?: typeof verifyPublishedProductInDoudianList;
  now?: () => Date;
}): Promise<Record<string, unknown>> {
  const resultFile = path.join(input.runtimeDir, "result.json");
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8")) as Record<string, any>;
  const title = String(result.data?.metadata?.title || "").trim();
  const canonicalIdentity = result.data?.metadata?.canonicalIdentity;
  const resultShopFolder = String(result.data?.shopFolder || "");
  if (!title || !canonicalIdentity || result.data?.browser?.publishClickAttempted !== true || result.data?.browser?.publishClicked === true) {
    throw new Error("Positive reconciliation requires one identity-bound attempted but unconfirmed publish result.");
  }
  if (path.resolve(resultShopFolder) !== path.resolve(input.shopFolder)) {
    throw new Error(`Positive reconciliation shop mismatch: expected=${resultShopFolder}; actual=${input.shopFolder}`);
  }
  const runDir = path.dirname(path.dirname(input.runtimeDir));
  const manifest = loadPublishManifest(runDir);
  const runtimeKey = path.basename(input.runtimeDir);
  const entry = manifest.entries.find((item) => item.runtimeKey === runtimeKey);
  if (!entry || JSON.stringify(entry.targetIdentity) !== JSON.stringify(canonicalIdentity)) {
    throw new Error("Positive reconciliation manifest identity does not match the publish result.");
  }
  const verification = await (input.verify || verifyPublishedProductInDoudianList)({
    runtimeDir: input.runtimeDir,
    shopFolder: input.shopFolder,
    title
  });
  if (!verification.found || !/^共\s*[1-9]\d*\s*条$/.test(verification.countText)) {
    throw new Error(`Positive reconciliation requires an exact-title product match: found=${verification.found}; count=${verification.countText || "missing"}.`);
  }
  const stamp = (input.now?.() || new Date()).toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(input.runtimeDir, "positive-reconciliation", stamp);
  fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: false });
  fs.copyFileSync(resultFile, path.join(archiveDir, "result.before-reconciliation.json"));
  fs.copyFileSync(path.join(runDir, "publish-manifest.json"), path.join(archiveDir, "publish-manifest.before-reconciliation.json"));
  atomicWriteJson(path.join(archiveDir, "verification.json"), verification);
  markPublishResultListVerified(resultFile, verification);
  const message = `Historical uncertain submit reconciled by exact-title Doudian 全部 tab match (${verification.countText}).`;
  upsertPublishManifestEntry(runDir, {
    ...entry,
    status: "published",
    finalVerifyStatus: "list_verified",
    message,
    errorClass: ""
  });
  return { runtimeDir: input.runtimeDir, resultFile, runDir, runtimeKey, title, verification, archiveDir };
}
