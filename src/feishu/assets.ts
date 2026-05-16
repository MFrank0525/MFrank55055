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
}

export interface DownloadFeishuAssetsResult {
  downloadedFiles: string[];
  records: FeishuProductRecord[];
}

function extensionFromAttachment(attachment: FeishuBitableAttachment): string {
  const fromName = path.extname(attachment.name || "");
  if (fromName) {
    return fromName;
  }
  const mimeType = attachment.mimeType || "";
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  return ".bin";
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
    records.push({
      ...record,
      whiteBackgroundImages: whiteBackground.attachments,
      qualificationImages: qualifications.attachments
    });
  }

  return {
    downloadedFiles,
    records
  };
}
