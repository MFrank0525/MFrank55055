import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ARCHIVE_ROOT } from "./archive-main-images.js";
import { selectCleanupTargets } from "./cleanup-rules.js";
import { selectMaintenanceResidueTargets } from "./maintenance-rules.js";
import type { CleanupArtifact } from "./types.js";

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertSafeCleanupTarget(target: string): void {
  const resolved = path.resolve(target);
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
    throw new Error(`Refusing to clean unsafe path: ${target}`);
  }
}

function collectTitleDirTargets(titleDir?: string): string[] {
  if (!titleDir || !fs.existsSync(titleDir)) {
    return [];
  }
  return fs
    .readdirSync(titleDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(xlsx|csv)$/i.test(entry.name))
    .map((entry) => path.join(titleDir, entry.name));
}

function collectJimengDirTargets(jimengImageDir?: string): string[] {
  if (!jimengImageDir || !fs.existsSync(jimengImageDir)) {
    return [];
  }
  return fs
    .readdirSync(jimengImageDir, { withFileTypes: true })
    .filter((entry) => entry.name !== ".gitkeep")
    .map((entry) => path.join(jimengImageDir, entry.name));
}

function collectDirectoryChildren(dir?: string): string[] {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== ".gitkeep")
    .map((entry) => path.join(dir, entry.name));
}

function collectShopRootStaleTargets(shopRootDir?: string): string[] {
  if (!shopRootDir || !fs.existsSync(shopRootDir)) {
    return [];
  }

  return fs.readdirSync(shopRootDir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(shopRootDir, entry.name);
    if (entry.name === ".gitkeep") {
      return [];
    }
    if (!entry.isDirectory()) {
      return [entryPath];
    }
    return collectDirectoryChildren(entryPath);
  });
}

function collectGeneratedResumeJobTargets(autoListingInputDir?: string): string[] {
  if (!autoListingInputDir || !fs.existsSync(autoListingInputDir)) {
    return [];
  }
  return fs
    .readdirSync(autoListingInputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.resume\.generated\.json$/i.test(entry.name))
    .map((entry) => path.join(autoListingInputDir, entry.name));
}

function collectGeneratedMaintenanceResidueTargets(autoListingInputDir?: string): string[] {
  if (!autoListingInputDir || !fs.existsSync(autoListingInputDir)) {
    return [];
  }
  const candidates = fs
    .readdirSync(autoListingInputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.generated\.json$/i.test(entry.name))
    .map((entry) => path.join(autoListingInputDir, entry.name));
  return selectMaintenanceResidueTargets({ filePaths: candidates }).map((target) => target.filePath);
}

export function cleanupAfterPublish(options: {
  distributedFolders: string[];
  titleWorkbookFiles: string[];
  wordFiles?: string[];
  sourceImagePath: string;
  sourceAssetFiles?: string[];
  cleanupSourceImageAfterPublish?: boolean;
  taskRuntimeDir?: string;
  publishRuntimeDirs?: string[];
  feishuImageDir?: string;
  qualificationDir?: string;
  shopRootDir?: string;
  autoListingInputDir?: string;
  titleDir?: string;
  jimengImageDir?: string;
  protectedAssetFiles?: string[];
  cleanupAfterPublish: boolean;
  simulateOnly: boolean;
}): CleanupArtifact {
  const removedPaths: string[] = [];
  if (!options.cleanupAfterPublish) {
    return {
      removedPaths,
      simulated: options.simulateOnly
    };
  }

  const targets = [
    ...options.distributedFolders,
    ...options.titleWorkbookFiles,
    ...(options.wordFiles || []),
    ...(options.publishRuntimeDirs || []),
    ...(options.taskRuntimeDir ? [options.taskRuntimeDir] : []),
    ...collectTitleDirTargets(options.titleDir),
    ...collectJimengDirTargets(options.jimengImageDir),
    ...(!options.simulateOnly
      ? [
          ...collectDirectoryChildren(options.feishuImageDir),
          ...collectDirectoryChildren(options.qualificationDir),
          ...collectDirectoryChildren(options.titleDir),
          ...collectDirectoryChildren(options.jimengImageDir),
          ...collectShopRootStaleTargets(options.shopRootDir),
          ...collectGeneratedResumeJobTargets(options.autoListingInputDir),
          ...collectGeneratedMaintenanceResidueTargets(options.autoListingInputDir)
        ]
      : []),
    ...(!options.simulateOnly && options.cleanupSourceImageAfterPublish
      ? [options.sourceImagePath, ...(options.sourceAssetFiles || [])]
      : [])
  ];
  const uniqueTargets = selectCleanupTargets({
    candidates: targets,
    protectedPaths: options.protectedAssetFiles || []
  });
  for (const target of uniqueTargets) {
    if (!target) {
      continue;
    }
    assertSafeCleanupTarget(target);
    if (fs.existsSync(target)) {
      if (!options.simulateOnly) {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          fs.rmSync(target, { recursive: true, force: true });
        } else {
          fs.rmSync(target, { force: true });
        }
      }
      removedPaths.push(target);
    }
  }

  return {
    removedPaths,
    simulated: options.simulateOnly
  };
}
