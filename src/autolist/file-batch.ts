import fs from "node:fs";
import path from "node:path";

interface ProcessedImageManifestV2 {
  version: 2;
  currentBatchFingerprint?: string;
  batches: Record<string, string[]>;
  legacyImages?: string[];
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function parseProcessedManifest(manifestFile: string): string[] | ProcessedImageManifestV2 {
  if (!fs.existsSync(manifestFile)) {
    return [];
  }

  const raw = fs.readFileSync(manifestFile, "utf8").trim();
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.map((item) => normalizePath(String(item || ""))).filter(Boolean);
  }
  if (parsed && typeof parsed === "object") {
    const manifest = parsed as Partial<ProcessedImageManifestV2>;
    const batches = manifest.batches && typeof manifest.batches === "object" ? manifest.batches : {};
    return {
      version: 2,
      currentBatchFingerprint: manifest.currentBatchFingerprint,
      batches,
      legacyImages: Array.isArray(manifest.legacyImages)
        ? manifest.legacyImages.map((item) => normalizePath(String(item || ""))).filter(Boolean)
        : []
    };
  }
  return [];
}

export function readProcessedImages(manifestFile: string, batchFingerprint?: string): Set<string> {
  const parsed = parseProcessedManifest(manifestFile);
  if (Array.isArray(parsed)) {
    return new Set(parsed.map(normalizePath));
  }

  const selectedBatch = batchFingerprint || parsed.currentBatchFingerprint || "";
  return new Set((selectedBatch ? parsed.batches[selectedBatch] || [] : []).map(normalizePath));
}

export function migrateLegacyProcessedImagesToBatch(manifestFile: string, batchFingerprint: string | undefined): boolean {
  if (!batchFingerprint) {
    return false;
  }
  const parsed = parseProcessedManifest(manifestFile);
  if (!Array.isArray(parsed)) {
    return false;
  }
  const processed = [...new Set(parsed.map(normalizePath))];
  const manifest: ProcessedImageManifestV2 = {
    version: 2,
    currentBatchFingerprint: batchFingerprint,
    batches: {
      [batchFingerprint]: processed
    },
    legacyImages: processed
  };
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return true;
}

function sortBySequenceThenName(items: string[]): string[] {
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  return [...items].sort((a, b) => {
    const nameA = path.basename(a);
    const nameB = path.basename(b);
    const seqA = Number(nameA.match(/^(\d+)/)?.[1] || Number.MAX_SAFE_INTEGER);
    const seqB = Number(nameB.match(/^(\d+)/)?.[1] || Number.MAX_SAFE_INTEGER);
    if (seqA !== seqB) {
      return seqA - seqB;
    }
    return collator.compare(nameA, nameB);
  });
}

export function discoverPendingImages(
  imageDir: string,
  imageExtensions: string[],
  processedManifestFile: string,
  maxImagesPerRun: number,
  batchFingerprint?: string
): string[] {
  const processed = readProcessedImages(processedManifestFile, batchFingerprint);
  const extensions = new Set(imageExtensions.map((item) => item.toLowerCase()));
  const allImages = fs
    .readdirSync(imageDir)
    .filter((name) => extensions.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(imageDir, name));

  const pending = sortBySequenceThenName(allImages).filter((filePath) => !processed.has(path.resolve(filePath)));
  if (maxImagesPerRun > 0) {
    return pending.slice(0, maxImagesPerRun);
  }
  return pending;
}

export function filterPendingImages(
  imagePaths: string[],
  processedManifestFile: string,
  maxImagesPerRun: number,
  batchFingerprint?: string
): string[] {
  const processed = readProcessedImages(processedManifestFile, batchFingerprint);
  const pending = imagePaths.map((filePath) => path.resolve(filePath)).filter((filePath) => !processed.has(filePath));
  if (maxImagesPerRun > 0) {
    return pending.slice(0, maxImagesPerRun);
  }
  return pending;
}

export function appendProcessedImages(manifestFile: string, imagePaths: string[], batchFingerprint?: string): void {
  if (!batchFingerprint) {
    const processed = readProcessedImages(manifestFile);
    for (const filePath of imagePaths) {
      processed.add(normalizePath(filePath));
    }
    fs.writeFileSync(manifestFile, `${JSON.stringify([...processed], null, 2)}\n`, "utf8");
    return;
  }

  const parsed = parseProcessedManifest(manifestFile);
  const manifest: ProcessedImageManifestV2 = Array.isArray(parsed)
    ? {
        version: 2,
        currentBatchFingerprint: batchFingerprint,
        batches: {},
        legacyImages: parsed.map(normalizePath)
      }
    : {
        version: 2,
        currentBatchFingerprint: batchFingerprint,
        batches: parsed.batches || {},
        legacyImages: parsed.legacyImages || []
      };
  const processed = new Set((manifest.batches[batchFingerprint] || []).map(normalizePath));
  for (const filePath of imagePaths) {
    processed.add(normalizePath(filePath));
  }
  manifest.batches[batchFingerprint] = [...processed];
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
