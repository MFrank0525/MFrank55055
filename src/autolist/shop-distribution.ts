import fs from "node:fs";
import path from "node:path";
import { shopCodeFromFolder } from "./product-category.js";
import type { ShopDistributionArtifact } from "./types.js";

function copyDirectoryRecursive(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function moveDirectory(sourceDir: string, targetDir: string): void {
  try {
    fs.renameSync(sourceDir, targetDir);
  } catch {
    copyDirectoryRecursive(sourceDir, targetDir);
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
}

function resolveShopFolder(shopRootDir: string, productFolder: string, simulateOnly: boolean): string {
  const baseName = path.basename(productFolder);
  const parentShopCode = shopCodeFromFolder(path.basename(path.dirname(productFolder)));
  const shopFolders = fs
    .readdirSync(shopRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(shopRootDir, entry.name));

  const matched = parentShopCode ? shopFolders.find((folder) => shopCodeFromFolder(folder) === parentShopCode) : undefined;
  if (matched) {
    return matched;
  }

  if (!simulateOnly) {
    throw new Error(`No shop folder matched product folder name: ${baseName}`);
  }

  const inferredName = baseName.match(/^(.+?)(\d{2,}.*)$/)?.[1] || "模拟店铺";
  const fallback = path.join(shopRootDir, inferredName);
  if (!simulateOnly) {
    fs.mkdirSync(fallback, { recursive: true });
  }
  return fallback;
}

export function distributeProductFoldersToShops(options: {
  shopRootDir: string;
  productFolders: string[];
  simulateOnly: boolean;
}): ShopDistributionArtifact {
  if (options.simulateOnly) {
    return {
      distributedFolders: [...options.productFolders],
      simulated: true
    };
  }

  if (!options.simulateOnly) {
    fs.mkdirSync(options.shopRootDir, { recursive: true });
  }
  const distributedFolders: string[] = [];

  for (const productFolder of options.productFolders) {
    if (path.resolve(productFolder).startsWith(path.resolve(options.shopRootDir) + path.sep)) {
      distributedFolders.push(productFolder);
      continue;
    }
    const shopFolder = resolveShopFolder(options.shopRootDir, productFolder, options.simulateOnly);
    const targetFolder = path.join(shopFolder, path.basename(productFolder));
    if (options.simulateOnly) {
      distributedFolders.push(targetFolder);
      continue;
    }
    if (fs.existsSync(targetFolder)) {
      throw new Error(`Refusing to overwrite existing shop product folder: ${targetFolder}`);
    }
    moveDirectory(productFolder, targetFolder);
    distributedFolders.push(targetFolder);
  }

  return {
    distributedFolders,
    simulated: options.simulateOnly
  };
}
