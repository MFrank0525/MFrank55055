import fs from "fs";
import path from "path";
import type { SearchSnapshot } from "../types/index.js";
import { fileTimestamp } from "../utils/time.js";
import { readJson, writeJson } from "./db.js";

const RAW_DIR = path.join(process.cwd(), "data", "raw");

function slugifyKeyword(keyword: string): string {
  return Buffer.from(keyword, "utf8").toString("hex").slice(0, 32) || "keyword";
}

export function saveRawSearchSnapshot(data: SearchSnapshot): string {
  const filePath = path.join(RAW_DIR, `snapshot-${slugifyKeyword(data.keyword)}-${fileTimestamp()}.json`);
  writeJson(filePath, data);
  return filePath;
}

export function getLatestSnapshotByKeyword(keyword: string): SearchSnapshot | null {
  if (!fs.existsSync(RAW_DIR)) return null;
  const files = fs.readdirSync(RAW_DIR).filter((name) => name.endsWith(".json")).sort().reverse();
  for (const file of files) {
    const snapshot = readJson<SearchSnapshot>(path.join(RAW_DIR, file));
    if (snapshot.keyword === keyword) {
      return snapshot;
    }
  }
  return null;
}
