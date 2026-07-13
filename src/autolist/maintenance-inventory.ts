import fs from "node:fs";
import path from "node:path";
import { validateFeishuProductPayload } from "../feishu/cache-contract.js";
import { FEISHU_CACHE_SCHEMA_VERSION, FEISHU_FIELD_MAP_VERSION } from "../feishu/cache-contract.js";
import { buildFeishuBatchFingerprint } from "./feishu-batch-rules.js";
import { atomicWriteJson } from "../utils/atomic-file.js";

function existing(rootDir: string, relativePaths: string[]): string[] {
  return relativePaths.map((item) => path.join(rootDir, item)).filter((item) => fs.existsSync(item));
}

function collectDirectoryFiles(dir: string, keepGitkeep = true): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (keepGitkeep && entry.name === ".gitkeep") {
      return [];
    }
    return entry.isDirectory() ? collectDirectoryFiles(entryPath, keepGitkeep) : [entryPath];
  });
}

function collectMatchingFiles(dir: string, pattern: RegExp): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectMatchingFiles(entryPath, pattern);
    }
    return pattern.test(entry.name) ? [entryPath] : [];
  });
}

function collectPreviousControlArtifacts(controlDir: string): string[] {
  if (!fs.existsSync(controlDir)) return [];
  return fs.readdirSync(controlDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return [];
    const filePath = path.join(controlDir, entry.name);
    if (entry.name === "hermes-watchdog-state.json") {
      try {
        const state = JSON.parse(fs.readFileSync(filePath, "utf8")) as { job_key?: string; active_key?: string };
        if (!state.job_key && (!state.active_key || state.active_key === "::0")) return [];
      } catch {
        return [filePath];
      }
    }
    return [filePath];
  });
}

export function collectPreviousBatchArtifactTargets(workspaceRoot: string): string[] {
  const rootDir = path.resolve(workspaceRoot);
  const wholeTargets = existing(rootDir, [
    "docs/superpowers",
    "data/auto-listing/deferred-main-images",
    "data/auto-listing/paid-image-submissions",
    "data/auto-listing/recovery-titles",
    "data/auto-listing/runs",
    "data/auto-listing/shop-access-audits",
    "data/auto-listing/after-duzhong-processed-images.json",
    "data/auto-listing/processed-images.json",
    "input/legacy"
  ]);
  const controlArtifacts = collectPreviousControlArtifacts(path.join(rootDir, "data/auto-listing/control"));
  const generatedJobsDir = path.join(rootDir, "input/auto-listing");
  const generatedJobs = fs.existsSync(generatedJobsDir)
    ? fs.readdirSync(generatedJobsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".generated.json"))
        .map((entry) => path.join(generatedJobsDir, entry.name))
    : [];
  const feishuCacheDir = path.join(rootDir, "data/feishu");
  const feishuCaches = fs.existsSync(feishuCacheDir)
    ? fs.readdirSync(feishuCacheDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^products(?:\..+)?\.json$/i.test(entry.name))
        .map((entry) => path.join(feishuCacheDir, entry.name))
        .filter((filePath) => {
          if (path.basename(filePath) !== "products.json") return true;
          try {
            return validateFeishuProductPayload(JSON.parse(fs.readFileSync(filePath, "utf8"))).records.length > 0;
          } catch {
            return true;
          }
        })
    : [];
  const batchAssetFiles = [
    "input/auto-listing/feishu-images",
    "input/auto-listing/qualifications",
    "input/auto-listing/main-images",
    "input/auto-listing/titles",
    "input/auto-listing/shops"
  ].flatMap((relativeDir) => collectDirectoryFiles(path.join(rootDir, relativeDir)));
  const metadataFiles = collectMatchingFiles(rootDir, /^\.DS_Store$/);

  return Array.from(new Set([...wholeTargets, ...controlArtifacts, ...feishuCaches, ...generatedJobs, ...batchAssetFiles, ...metadataFiles]))
    .sort((a, b) => a.localeCompare(b));
}

export function writeIdleFeishuCache(workspaceRoot: string): string {
  const filePath = path.join(path.resolve(workspaceRoot), "data/feishu/products.json");
  atomicWriteJson(filePath, {
    schemaVersion: FEISHU_CACHE_SCHEMA_VERSION,
    fieldMapVersion: FEISHU_FIELD_MAP_VERSION,
    batchFingerprint: buildFeishuBatchFingerprint([]),
    records: []
  });
  return filePath;
}
