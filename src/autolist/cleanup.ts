import fs from "node:fs";
import type { CleanupArtifact } from "./types.js";

export function cleanupAfterPublish(options: {
  distributedFolders: string[];
  titleWorkbookFiles: string[];
  wordFiles?: string[];
  sourceImagePath: string;
  taskRuntimeDir?: string;
  publishRuntimeDirs?: string[];
  titleDir?: string;
  jimengImageDir?: string;
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

  const titleDirFiles =
    options.titleDir && fs.existsSync(options.titleDir)
      ? fs
          .readdirSync(options.titleDir)
          .map((name) => `${options.titleDir}\\${name}`)
          .filter((file) => fs.existsSync(file))
      : [];
  const jimengDirFiles =
    options.jimengImageDir && fs.existsSync(options.jimengImageDir)
      ? fs
          .readdirSync(options.jimengImageDir)
          .map((name) => `${options.jimengImageDir}\\${name}`)
          .filter((file) => fs.existsSync(file))
      : [];

  const targets = [
    ...options.distributedFolders,
    ...options.titleWorkbookFiles,
    ...(options.wordFiles || []),
    ...(options.publishRuntimeDirs || []),
    ...(options.taskRuntimeDir ? [options.taskRuntimeDir] : []),
    ...titleDirFiles,
    ...jimengDirFiles,
    options.sourceImagePath
  ];
  const uniqueTargets = Array.from(new Set(targets.filter(Boolean)));
  for (const target of uniqueTargets) {
    if (!target) {
      continue;
    }
    if (options.simulateOnly) {
      removedPaths.push(target);
      continue;
    }
    if (fs.existsSync(target)) {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.rmSync(target, { force: true });
      }
      removedPaths.push(target);
    }
  }

  return {
    removedPaths,
    simulated: options.simulateOnly
  };
}
