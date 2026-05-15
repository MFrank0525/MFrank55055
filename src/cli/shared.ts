import fs from "fs";
import path from "path";
import type { AnalysisResult, ProductInput } from "../types/index.js";
import { readJson } from "../storage/db.js";
import { getLatestSnapshotByKeyword } from "../storage/search-repo.js";

export function getArg(name: string, defaultValue = ""): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || defaultValue : defaultValue;
}

export function requireArg(name: string): string {
  const value = getArg(name);
  if (!value) throw new Error(`Missing required argument --${name}`);
  return value;
}

export function readProductFile(filePath: string): ProductInput {
  const absolute = path.resolve(filePath);
  return readJson<ProductInput>(absolute);
}

export function readAnalysisFile(filePath: string): AnalysisResult {
  const absolute = path.resolve(filePath);
  return readJson<AnalysisResult>(absolute);
}

export function readSnapshotFile<T>(filePath: string): T {
  const absolute = path.resolve(filePath);
  return readJson<T>(absolute);
}

export function readTermListFile(filePath: string): string[] {
  const absolute = path.resolve(filePath);
  const raw = fs.readFileSync(absolute, "utf8").trim();
  if (!raw) return [];

  if (absolute.endsWith(".json")) {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { terms?: unknown[] }).terms)) {
      return ((parsed as { terms: unknown[] }).terms || []).map((item) => String(item || "").trim()).filter(Boolean);
    }
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getLatestAnalysisByKeyword(keyword: string): AnalysisResult | null {
  const dir = path.join(process.cwd(), "data", "analyzed");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((name) => name.startsWith(`${keyword}-`)).sort().reverse();
  if (!files.length) return null;
  return readJson<AnalysisResult>(path.join(dir, files[0]));
}

export { getLatestSnapshotByKeyword };
