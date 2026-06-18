import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getPythonCommand } from "../../utils/platform.js";
import {
  resolveQualificationImageResize,
  verifyNormalizedQualificationImage
} from "./qualification-image-rules.js";

const execFileAsync = promisify(execFile);
const NORMALIZER_SCRIPT = path.join(
  process.cwd(),
  "src",
  "business",
  "publish-from-spu",
  "qualification-image-normalizer.py"
);

type ImageProbe = {
  ok: boolean;
  width: number;
  height: number;
  format?: string;
  error?: string;
};

export type PreparedQualificationImages = {
  files: string[];
  entries: Array<{
    sourceFile: string;
    outputFile: string;
    action: "reuse" | "resize";
    sourceDimensions: { width: number; height: number };
    outputDimensions: { width: number; height: number };
  }>;
};

function fileHash(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parsePayload(output: string, context: string): ImageProbe {
  const text = output.trim();
  const match = text.match(/(\{[\s\S]*\})\s*$/);
  if (!match) {
    throw new Error(`${context}: image processor returned no JSON. output=${text.slice(-500)}`);
  }
  const payload = JSON.parse(match[1]) as ImageProbe;
  if (!payload.ok) {
    throw new Error(`${context}: ${payload.error || "image processor failed"}`);
  }
  return payload;
}

async function runProcessor(args: string[], context: string): Promise<ImageProbe> {
  try {
    const { stdout, stderr } = await execFileAsync(
      getPythonCommand(),
      ["-X", "utf8", NORMALIZER_SCRIPT, ...args],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
        encoding: "utf8",
        env: { ...process.env, PYTHONIOENCODING: "utf-8" }
      }
    );
    return parsePayload(`${stdout}\n${stderr}`, context);
  } catch (error) {
    const stdout = String((error as { stdout?: string }).stdout || "");
    const stderr = String((error as { stderr?: string }).stderr || "");
    const details = `${stdout}\n${stderr}`.trim();
    if (details) {
      return parsePayload(details, context);
    }
    throw new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function probeImage(file: string): Promise<ImageProbe> {
  return runProcessor(["--input", file], `Qualification image dimension probe failed for ${path.basename(file)}`);
}

function outputPathFor(sourceFile: string, outputDir: string, hash: string): string {
  const extension = path.extname(sourceFile).toLowerCase() || ".png";
  const stem = path.basename(sourceFile, path.extname(sourceFile));
  return path.join(outputDir, `${stem}-${hash.slice(0, 8)}-max4900${extension}`);
}

export async function prepareQualificationImagesForUpload(options: {
  files: string[];
  outputDir: string;
}): Promise<PreparedQualificationImages> {
  const files: string[] = [];
  const entries: PreparedQualificationImages["entries"] = [];

  for (const sourceFile of options.files) {
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Qualification image source file was missing: ${sourceFile}`);
    }
    const sourceHash = fileHash(sourceFile);
    const sourceProbe = await probeImage(sourceFile);
    const decision = resolveQualificationImageResize({
      width: sourceProbe.width,
      height: sourceProbe.height
    });

    if (decision.action === "reuse") {
      files.push(sourceFile);
      entries.push({
        sourceFile,
        outputFile: sourceFile,
        action: "reuse",
        sourceDimensions: { width: sourceProbe.width, height: sourceProbe.height },
        outputDimensions: { width: sourceProbe.width, height: sourceProbe.height }
      });
      continue;
    }

    fs.mkdirSync(options.outputDir, { recursive: true });
    const outputFile = outputPathFor(sourceFile, options.outputDir, sourceHash);
    await runProcessor(
      [
        "--input",
        sourceFile,
        "--output",
        outputFile,
        "--width",
        String(decision.targetWidth),
        "--height",
        String(decision.targetHeight)
      ],
      `Oversized qualification image normalization failed for ${path.basename(sourceFile)} (${sourceProbe.width}x${sourceProbe.height})`
    );
    if (!fs.existsSync(outputFile)) {
      throw new Error(`Normalized qualification image output was missing: ${outputFile}`);
    }
    const outputProbe = await probeImage(outputFile);
    const verification = verifyNormalizedQualificationImage({
      width: outputProbe.width,
      height: outputProbe.height,
      targetWidth: decision.targetWidth,
      targetHeight: decision.targetHeight
    });
    if (!verification.passed) {
      throw new Error(`${verification.issue} source=${path.basename(sourceFile)}`);
    }
    if (fileHash(sourceFile) !== sourceHash) {
      throw new Error(`Qualification image source changed during normalization: ${sourceFile}`);
    }
    files.push(outputFile);
    entries.push({
      sourceFile,
      outputFile,
      action: "resize",
      sourceDimensions: { width: sourceProbe.width, height: sourceProbe.height },
      outputDimensions: { width: outputProbe.width, height: outputProbe.height }
    });
  }

  return { files, entries };
}
