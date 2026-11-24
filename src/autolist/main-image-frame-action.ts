import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../utils/platform.js";
import { sha256File } from "./paid-image-submission-ledger.js";
import { MAIN_IMAGE_FRAME_LAYOUT_VERSION } from "./main-image-frame-rules.js";

const execFileAsync = promisify(execFile);
const FRAME_SCRIPT = path.join(process.cwd(), "src", "autolist", "main-image-frame.py");
export { MAIN_IMAGE_FRAME_LAYOUT_VERSION } from "./main-image-frame-rules.js";
const FRAME_CONTENT_RECT = { x: 0, y: 0, width: 800, height: 800 } as const;

function isExpectedFrameLayout(payload: {
  layoutVersion?: string;
  contentRect?: { x?: number; y?: number; width?: number; height?: number };
}): boolean {
  return payload.layoutVersion === MAIN_IMAGE_FRAME_LAYOUT_VERSION &&
    payload.contentRect?.x === FRAME_CONTENT_RECT.x &&
    payload.contentRect?.y === FRAME_CONTENT_RECT.y &&
    payload.contentRect?.width === FRAME_CONTENT_RECT.width &&
    payload.contentRect?.height === FRAME_CONTENT_RECT.height;
}

async function runFrameScript(args: string[]): Promise<{
  ok?: boolean;
  error?: string;
  layoutVersion?: string;
  contentRect?: { x?: number; y?: number; width?: number; height?: number };
}> {
  const { stdout, stderr } = await execFileAsync(
    getPythonCommand(),
    ["-X", "utf8", FRAME_SCRIPT, ...args],
    { windowsHide: true, maxBuffer: 1024 * 1024 * 8, env: sanitizePythonRuntimeEnv({ ...process.env, PYTHONIOENCODING: "utf-8" }) }
  );
  const text = `${stdout}\n${stderr}`.trim();
  const match = text.match(/(\{[\s\S]*\})\s*$/);
  if (!match) throw new Error(`Main image frame script returned no JSON: ${text.slice(-500)}`);
  return JSON.parse(match[1]);
}

export async function applyMainImageFrame(options: {
  inputFile: string;
  frameFile: string;
  outputFile: string;
  frameReadyFile?: string;
}): Promise<string> {
  if (!fs.existsSync(options.frameFile)) throw new Error(`Main image frame file not found: ${options.frameFile}`);
  const payload = await runFrameScript([
    "--mode", "apply-frame",
    "--input", options.inputFile,
    "--frame", options.frameFile,
    "--output", options.outputFile,
    ...(options.frameReadyFile ? ["--frame-ready-output", options.frameReadyFile] : [])
  ]);
  if (!payload.ok || !fs.existsSync(options.outputFile)) throw new Error(payload.error || "Main image frame output was not created.");
  if (!isExpectedFrameLayout(payload)) {
    throw new Error(`Main image frame script layout contract mismatch: ${JSON.stringify(payload)}`);
  }
  return options.outputFile;
}

export async function ensureMainImageFrameApplied(imageFile: string, frameFile?: string): Promise<boolean> {
  if (!frameFile) return false;
  const markerFile = `${imageFile}.frame.json`;
  const unframedFile = `${imageFile}.unframed.png`;
  const frameReadyFile = `${imageFile}.frame-ready.png`;
  const frameDigest = sha256File(frameFile);
  let markerExisted = false;
  if (fs.existsSync(markerFile)) {
    markerExisted = true;
    try {
      const marker = JSON.parse(fs.readFileSync(markerFile, "utf8")) as {
        frameDigest?: string;
        outputDigest?: string;
        unframedDigest?: string;
        frameReadyDigest?: string;
        layoutVersion?: string;
      };
      if (marker.layoutVersion && marker.layoutVersion !== MAIN_IMAGE_FRAME_LAYOUT_VERSION) {
        throw new Error(
          `Main image uses obsolete frame layout ${marker.layoutVersion}; regenerate it with ${MAIN_IMAGE_FRAME_LAYOUT_VERSION} instead of re-framing the legacy provider output.`
        );
      }
      if (
        marker.layoutVersion === MAIN_IMAGE_FRAME_LAYOUT_VERSION &&
        marker.frameDigest === frameDigest &&
        marker.outputDigest === sha256File(imageFile) &&
        fs.existsSync(frameReadyFile) &&
        marker.frameReadyDigest === sha256File(frameReadyFile)
      ) return false;
    } catch (error) {
      if (error instanceof Error && /obsolete frame layout/.test(error.message)) throw error;
      // Regenerate the framed image when the evidence marker is invalid.
    }
  }
  if (!fs.existsSync(unframedFile)) {
    if (markerExisted) {
      throw new Error(`Legacy framed image lacks preserved unframed provider output: ${imageFile}`);
    }
    fs.copyFileSync(imageFile, unframedFile);
  }
  const temporaryFile = `${imageFile}.frame-tmp.png`;
  await applyMainImageFrame({
    inputFile: unframedFile,
    frameFile,
    outputFile: temporaryFile,
    frameReadyFile
  });
  fs.renameSync(temporaryFile, imageFile);
  fs.writeFileSync(
    markerFile,
    JSON.stringify(
      {
        frameDigest,
        layoutVersion: MAIN_IMAGE_FRAME_LAYOUT_VERSION,
        contentRect: FRAME_CONTENT_RECT,
        unframedFile: path.basename(unframedFile),
        unframedDigest: sha256File(unframedFile),
        frameReadyFile: path.basename(frameReadyFile),
        frameReadyDigest: sha256File(frameReadyFile),
        outputDigest: sha256File(imageFile)
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  return true;
}
