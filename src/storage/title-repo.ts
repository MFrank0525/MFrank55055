import path from "path";
import type { AnalysisResult, GenerationResult } from "../types/index.js";
import { fileTimestamp } from "../utils/time.js";
import { writeJson } from "./db.js";

export function saveAnalysisResult(data: AnalysisResult): string {
  const filePath = path.join(process.cwd(), "data", "analyzed", `${data.keyword}-${fileTimestamp()}.json`);
  writeJson(filePath, data);
  return filePath;
}

export function saveGeneratedTitles(data: GenerationResult): string {
  const filePath = path.join(process.cwd(), "data", "generated", `${data.keyword}-${fileTimestamp()}.json`);
  writeJson(filePath, data);
  return filePath;
}
