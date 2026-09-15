import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { inspectDecodedImageFile } from "../utils/image-integrity.js";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../utils/platform.js";

const execFileAsync = promisify(execFile);
export const VIDEOS_BASE64_REFERENCE_MAX_BYTES = 5_500_000;
const VIDEOS_BASE64_REFERENCE_MAX_SIDE = 2048;
const NORMALIZER = path.join(process.cwd(), "src", "autolist", "videos-base64-reference-normalizer.py");

export async function prepareVideosBase64ReferenceImage(options: {
  sourceImagePath: string;
  outputDir: string;
}): Promise<string> {
  if (!fs.existsSync(options.sourceImagePath)) throw new Error("videos-base64 reference image not found: " + options.sourceImagePath);
  if (fs.statSync(options.sourceImagePath).size <= VIDEOS_BASE64_REFERENCE_MAX_BYTES) return options.sourceImagePath;
  inspectDecodedImageFile(options.sourceImagePath);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputFile = path.join(options.outputDir, "reference-input.jpg");
  const evidenceFile = path.join(options.outputDir, "reference-input-normalization.json");
  const { stdout } = await execFileAsync(
    getPythonCommand(),
    ["-X", "utf8", NORMALIZER, "--input", options.sourceImagePath, "--output", outputFile, "--max-side", String(VIDEOS_BASE64_REFERENCE_MAX_SIDE), "--max-bytes", String(VIDEOS_BASE64_REFERENCE_MAX_BYTES)],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: sanitizePythonRuntimeEnv({ ...process.env, PYTHONIOENCODING: "utf-8" })
    }
  );
  inspectDecodedImageFile(outputFile);
  const outputBytes = fs.statSync(outputFile).size;
  if (outputBytes > VIDEOS_BASE64_REFERENCE_MAX_BYTES) throw new Error(`videos-base64 normalized reference image still exceeds byte ceiling: ${outputBytes}`);
  fs.writeFileSync(evidenceFile, JSON.stringify({
    ...JSON.parse(stdout),
    sourceFile: path.basename(options.sourceImagePath),
    outputFile: path.basename(outputFile),
    maxBytes: VIDEOS_BASE64_REFERENCE_MAX_BYTES
  }, null, 2) + "\n", "utf8");
  return outputFile;
}
