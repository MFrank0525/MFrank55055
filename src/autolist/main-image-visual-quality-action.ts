import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../utils/platform.js";

const execFileAsync = promisify(execFile);
const QUALITY_SCRIPT = path.join(process.cwd(), "src", "autolist", "main-image-visual-quality.py");

export const MAIN_IMAGE_VISUAL_QUALITY_GATE_VERSION = "main-image-visual-diversity-v1";

export interface MainImageVisualQualityReport {
  ok: boolean;
  gateVersion: string;
  expectedImageCount: number;
  actualImageCount: number;
  goldDominantCount: number;
  maxGoldDominantCount: number;
  issues: Array<{ code: string; [key: string]: unknown }>;
}

export async function inspectMainImageSetVisualQuality(options: {
  imageFiles: string[];
  reportFile: string;
  expectedImageCount: number;
  imagesPerRound: number;
}): Promise<MainImageVisualQualityReport> {
  const args = [
    "-X", "utf8", QUALITY_SCRIPT,
    ...options.imageFiles.flatMap((file) => ["--input", file]),
    "--expected", String(options.expectedImageCount),
    "--images-per-round", String(options.imagesPerRound),
    "--report", options.reportFile
  ];
  try {
    await execFileAsync(getPythonCommand(), args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      env: sanitizePythonRuntimeEnv({ ...process.env, PYTHONIOENCODING: "utf-8" })
    });
  } catch (error) {
    if (!fs.existsSync(options.reportFile)) throw error;
  }
  if (!fs.existsSync(options.reportFile)) {
    throw new Error("Main-image visual quality gate produced no report.");
  }
  const report = JSON.parse(fs.readFileSync(options.reportFile, "utf8")) as MainImageVisualQualityReport;
  if (report.gateVersion !== MAIN_IMAGE_VISUAL_QUALITY_GATE_VERSION || typeof report.ok !== "boolean") {
    throw new Error(`Main-image visual quality gate returned an invalid report: ${JSON.stringify(report)}`);
  }
  return report;
}

export async function assertMainImageSetVisualQuality(options: {
  imageFiles: string[];
  reportFile: string;
  expectedImageCount: number;
  imagesPerRound: number;
}): Promise<MainImageVisualQualityReport> {
  const report = await inspectMainImageSetVisualQuality(options);
  if (report.ok) return report;
  const codes = report.issues.map((issue) => issue.code).join(", ") || "unknown";
  throw new Error(
    `main_image_visual_quality_rejected: visual quality gate rejected the ${report.actualImageCount}-image set; issues=${codes}; evidence=${options.reportFile}`
  );
}
