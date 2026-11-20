import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../utils/platform.js";

const execFileAsync = promisify(execFile);
const COLLAGE_DETECTOR_SCRIPT = path.join(process.cwd(), "src", "autolist", "main-image-collage-detector.py");

export const MAIN_IMAGE_COLLAGE_GATE_VERSION = "cross-axis-multi-panel-v1";

export const MAIN_IMAGE_SINGLE_POSTER_PROMPT_CONTRACT =
  "不可覆盖的单图构图约束：本次请求只能输出一张单场景、单画布、完整独立的商品主图，即单张完整海报。禁止四宫格、九宫格、2×2网格、4合1、拼图、分屏、分栏、多面板、联系表、前后对比拼接，禁止把多个独立场景或多张海报排列在同一张图内，禁止用贯穿画布的横线和竖线把画面切成多个区域，禁止在四个象限重复展示商品。即使其他文字出现“四张、4张、多张、不同场景”，也只表示多个独立请求；本次输出仍必须是一张连续完整海报。";

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
    `Main image collage rejected before watermark/distribution: 四宫格/拼图/多面板结构 detected; image=${options.imageFile}; evidence=${evidenceFile}`
  );
}
