import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../doubao/paths.js";
import { downloadFeishuMedia } from "./client.js";
import type { FeishuBitableAttachment, FeishuProductRecord } from "./types.js";

export interface DownloadFeishuAssetsOptions {
  token: string;
  records: FeishuProductRecord[];
  whiteBackgroundDir: string;
  qualificationDir: string;
  cleanupStaleAssets?: boolean;
}

export interface DownloadFeishuAssetsResult {
  downloadedFiles: string[];
  records: FeishuProductRecord[];
  removedStaleFiles: string[];
}

function extensionFromAttachment(attachment: FeishuBitableAttachment): string {
  const fromName = path.extname(attachment.name || "");
  if (fromName) {
    const normalized = fromName.toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(normalized)) {
      return normalized;
    }
    throw new Error(`Unsupported Feishu attachment image type: ${attachment.name}`);
  }
  const mimeType = attachment.mimeType || "";
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  throw new Error(`Unsupported Feishu attachment image MIME type: ${mimeType || "unknown"}`);
}

function buildFileName(record: FeishuProductRecord, label: string, attachment: FeishuBitableAttachment, index: number): string {
  const baseName = sanitizeFileName(
    [
      record.spu || record.recordId,
      record.userCognitionName || record.genericName,
      label,
      String(index + 1).padStart(2, "0")
    ]
      .filter(Boolean)
      .join("-")
  );
  return `${baseName}${extensionFromAttachment(attachment)}`;
}

function listLocalAssetFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => /(白底图|资质图片)-\d{2}\.(png|jpg|jpeg|webp|gif|bin)$/i.test(name))
    .map((name) => path.resolve(dir, name));
}

function removeUnreferencedAssets(dir: string, referencedFiles: Set<string>): string[] {
  const removed: string[] = [];
  for (const file of listLocalAssetFiles(dir)) {
    if (referencedFiles.has(file)) {
      continue;
    }
    fs.rmSync(file, { force: true });
    removed.push(file);
  }
  return removed;
}

async function downloadAttachmentSet(
  options: DownloadFeishuAssetsOptions,
  record: FeishuProductRecord,
  attachments: FeishuBitableAttachment[],
  label: string,
  targetDir: string
): Promise<{ files: string[]; attachments: FeishuBitableAttachment[] }> {
  fs.mkdirSync(targetDir, { recursive: true });
  const files: string[] = [];
  const updated: FeishuBitableAttachment[] = [];

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    if (!attachment.fileToken) {
      updated.push(attachment);
      continue;
    }
    const targetFile = path.resolve(targetDir, buildFileName(record, label, attachment, index));
    if (!fs.existsSync(targetFile)) {
      const body = await downloadFeishuMedia(options.token, attachment.fileToken, attachment.downloadUrl);
      fs.writeFileSync(targetFile, body);
    }
    files.push(targetFile);
    updated.push({
      ...attachment,
      providerReferenceUrl: attachment.providerReferenceUrl || attachment.temporaryUrl || attachment.downloadUrl,
      localFile: targetFile
    });
  }

  return { files, attachments: updated };
}

export async function downloadFeishuProductAssets(
  options: DownloadFeishuAssetsOptions
): Promise<DownloadFeishuAssetsResult> {
  const downloadedFiles: string[] = [];
  const records: FeishuProductRecord[] = [];
  const referencedWhiteBackgroundFiles = new Set<string>();
  const referencedQualificationFiles = new Set<string>();

  for (const record of options.records) {
    const whiteBackground = await downloadAttachmentSet(
      options,
      record,
      record.whiteBackgroundImages,
      "白底图",
      options.whiteBackgroundDir
    );
    const qualifications = await downloadAttachmentSet(
      options,
      record,
      record.qualificationImages,
      "资质图片",
      options.qualificationDir
    );
    downloadedFiles.push(...whiteBackground.files, ...qualifications.files);
    for (const file of whiteBackground.files) {
      referencedWhiteBackgroundFiles.add(path.resolve(file));
    }
    for (const file of qualifications.files) {
      referencedQualificationFiles.add(path.resolve(file));
    }
    records.push({
      ...record,
      whiteBackgroundImages: whiteBackground.attachments,
      qualificationImages: qualifications.attachments
    });
  }

  const removedStaleFiles = options.cleanupStaleAssets
    ? [
        ...removeUnreferencedAssets(options.whiteBackgroundDir, referencedWhiteBackgroundFiles),
        ...removeUnreferencedAssets(options.qualificationDir, referencedQualificationFiles)
      ]
    : [];

  return {
    downloadedFiles,
    records,
    removedStaleFiles
  };
}
