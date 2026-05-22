import fs from "node:fs";
import path from "node:path";

export type PublishFinalVerifyStatus = "not_checked" | "publish_signal_confirmed" | "list_verified" | "needs_manual_review";

export interface PublishManifestEntry {
  productFolder: string;
  runtimeKey: string;
  shopFolder: string;
  watermarkNo: number | null;
  status: "pending" | "published" | "failed" | "skipped";
  finalVerifyStatus: PublishFinalVerifyStatus;
  resultFile?: string;
  message: string;
  errorClass?: string;
  updatedAt: string;
}

export interface PublishManifest {
  generatedAt: string;
  entries: PublishManifestEntry[];
}

export interface PublishPlanItem {
  productFolder: string;
  runtimeKey: string;
  action: "skip" | "publish";
  reason: string;
  manifestStatus?: string;
  finalVerifyStatus?: PublishFinalVerifyStatus;
}

const MANIFEST_FILE = "publish-manifest.json";
const PLAN_FILE = "publish-plan.json";

export function extractWatermarkNo(productFolder: string): number | null {
  const match = path.basename(productFolder).match(/水印(\d{1,3})$/);
  return match ? Number(match[1]) : null;
}

export function publishManifestFile(runtimeDir: string): string {
  return path.join(runtimeDir, MANIFEST_FILE);
}

export function publishPlanFile(runtimeDir: string): string {
  return path.join(runtimeDir, PLAN_FILE);
}

export function loadPublishManifest(runtimeDir: string): PublishManifest {
  const filePath = publishManifestFile(runtimeDir);
  if (!fs.existsSync(filePath)) {
    return { generatedAt: new Date().toISOString(), entries: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as PublishManifest;
    return {
      generatedAt: parsed.generatedAt || new Date().toISOString(),
      entries: Array.isArray(parsed.entries) ? parsed.entries : []
    };
  } catch {
    return { generatedAt: new Date().toISOString(), entries: [] };
  }
}

export function savePublishManifest(runtimeDir: string, manifest: PublishManifest): string {
  const filePath = publishManifestFile(runtimeDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ ...manifest, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return filePath;
}

export function savePublishPlan(runtimeDir: string, plan: PublishPlanItem[]): string {
  const filePath = publishPlanFile(runtimeDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), plan }, null, 2)}\n`, "utf8");
  return filePath;
}

export function findPublishManifestEntry(manifest: PublishManifest, runtimeKey: string): PublishManifestEntry | undefined {
  return manifest.entries.find((entry) => entry.runtimeKey === runtimeKey);
}

export function isManifestEntrySafelyPublished(entry: PublishManifestEntry | undefined): boolean {
  return Boolean(entry && entry.status === "published" && ["publish_signal_confirmed", "list_verified"].includes(entry.finalVerifyStatus));
}

export function upsertPublishManifestEntry(runtimeDir: string, entry: Omit<PublishManifestEntry, "updatedAt">): PublishManifest {
  const manifest = loadPublishManifest(runtimeDir);
  const updated: PublishManifestEntry = { ...entry, updatedAt: new Date().toISOString() };
  const existingIndex = manifest.entries.findIndex((item) => item.runtimeKey === updated.runtimeKey);
  if (existingIndex >= 0) {
    manifest.entries[existingIndex] = updated;
  } else {
    manifest.entries.push(updated);
  }
  manifest.entries.sort((a, b) => {
    const shopDiff = a.shopFolder.localeCompare(b.shopFolder, "zh-CN");
    if (shopDiff !== 0) return shopDiff;
    return (a.watermarkNo ?? 9999) - (b.watermarkNo ?? 9999);
  });
  savePublishManifest(runtimeDir, manifest);
  return manifest;
}
