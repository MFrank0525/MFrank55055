import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../utils/platform.js";

const execFileAsync = promisify(execFile);
const AUDIT_SCRIPT = path.join(process.cwd(), "src", "autolist", "main-image-frame-breathing-audit.py");

export async function prepareMainImageFrameBreathingAudit(options: {
  imageFile: string;
  frameFile: string;
  outputFile: string;
}): Promise<string> {
  if (!fs.existsSync(options.imageFile)) throw new Error(`Main image breathing-audit input not found: ${options.imageFile}`);
  if (!fs.existsSync(options.frameFile)) throw new Error(`Main image breathing-audit frame not found: ${options.frameFile}`);
  const { stdout, stderr } = await execFileAsync(
    getPythonCommand(),
    [
      "-X", "utf8", AUDIT_SCRIPT,
      "--input", options.imageFile,
      "--frame", options.frameFile,
      "--output", options.outputFile
    ],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
      env: sanitizePythonRuntimeEnv({ ...process.env, PYTHONIOENCODING: "utf-8" })
    }
  );
  const text = `${stdout}\n${stderr}`.trim();
  const match = text.match(/(\{[^\n]+\})\s*$/u);
  if (!match || !fs.existsSync(options.outputFile)) {
    throw new Error(`Main image breathing-audit crop failed: ${text.slice(-500)}`);
  }
  const payload = JSON.parse(match[1]) as { ok?: boolean; width?: number; height?: number; maskedFrame?: boolean };
  if (!payload.ok || payload.width !== 544 || payload.height !== 104 || payload.maskedFrame !== true) {
    throw new Error(`Main image breathing-audit crop contract mismatch: ${JSON.stringify(payload)}`);
  }
  return options.outputFile;
}
