import fs from "node:fs";
import path from "node:path";

function readProcessedImages(manifestFile: string): Set<string> {
  if (!fs.existsSync(manifestFile)) {
    return new Set<string>();
  }

  const raw = fs.readFileSync(manifestFile, "utf8").trim();
  if (!raw) {
    return new Set<string>();
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return new Set<string>();
  }

  return new Set(parsed.map((item) => String(item || "")));
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
  maxImagesPerRun: number
): string[] {
  const processed = readProcessedImages(processedManifestFile);
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

export function appendProcessedImages(manifestFile: string, imagePaths: string[]): void {
  const processed = readProcessedImages(manifestFile);
  for (const filePath of imagePaths) {
    processed.add(path.resolve(filePath));
  }
  fs.writeFileSync(manifestFile, `${JSON.stringify([...processed], null, 2)}\n`, "utf8");
}
