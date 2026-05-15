import { readWorkbookRows, writeSimpleWorkbook } from "./xlsx-lite.js";
import type { MetadataArtifact } from "./types.js";
import fs from "node:fs";

function normalize(value: string): string {
  return value.replace(/\s+/g, "").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function inferProductName(sellingPointText: string): string {
  const segments = sellingPointText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return segments[1] || segments[0] || "";
}

function extractMetadataFromInfoRow(row: string[]): { name: string; shortTitle: string; brand: string; spu: string } | null {
  if (row.length < 9) {
    return null;
  }
  const startIndex = /^\d+$/.test((row[0] || "").trim()) ? 1 : 0;
  const name = (row[startIndex + 1] || "").trim();
  const shortTitle = (row[startIndex + 3] || "").trim();
  const brand = (row[startIndex + 5] || "").trim();
  const spu = (row[startIndex + 7] || "").trim();
  if (!name) {
    return null;
  }
  return { name, shortTitle, brand, spu };
}

function loadProductInfoKeyMap(mapFile: string): Record<string, string> {
  if (!mapFile || !fs.existsSync(mapFile)) {
    return {};
  }
  try {
    const value = JSON.parse(fs.readFileSync(mapFile, "utf8")) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
        .map(([key, mapped]) => [normalize(key), mapped.trim()])
        .filter(([, mapped]) => mapped.length > 0)
    );
  } catch (error) {
    throw new Error(`Could not parse product info key map: ${mapFile}. ${error instanceof Error ? error.message : String(error)}`);
  }
}

function matchProductInfoRow(
  rows: string[][],
  productName: string,
  keyMapFile: string
): { shortTitle: string; brand: string; spu: string } {
  if (rows.length === 0) {
    throw new Error("Product info workbook is empty.");
  }

  const target = normalize(productName);
  const keyMap = loadProductInfoKeyMap(keyMapFile);
  const mappedName = keyMap[target] || "";
  const allowedTargets = new Set([target, normalize(mappedName)].filter(Boolean));

  for (const row of rows.slice(1)) {
    const parsed = extractMetadataFromInfoRow(row);
    if (!parsed) {
      continue;
    }
    const normalizedName = normalize(parsed.name);
    if (!normalizedName || !allowedTargets.has(normalizedName)) {
      continue;
    }
    return {
      shortTitle: parsed.shortTitle,
      brand: parsed.brand,
      spu: parsed.spu
    };
  }

  throw new Error(
    `No exact product info row matched product name: ${productName}${mappedName ? ` (mapped to ${mappedName})` : ""}`
  );
}

function assertMetadataComplete(metadata: { shortTitle: string; brand: string; spu: string }, productName: string): void {
  const missingFields: string[] = [];
  if (!metadata.shortTitle.trim()) {
    missingFields.push("shortTitle");
  }
  if (!metadata.brand.trim()) {
    missingFields.push("brand");
  }
  if (!metadata.spu.trim()) {
    missingFields.push("spu");
  }
  if (missingFields.length > 0) {
    throw new Error(`Product info matched but required fields were empty for ${productName}: ${missingFields.join(", ")}`);
  }
}

function writeMetadataIntoWorkbook(workbookFile: string, metadata: { shortTitle: string; brand: string; spu: string }): void {
  const rows = readWorkbookRows(workbookFile);
  const nextRows = rows.map((row, index) => {
    if (row.length < 2) {
      return row;
    }
    if (index === 2) {
      return [row[0], metadata.shortTitle];
    }
    if (index === 3) {
      return [row[0], metadata.brand];
    }
    if (index === 4) {
      return [row[0], metadata.spu];
    }
    return row;
  });
  writeSimpleWorkbook(workbookFile, nextRows);
}

export function enrichDistributedTitleSheets(options: {
  productInfoXlsx: string;
  productInfoKeyMapFile: string;
  sellingPointText: string;
  productName?: string;
  distributedWorkbookFiles: string[];
  simulateOnly: boolean;
}): MetadataArtifact {
  const matchedProductName = (options.productName || "").trim() || inferProductName(options.sellingPointText);
  const metadata = options.simulateOnly
    ? {
        shortTitle: `${matchedProductName}-short`,
        brand: matchedProductName,
        spu: `${matchedProductName}-spu`
      }
    : matchProductInfoRow(readWorkbookRows(options.productInfoXlsx), matchedProductName, options.productInfoKeyMapFile);

  assertMetadataComplete(metadata, matchedProductName);

  for (const workbookFile of options.distributedWorkbookFiles) {
    writeMetadataIntoWorkbook(workbookFile, metadata);
  }

  return {
    matchedProductName,
    shortTitle: metadata.shortTitle,
    brand: metadata.brand,
    spu: metadata.spu,
    updatedWorkbookFiles: [...options.distributedWorkbookFiles],
    simulated: options.simulateOnly
  };
}
