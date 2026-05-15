import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { getDefaultDreaminaBin, getDreaminaWrapperPath, getPythonCommand } from "../utils/platform.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  required?: boolean;
}

type DoctorMode = "base" | "publish" | "auto-listing" | "all";

function exists(targetPath: string): boolean {
  return fs.existsSync(path.resolve(targetPath));
}

function parseJsonFile(filePath: string): void {
  JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function checkJson(filePath: string): CheckResult {
  try {
    parseJsonFile(filePath);
    return { name: filePath, ok: true, detail: "valid JSON" };
  } catch (error) {
    return { name: filePath, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function checkBrowser(): CheckResult {
  const executablePath = chromium.executablePath();
  return {
    name: "Playwright Chromium",
    ok: fs.existsSync(executablePath),
    detail: executablePath
  };
}

function checkCommand(name: string, command: string, args: string[] = ["--version"], required = true): CheckResult {
  try {
    const output = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return { name, ok: true, detail: output.split(/\r?\n/)[0] || command, required };
  } catch (error) {
    return {
      name,
      ok: !required,
      detail: `not available: ${command}`,
      required
    };
  }
}

function checkPath(name: string, targetPath: string, required = true): CheckResult {
  const ok = exists(targetPath);
  return {
    name,
    ok: required ? ok : true,
    detail: ok ? path.resolve(targetPath) : `missing: ${path.resolve(targetPath)}`,
    required
  };
}

function parseMode(argv: string[]): DoctorMode {
  if (argv.includes("--all")) {
    return "all";
  }
  if (argv.includes("--publish")) {
    return "publish";
  }
  if (argv.includes("--auto-listing")) {
    return "auto-listing";
  }
  return "base";
}

function baseChecks(): CheckResult[] {
  return [
  checkPath("node_modules", "node_modules"),
  checkBrowser(),
  checkJson("input/doubao-job.example.json"),
  checkJson("input/publish-from-spu.job.example.json"),
  checkJson("input/auto-listing.job.example.json"),
  checkCommand("Python", getPythonCommand()),
  checkPath("doubao prompt", "input/doubao-prompt.txt"),
  checkPath("doubao image dir", "input/images")
  ];
}

function publishChecks(): CheckResult[] {
  return [
    checkPath("publish shop folder", "input/shop-folder"),
    checkPath("publish product folder", "input/shop-folder/001-product-folder")
  ];
}

function autoListingChecks(): CheckResult[] {
  return [
  checkCommand("Python Pillow", getPythonCommand(), ["-c", "import PIL; print(PIL.__version__)"]),
  checkPath("Dreamina executable", getDefaultDreaminaBin()),
  checkPath("Dreamina image wrapper", getDreaminaWrapperPath("image2image.py")),
  checkPath("Dreamina query wrapper", getDreaminaWrapperPath("query_result.py")),
  checkPath("Dreamina credit wrapper", getDreaminaWrapperPath("user_credit.py")),
  checkPath("auto-listing feishu images", "input/auto-listing/feishu-images"),
  checkPath("auto-listing jimeng images", "input/auto-listing/jimeng-images"),
  checkPath("auto-listing titles", "input/auto-listing/titles"),
  checkPath("auto-listing qualifications", "input/auto-listing/qualifications"),
  checkPath("auto-listing shops", "input/auto-listing/shops"),
  checkPath("auto-listing product info workbook", "input/auto-listing/product-info.xlsx")
  ];
}

const mode = parseMode(process.argv.slice(2));
const checks: CheckResult[] = [
  ...baseChecks(),
  ...(mode === "publish" || mode === "all" ? publishChecks() : []),
  ...(mode === "auto-listing" || mode === "all" ? autoListingChecks() : [])
];

console.log(`Doctor mode: ${mode}`);

for (const check of checks) {
  const optionalMissing =
    check.required === false && (check.detail.startsWith("missing:") || check.detail.startsWith("not available:"));
  const marker = check.ok ? (optionalMissing ? "WARN" : "OK") : "FAIL";
  console.log(`${marker} ${check.name}: ${check.detail}`);
}

const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  process.exitCode = 1;
}
