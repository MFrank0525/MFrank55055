import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ARCHIVE_ROOT } from "./archive-main-images.js";
import { selectCleanupTargets, selectStaleRunHistoryTargets } from "./cleanup-rules.js";
import { isManifestEntryAcceptedForBatchCompletion } from "./publish-manifest.js";
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

export interface MaintenanceCleanupResult {
  selectedPaths: string[];
  removedPaths: string[];
  applied: boolean;
}

export function cleanupMaintenanceResidue(options: {
  targets: string[];
  apply: boolean;
  workspaceRoot?: string;
}): MaintenanceCleanupResult {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const selectedPaths = Array.from(new Set(options.targets.filter(Boolean).map((target) => path.resolve(target))));
  const removedPaths: string[] = [];

  for (const target of selectedPaths) {
    const relative = path.relative(workspaceRoot, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing unsafe maintenance cleanup target outside workspace: ${target}`);
    }
    assertSafeCleanupTarget(target);
    if (!options.apply || !fs.existsSync(target)) {
      continue;
    }
    const stat = fs.statSync(target);
    fs.rmSync(target, stat.isDirectory() ? { recursive: true, force: true } : { force: true });
    removedPaths.push(target);
  }

  return { selectedPaths, removedPaths, applied: options.apply };
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
  mainImageWorkDir?: string;
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

function collectRunDirs(runtimeRootDir: string): string[] {
  if (!fs.existsSync(runtimeRootDir)) {
    return [];
  }
  return fs
    .readdirSync(runtimeRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runtimeRootDir, entry.name));
}

function runHasUnresolvedPublishBoundary(runDir: string): boolean {
  const manifestFile = path.join(runDir, "publish-manifest.json");
  if (!fs.existsSync(manifestFile)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { entries?: Array<Record<string, unknown>> };
    return (manifest.entries || []).some((entry) =>
      entry.status === "pending"
      || entry.status === "failed"
      || !isManifestEntryAcceptedForBatchCompletion(entry as never)
    );
  } catch {
    return true;
  }
}

export function cleanupStaleRunHistory(options: {
  runtimeRootDir: string;
  activeRuntimeDir: string;
  protectedRunDirs?: string[];
  cleanupAfterPublish: boolean;
  simulateOnly: boolean;
}): CleanupArtifact {
  const removedPaths: string[] = [];
  if (!options.cleanupAfterPublish || options.simulateOnly) {
    return {
      removedPaths,
      simulated: options.simulateOnly
    };
  }

  const runDirs = collectRunDirs(options.runtimeRootDir);
  const unresolvedPublishRunDirs = runDirs.filter(runHasUnresolvedPublishBoundary);
  const targets = selectStaleRunHistoryTargets({
    runDirs,
    activeRunDir: options.activeRuntimeDir,
    protectedRunDirs: [...(options.protectedRunDirs || []), ...unresolvedPublishRunDirs]
  });

  for (const target of targets) {
    assertSafeCleanupTarget(target);
    if (!fs.existsSync(target)) {
      continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
    removedPaths.push(target);
  }

  return {
    removedPaths,
    simulated: false
  };
}
