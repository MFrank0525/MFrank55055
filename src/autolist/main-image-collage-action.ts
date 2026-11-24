import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../utils/platform.js";

const execFileAsync = promisify(execFile);
const COLLAGE_DETECTOR_SCRIPT = path.join(process.cwd(), "src", "autolist", "main-image-collage-detector.py");

export const MAIN_IMAGE_COLLAGE_GATE_VERSION = "cross-axis-multi-panel-v1";
export const MAIN_IMAGE_COLLAGE_REJECTION_CODE = "main_image_collage_rejected";
export const MAIN_IMAGE_COLLAGE_RETRY_EXHAUSTED_CODE = "main_image_collage_retry_exhausted";
export const MAX_MAIN_IMAGE_COLLAGE_OUTPUTS_PER_SLOT = 3;

export const MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT =
  "不可覆盖的单图约束：只输出一张连续、完整、单场景的商品海报，即单张完整海报。禁止四宫格、九宫格、2×2网格、4合1、拼图、分屏、分栏、多面板、联系表、前后对比拼接、象限重复商品或在一张图内排列多张海报。";

export interface MainImageCollageInspection {
  ok: boolean;
  gateVersion: string;
  collageDetected: boolean;
  reason: string;
  analysisSize: { width: number; height: number };
  vertical: Record<string, unknown>;
  horizontal: Record<string, unknown>;
  quadrantStddevs: number[];
  texturedQuadrants: number;
}

export function isMainImageCollageRejectionReason(reason: string): boolean {
  return new RegExp(MAIN_IMAGE_COLLAGE_REJECTION_CODE, "i").test(String(reason || "")) ||
    /Main image collage rejected before watermark\/distribution/i.test(String(reason || ""));
}

export function resolveMainImageCollageRetry(input: {
  audit: Array<{ state?: string; reason?: string }>;
}): { retry: boolean; rejectedOutputCount: number; maxOutputs: number } {
  const rejectedOutputCount = input.audit.filter(
    (entry) => entry.state === "failed_after_acceptance" && isMainImageCollageRejectionReason(entry.reason || "")
  ).length;
  return {
    retry: rejectedOutputCount < MAX_MAIN_IMAGE_COLLAGE_OUTPUTS_PER_SLOT,
    rejectedOutputCount,
    maxOutputs: MAX_MAIN_IMAGE_COLLAGE_OUTPUTS_PER_SLOT
  };
}

export function archiveRejectedMainImageCollage(options: {
  imageFile: string;
  archiveRoot: string;
  slot: number;
}): { archiveDir: string; archivedFiles: string[] } {
  const slotDir = path.join(options.archiveRoot, `slot-${String(options.slot).padStart(2, "0")}`);
  fs.mkdirSync(slotDir, { recursive: true });
  const attempt = fs.readdirSync(slotDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^attempt-\d+$/.test(entry.name)).length + 1;
  const archiveDir = path.join(slotDir, `attempt-${String(attempt).padStart(2, "0")}`);
  fs.mkdirSync(archiveDir, { recursive: false });
  const candidates = [options.imageFile, `${options.imageFile}.collage-rejected.json`].filter((file) => fs.existsSync(file));
  if (!candidates.length) throw new Error(`Rejected collage evidence is missing for slot ${options.slot}`);
  const archivedFiles = candidates.map((file) => {
    const target = path.join(archiveDir, path.basename(file));
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    return target;
  });
  return { archiveDir, archivedFiles };
}

export async function inspectMainImageCollage(imageFile: string): Promise<MainImageCollageInspection> {
  if (!fs.existsSync(imageFile)) throw new Error(`Main image not found for no-collage inspection: ${imageFile}`);
  const { stdout, stderr } = await execFileAsync(
    getPythonCommand(),
    ["-X", "utf8", COLLAGE_DETECTOR_SCRIPT, "--input", imageFile],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
      env: sanitizePythonRuntimeEnv({ ...process.env, PYTHONIOENCODING: "utf-8" })
    }
  );
  const text = `${stdout}\n${stderr}`.trim();
  const match = text.match(/(\{[\s\S]*\})\s*$/u);
  if (!match) throw new Error(`Main image no-collage detector returned no JSON: ${text.slice(-500)}`);
  const result = JSON.parse(match[1]) as MainImageCollageInspection;
  if (
    !result.ok ||
    result.gateVersion !== MAIN_IMAGE_COLLAGE_GATE_VERSION ||
    typeof result.collageDetected !== "boolean"
  ) {
    throw new Error(`Main image no-collage detector returned an invalid result: ${JSON.stringify(result)}`);
  }
  return result;
}

export async function assertMainImageIsSinglePoster(options: {
  imageFile: string;
}): Promise<MainImageCollageInspection> {
  const inspection = await inspectMainImageCollage(options.imageFile);
  if (!inspection.collageDetected) return inspection;
  const evidenceFile = `${options.imageFile}.collage-rejected.json`;
  fs.writeFileSync(
    evidenceFile,
    `${JSON.stringify({ imageFile: path.resolve(options.imageFile), rejectedAt: new Date().toISOString(), ...inspection }, null, 2)}\n`,
    "utf8"
  );
  throw new Error(
    `${MAIN_IMAGE_COLLAGE_REJECTION_CODE}: Main image collage rejected before watermark/distribution: 四宫格/拼图/多面板结构 detected; image=${options.imageFile}; evidence=${evidenceFile}`
  );
}
