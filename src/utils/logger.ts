import fs from "node:fs";
import path from "node:path";

let logFilePath: string | null = null;

function formatLine(level: "info" | "warn" | "error", message: string): string {
  return `[${new Date().toISOString()}] [${level}] ${message}`;
}

function appendLog(line: string): void {
  if (!logFilePath) {
    return;
  }
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  fs.appendFileSync(logFilePath, `${line}\n`, "utf8");
}

export function setLogFile(filePath?: string): void {
  logFilePath = filePath ? path.resolve(filePath) : null;
}

export function logInfo(message: string): void {
  const line = formatLine("info", message);
  console.log(line);
  appendLog(line);
}

export function logWarn(message: string): void {
  const line = formatLine("warn", message);
  console.warn(line);
  appendLog(line);
}

export function logError(message: string): void {
  const line = formatLine("error", message);
  console.error(line);
  appendLog(line);
}
