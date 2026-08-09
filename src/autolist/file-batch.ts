import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "../utils/atomic-file.js";

interface ProcessedImageManifestV2 {
  version: 2;
  currentBatchFingerprint?: string;
  batches: Record<string, string[]>;
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function emptyProcessedManifest(): ProcessedImageManifestV2 {
  return { version: 2, batches: {} };
}

function parseProcessedManifest(manifestFile: string): ProcessedImageManifestV2 {
  if (!fs.existsSync(manifestFile)) {
    return emptyProcessedManifest();
  }

  const raw = fs.readFileSync(manifestFile, "utf8").trim();
  if (!raw) {
    return emptyProcessedManifest();
  }

  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    throw new Error("Processed image manifest uses the obsolete identity-free array format; refusing to attach it to a Feishu batch.");
  }
  if (parsed && typeof parsed === "object") {
    const manifest = parsed as Partial<ProcessedImageManifestV2>;
    if (manifest.version !== 2 || !manifest.batches || typeof manifest.batches !== "object") {
      throw new Error("Processed image manifest must use version 2 with batch-scoped entries.");
    }
    const batches = Object.fromEntries(
      Object.entries(manifest.batches).map(([fingerprint, images]) => [
        fingerprint,
        Array.isArray(images) ? images.map((item) => normalizePath(String(item || ""))).filter(Boolean) : []
      ])
    );
    return {
      version: 2,
      currentBatchFingerprint: manifest.currentBatchFingerprint,
      batches
    };
  }
  throw new Error("Processed image manifest must be a version 2 batch-scoped object.");
}

export function readProcessedImages(manifestFile: string, batchFingerprint?: string): Set<string> {
  const parsed = parseProcessedManifest(manifestFile);
  const selectedBatch = batchFingerprint || parsed.currentBatchFingerprint || "";
  return new Set((selectedBatch ? parsed.batches[selectedBatch] || [] : []).map(normalizePath));
}

export function clearProcessedImagesForBatch(manifestFile: string, batchFingerprint: string | undefined): boolean {
  if (!batchFingerprint || !fs.existsSync(manifestFile)) {
    return false;
  }
  const parsed = parseProcessedManifest(manifestFile);
  const existing = parsed.batches[batchFingerprint] || [];
  if (existing.length === 0) {
    return false;
  }
  parsed.batches[batchFingerprint] = [];
  parsed.currentBatchFingerprint = batchFingerprint;
  atomicWriteJson(manifestFile, parsed);
  return true;
}

export function appendProcessedImages(manifestFile: string, imagePaths: string[], batchFingerprint?: string): void {
  if (!batchFingerprint) {
    throw new Error("Appending processed images requires an explicit Feishu batch fingerprint.");
  }

  const parsed = parseProcessedManifest(manifestFile);
  const manifest: ProcessedImageManifestV2 = {
    version: 2,
    currentBatchFingerprint: batchFingerprint,
    batches: parsed.batches || {}
  };
  const processed = new Set((manifest.batches[batchFingerprint] || []).map(normalizePath));
  for (const filePath of imagePaths) {
    processed.add(normalizePath(filePath));
  }
  manifest.batches[batchFingerprint] = [...processed];
  atomicWriteJson(manifestFile, manifest);
}
