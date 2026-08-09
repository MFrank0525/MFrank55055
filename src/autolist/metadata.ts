import { readWorkbookRows, writeSimpleWorkbook } from "./xlsx-lite.js";
import type { MetadataArtifact } from "./types.js";

type FeishuPublishMetadata = {
  shortTitle: string;
  brand: string;
  spu: string;
};

function assertMetadataComplete(metadata: FeishuPublishMetadata, productName: string): void {
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
    throw new Error(`Current Feishu product metadata was incomplete for ${productName}: ${missingFields.join(", ")}`);
  }
}

function writeMetadataIntoWorkbook(workbookFile: string, metadata: FeishuPublishMetadata): void {
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
  productName: string;
  metadata: FeishuPublishMetadata;
  distributedWorkbookFiles: string[];
  simulateOnly: boolean;
}): MetadataArtifact {
  const matchedProductName = options.productName.trim();
  if (!matchedProductName) {
    throw new Error("Current Feishu product metadata is missing its product identity name.");
  }
  assertMetadataComplete(options.metadata, matchedProductName);

  if (!options.simulateOnly) {
    for (const workbookFile of options.distributedWorkbookFiles) {
      writeMetadataIntoWorkbook(workbookFile, options.metadata);
    }
  }

  return {
    matchedProductName,
    shortTitle: options.metadata.shortTitle,
    brand: options.metadata.brand,
    spu: options.metadata.spu,
    updatedWorkbookFiles: [...options.distributedWorkbookFiles],
    simulated: options.simulateOnly
  };
}
