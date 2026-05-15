import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WATERMARK_SCRIPT = path.join(process.cwd(), "src", "autolist", "local-watermark.py");

function outputPathFor(inputFile: string, outputDir: string): string {
  const ext = path.extname(inputFile) || ".png";
  const base = path.basename(inputFile, ext);
  return path.join(outputDir, `${base}-watermarked${ext}`);
}

async function runWatermark(inputFile: string, outputFile: string, watermarkText: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    "python",
    ["-X", "utf8", WATERMARK_SCRIPT, "--input", inputFile, "--output", outputFile, "--text", watermarkText],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8"
      }
    }
  );

  const text = `${stdout}\n${stderr}`.trim();
  const match = text.match(/(\{[\s\S]*\})\s*$/);
  if (!match) {
    throw new Error(`Local watermark script returned no JSON: ${text.slice(-500)}`);
  }
  const payload = JSON.parse(match[1]);
  if (!payload.ok) {
    throw new Error(payload.error || "Local watermark script failed.");
  }
  if (!fs.existsSync(outputFile)) {
    throw new Error(`Local watermark output not found: ${outputFile}`);
  }
  return outputFile;
}

export async function applyLocalWatermark(options: {
  inputFiles: string[];
  outputDir: string;
  watermarkText: string;
}): Promise<string[]> {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const outputs: string[] = [];
  for (const inputFile of options.inputFiles) {
    const outputFile = outputPathFor(inputFile, options.outputDir);
    outputs.push(await runWatermark(inputFile, outputFile, options.watermarkText));
  }
  return outputs;
}
