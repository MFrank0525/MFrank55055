import fs from "node:fs";
import zlib from "node:zlib";
import type { ProductSheetSummary } from "./types.js";

function columnIndex(cellRef: string): number | undefined {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) {
    return undefined;
  }
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

async function readWorksheetRows(xlsxPath: string): Promise<string[][]> {
  const zip = fs.readFileSync(xlsxPath);

  const readZipEntryText = (entryName: string): string | undefined => {
    const eocdSignature = 0x06054b50;
    let eocdOffset = -1;
    for (let index = zip.length - 22; index >= Math.max(0, zip.length - 65557); index -= 1) {
      if (zip.readUInt32LE(index) === eocdSignature) {
        eocdOffset = index;
        break;
      }
    }
    if (eocdOffset < 0) {
      throw new Error("Invalid xlsx zip: end of central directory not found.");
    }

    const totalEntries = zip.readUInt16LE(eocdOffset + 10);
    const centralDirectoryOffset = zip.readUInt32LE(eocdOffset + 16);
    let offset = centralDirectoryOffset;

    for (let index = 0; index < totalEntries; index += 1) {
      if (zip.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error("Invalid xlsx zip: central directory entry signature mismatch.");
      }

      const compressionMethod = zip.readUInt16LE(offset + 10);
      const compressedSize = zip.readUInt32LE(offset + 20);
      const fileNameLength = zip.readUInt16LE(offset + 28);
      const extraLength = zip.readUInt16LE(offset + 30);
      const commentLength = zip.readUInt16LE(offset + 32);
      const localHeaderOffset = zip.readUInt32LE(offset + 42);
      const fileName = zip.toString("utf8", offset + 46, offset + 46 + fileNameLength);

      if (fileName === entryName) {
        if (zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
          throw new Error(`Invalid xlsx zip: local header missing for ${entryName}.`);
        }

        const localFileNameLength = zip.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
        const compressed = zip.subarray(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) {
          return Buffer.from(compressed).toString("utf8");
        }
        if (compressionMethod === 8) {
          return zlib.inflateRawSync(compressed).toString("utf8");
        }
        throw new Error(`Unsupported zip compression method ${compressionMethod} for ${entryName}.`);
      }

      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return undefined;
  };

  const decodeXml = (value: string): string =>
    value
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");

  const stripTags = (value: string): string => decodeXml(value.replace(/<[^>]+>/g, ""));

  const sharedXmlText = readZipEntryText("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedXmlText) {
    for (const match of sharedXmlText.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      shared.push(stripTags(match[1]).trim());
    }
  }

  const sheetXmlText = readZipEntryText("xl/worksheets/sheet1.xml");
  if (!sheetXmlText) {
    throw new Error("sheet1.xml not found in workbook");
  }

  const rows: string[][] = [];
  for (const rowMatch of sheetXmlText.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const values: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || "";
      const explicitColumnIndex = ref ? columnIndex(ref) : undefined;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      let value = "";

      if (type === "s") {
        const indexText = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]?.trim() || "";
        const sharedIndex = Number(indexText);
        if (Number.isInteger(sharedIndex) && sharedIndex >= 0 && sharedIndex < shared.length) {
          value = shared[sharedIndex];
        }
      } else if (type === "inlineStr") {
        value = stripTags(body);
      } else {
        value = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1]?.trim() || "");
      }

      const normalized = value.trim();
      if (explicitColumnIndex !== undefined) {
        values[explicitColumnIndex] = normalized;
        continue;
      }
      if (normalized) {
        values.push(normalized);
      }
    }

    if (values.length) {
      rows.push(values);
    }
  }

  return rows;
}

export async function summarizeWorkbook(xlsxPath?: string): Promise<ProductSheetSummary> {
  if (!xlsxPath) {
    return { rows: [] };
  }

  try {
    const rows = await readWorksheetRows(xlsxPath);
    return {
      rows,
      title: rows[1]?.[1]?.trim() || "",
      shortTitle: rows[2]?.[1]?.trim() || "",
      brand: rows[3]?.[1]?.trim() || "",
      spu: rows[4]?.[1]?.trim() || "",
      modelSpec: rows[5]?.[1]?.trim() || "",
      productPriceText: rows.find((row) => (row[0] || "").trim() === "产品价格")?.[1]?.trim() || ""
    };
  } catch (error) {
    return {
      rows: [],
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}
