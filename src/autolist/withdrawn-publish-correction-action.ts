import fs from "node:fs";
import path from "node:path";
import {
  findPublishManifestEntry,
  loadPublishManifest,
  publishManifestFile,
  upsertPublishManifestEntry
} from "./publish-manifest.js";

export function invalidateWithdrawnPublishTarget(input: {
  runtimeDir: string;
  targetKey: string;
  externalProductId: string;
  evidenceScreenshot: string;
  archiveDir: string;
  reason: string;
}): { archivedPublishRuntimeDir: string; manifestEntryStatus: "pending" } {
  if (!/^\d+$/.test(input.externalProductId)) {
    throw new Error("Withdrawn publish correction requires the exact numeric external product id.");
  }
  if (!path.isAbsolute(input.evidenceScreenshot) || !fs.existsSync(input.evidenceScreenshot)) {
    throw new Error("Withdrawn publish correction requires an existing absolute evidence screenshot.");
  }
  const manifest = loadPublishManifest(input.runtimeDir);
  const entry = findPublishManifestEntry(manifest, input.targetKey);
  if (!entry || entry.status !== "published" || entry.finalVerifyStatus !== "publish_signal_confirmed") {
    throw new Error("Withdrawn publish correction requires one exact publish-confirmed manifest target.");
  }
  const publishRuntimeDir = path.join(input.runtimeDir, "publish", entry.runtimeKey);
  const archivedPublishRuntimeDir = path.join(input.archiveDir, "publish", entry.runtimeKey);
  const archivedManifest = path.join(input.archiveDir, "publish-manifest.before-withdrawal.json");
  if (!fs.existsSync(publishRuntimeDir) || fs.existsSync(archivedPublishRuntimeDir) || fs.existsSync(archivedManifest)) {
    throw new Error("Withdrawn publish correction archive precondition failed.");
  }
  fs.mkdirSync(path.dirname(archivedPublishRuntimeDir), { recursive: true });
  fs.copyFileSync(publishManifestFile(input.runtimeDir), archivedManifest);
  fs.renameSync(publishRuntimeDir, archivedPublishRuntimeDir);
  upsertPublishManifestEntry(input.runtimeDir, {
    ...entry,
    status: "pending",
    finalVerifyStatus: "not_checked",
    resultFile: undefined,
    message: `${input.reason}; externalProductId=${input.externalProductId}; evidence=${input.evidenceScreenshot}`,
    errorClass: "withdrawn_for_main_image_correction"
  });
  return { archivedPublishRuntimeDir, manifestEntryStatus: "pending" };
}
