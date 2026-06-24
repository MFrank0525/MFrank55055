import path from "node:path";
import { atomicWriteJson } from "../../utils/atomic-file.js";
import type { PublishFromSpuJobResult } from "./types.js";

export function writePublishJobResult(result: PublishFromSpuJobResult): PublishFromSpuJobResult {
  const resultFile = result.artifacts.resultFile || path.join(result.runtimeDir, "result.json");
  atomicWriteJson(resultFile, result);
  return result;
}
