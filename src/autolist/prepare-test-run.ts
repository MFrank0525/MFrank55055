import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ARCHIVE_ROOT } from "./archive-main-images.js";

function safeRemove(targetPath: string, removed: string[]): void {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return;
  }
  assertSafeRemoveTarget(targetPath);
  fs.rmSync(targetPath, { recursive: true, force: true });
  removed.push(targetPath);
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertSafeRemoveTarget(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const workspaceRoot = path.resolve(process.cwd());
  const homeDir = path.resolve(os.homedir());
  const archiveRoot = path.resolve(DEFAULT_ARCHIVE_ROOT);
  const filesystemRoot = path.parse(resolved).root;

  if (
    resolved === filesystemRoot ||
    resolved === workspaceRoot ||
    resolved === homeDir ||
    resolved === archiveRoot ||
    pathContains(resolved, archiveRoot) ||
    pathContains(archiveRoot, resolved)
  ) {
    throw new Error(`Refusing to clear unsafe pre-run output path: ${targetPath}`);
  }
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

function clearMainImageDir(mainImageWorkDir: string, removed: string[]): void {
  if (!fs.existsSync(mainImageWorkDir)) {
    return;
  }
  for (const entry of fs.readdirSync(mainImageWorkDir, { withFileTypes: true })) {
    if (entry.name === ".gitkeep") {
      continue;
    }
    safeRemove(path.join(mainImageWorkDir, entry.name), removed);
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
  mainImageWorkDir: string;
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
  clearMainImageDir(options.mainImageWorkDir, removed);
  clearTitleDir(options.titleDir, removed);
  clearShopRoot(options.shopRootDir, removed);
  return removed;
}
