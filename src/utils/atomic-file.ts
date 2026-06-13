import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fsyncDirectory(directory: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

export function atomicWriteFile(filePath: string, contents: string | Buffer): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporaryFile, "wx");
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporaryFile, filePath);
    fsyncDirectory(directory);
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    if (fs.existsSync(temporaryFile)) {
      fs.rmSync(temporaryFile, { force: true });
    }
  }
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
