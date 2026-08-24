import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "./platform.js";

const VALIDATOR_SCRIPT = path.join(process.cwd(), "src", "utils", "image-integrity.py");

export interface DecodedImageInfo {
  format: "PNG" | "JPEG" | "WEBP";
  width: number;
  height: number;
}

export function inspectDecodedImageFile(file: string): DecodedImageInfo {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error(`Image artifact is missing or empty: ${file}`);
  }
  try {
    const output = execFileSync(
      getPythonCommand(),
      ["-X", "utf8", VALIDATOR_SCRIPT, "--input", file],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: sanitizePythonRuntimeEnv({ ...process.env, PYTHONIOENCODING: "utf-8" })
      }
    );
    return JSON.parse(output) as DecodedImageInfo;
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`Image artifact failed full decode validation (${path.basename(file)}): ${message}`);
  }
}

export function isFullyDecodableImageFile(file: string): boolean {
  try {
    inspectDecodedImageFile(file);
    return true;
  } catch {
    return false;
  }
}

export function writeFullyValidatedImageAtomic(targetFile: string, content: Buffer): DecodedImageInfo {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const extension = path.extname(targetFile) || ".img";
  const temporaryFile = path.join(
    path.dirname(targetFile),
    `.${path.basename(targetFile, extension)}.${process.pid}.${crypto.randomUUID()}${extension}`
  );
  let fd: number | undefined;
  try {
    fs.writeFileSync(temporaryFile, content, { flag: "wx" });
    const decoded = inspectDecodedImageFile(temporaryFile);
    fd = fs.openSync(temporaryFile, "r");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporaryFile, targetFile);
    const directoryFd = fs.openSync(path.dirname(targetFile), "r");
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
    return decoded;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
}
