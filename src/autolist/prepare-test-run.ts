import fs from "node:fs";
import path from "node:path";

function safeRemove(targetPath: string, removed: string[]): void {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
  removed.push(targetPath);
}

function clearRuntimeDir(runtimeDir: string, removed: string[]): void {
  if (!fs.existsSync(runtimeDir)) {
    return;
  }
  for (const entry of fs.readdirSync(runtimeDir)) {
    safeRemove(path.join(runtimeDir, entry), removed);
  }
}

function clearTitleDir(titleDir: string, removed: string[]): void {
  if (!fs.existsSync(titleDir)) {
    return;
  }
  for (const entry of fs.readdirSync(titleDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(xlsx|csv)$/i.test(entry.name)) {
      safeRemove(path.join(titleDir, entry.name), removed);
    }
  }
}

function clearJimengDir(jimengImageDir: string, removed: string[]): void {
  if (!fs.existsSync(jimengImageDir)) {
    return;
  }
  for (const entry of fs.readdirSync(jimengImageDir, { withFileTypes: true })) {
    if (entry.isFile() && /^即梦提示词\d{2}\.docx$/i.test(entry.name)) {
      continue;
    }
    safeRemove(path.join(jimengImageDir, entry.name), removed);
  }
}

function clearShopRoot(shopRootDir: string, removed: string[]): void {
  if (!fs.existsSync(shopRootDir)) {
    return;
  }
  for (const shopEntry of fs.readdirSync(shopRootDir, { withFileTypes: true })) {
    if (!shopEntry.isDirectory()) {
      continue;
    }
    const shopFolder = path.join(shopRootDir, shopEntry.name);
    for (const entry of fs.readdirSync(shopFolder, { withFileTypes: true })) {
      const targetPath = path.join(shopFolder, entry.name);
      if (entry.isDirectory() && entry.name.includes("水印")) {
        safeRemove(targetPath, removed);
        continue;
      }
      if (entry.isFile() && entry.name.includes("水印") && /\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
        safeRemove(targetPath, removed);
      }
    }
  }
}

export function prepareTestRunOutputs(options: {
  runtimeDir: string;
  jimengImageDir: string;
  titleDir: string;
  shopRootDir: string;
  enabled: boolean;
  simulateOnly: boolean;
}): string[] {
  const removed: string[] = [];
  if (!options.enabled || options.simulateOnly) {
    return removed;
  }

  clearRuntimeDir(options.runtimeDir, removed);
  clearJimengDir(options.jimengImageDir, removed);
  clearTitleDir(options.titleDir, removed);
  clearShopRoot(options.shopRootDir, removed);
  return removed;
}
