import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { assertNoGptPlusWebUrl } from "../utils/gpt-plus-guard.js";
import { getDefaultDreaminaBin, getDreaminaWrapperPath, getPythonCommand } from "../utils/platform.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  required?: boolean;
}

type DoctorMode = "base" | "publish" | "auto-listing" | "feishu" | "all";

interface DoctorOptions {
  requireDreaminaGeneration: boolean;
  requireImageGeneration: boolean;
  imageGenerationProvider: "dreamina" | "openai-compatible";
  imageGenerationConfigFile: string;
}

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

function checkDreaminaAccountAccess(): CheckResult {
  const wrapper = getDreaminaWrapperPath("user_credit.py");
  const dreaminaBin = getDefaultDreaminaBin();
  if (!fs.existsSync(wrapper) || !fs.existsSync(dreaminaBin)) {
    return {
      name: "Dreamina account access",
      ok: false,
      detail: "Dreamina executable or credit wrapper is missing"
    };
  }

  try {
    const output = execFileSync(getPythonCommand(), [wrapper, "--dreamina-bin", dreaminaBin], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    const payload = JSON.parse(output) as { ok?: boolean; data?: unknown; error?: string };
    if (!payload.ok) {
      return {
        name: "Dreamina account access",
        ok: false,
        detail: payload.error || "Dreamina account check failed"
      };
    }
    return {
      name: "Dreamina account access",
      ok: true,
      detail: "logged in and CLI-accessible"
    };
  } catch (error) {
    return {
      name: "Dreamina account access",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkDreaminaGenerationAccess(required: boolean): CheckResult {
  const wrapper = getDreaminaWrapperPath("user_credit.py");
  const dreaminaBin = getDefaultDreaminaBin();
  if (!fs.existsSync(wrapper) || !fs.existsSync(dreaminaBin)) {
    return {
      name: "Dreamina generation access",
      ok: !required,
      required,
      detail: "Dreamina executable or credit wrapper is missing"
    };
  }

  try {
    const output = execFileSync(getPythonCommand(), [wrapper, "--dreamina-bin", dreaminaBin], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    const payload = JSON.parse(output) as { ok?: boolean; data?: { vip_level?: unknown }; error?: string };
    if (!payload.ok) {
      return {
        name: "Dreamina generation access",
        ok: !required,
        required,
        detail: payload.error || "Dreamina account check failed"
      };
    }

    const vipLevel = String(payload.data?.vip_level || "").trim();
    const hasGenerationAccess = /maestro/i.test(vipLevel);
    return {
      name: "Dreamina generation access",
      ok: hasGenerationAccess || !required,
      required,
      detail: hasGenerationAccess
        ? `image2image allowed; vip_level=${vipLevel}`
        : `image2image requires maestro vip; current vip_level=${vipLevel || "unknown"}`
    };
  } catch (error) {
    return {
      name: "Dreamina generation access",
      ok: !required,
      required,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkOpenAiCompatibleImageGenerationConfig(configFile: string, required: boolean): CheckResult {
  const resolved = path.resolve(configFile || "input/image-generation.config.json");
  if (!fs.existsSync(resolved)) {
    return {
      name: "OpenAI-compatible image generation config",
      ok: !required,
      required,
      detail: `missing: ${resolved}`
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as {
      apiUrl?: string;
      apiKey?: string;
      model?: string;
    };
    const missing = [
      parsed.apiUrl ? "" : "apiUrl",
      process.env.IMAGE_GENERATION_API_KEY || parsed.apiKey ? "" : "apiKey",
      parsed.model ? "" : "model"
    ].filter(Boolean);
    if (missing.length > 0) {
      return {
        name: "OpenAI-compatible image generation config",
        ok: !required,
        required,
        detail: `${resolved}; missing ${missing.join(", ")}`
      };
    }
    assertNoGptPlusWebUrl(parsed.apiUrl || "", `image generation apiUrl in ${resolved}`);
    return {
      name: "OpenAI-compatible image generation config",
      ok: true,
      required,
      detail: `${resolved}; model=${parsed.model}; apiKey=present`
    };
  } catch (error) {
    return {
      name: "OpenAI-compatible image generation config",
      ok: !required,
      required,
      detail: error instanceof Error ? error.message : String(error)
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
  if (argv.includes("--feishu")) {
    return "feishu";
  }
  return "base";
}

function parseOptions(argv: string[]): DoctorOptions {
  const providerIndex = argv.indexOf("--image-generation-provider");
  const configIndex = argv.indexOf("--image-generation-config");
  const provider = providerIndex >= 0 ? argv[providerIndex + 1] : "";
  return {
    requireDreaminaGeneration: argv.includes("--require-dreamina-generation"),
    requireImageGeneration: argv.includes("--require-image-generation"),
    imageGenerationProvider: provider === "openai-compatible" ? "openai-compatible" : "dreamina",
    imageGenerationConfigFile:
      configIndex >= 0 ? argv[configIndex + 1] || "input/image-generation.config.json" : "input/image-generation.config.json"
  };
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
  const legacyShopFolder = path.resolve("input/shop-folder");
  const legacyProductFolder = path.resolve("input/shop-folder/001-product-folder");
  if (!fs.existsSync(legacyShopFolder) || !fs.existsSync(legacyProductFolder)) {
    const feishuJob = path.resolve("input/auto-listing.job.mac-feishu-flow.json");
    const feishuData = path.resolve("data/feishu/products.json");
    const shopRoot = path.resolve("input/auto-listing/shops");
    if (fs.existsSync(feishuJob) && fs.existsSync(feishuData) && fs.existsSync(shopRoot)) {
      return [
        {
          name: "publish source",
          ok: true,
          detail: `${feishuJob} (Feishu auto-listing mode)`
        }
      ];
    }
  }

  return [
    checkPath("publish shop folder", "input/shop-folder"),
    checkPath("publish product folder", "input/shop-folder/001-product-folder")
  ];
}

function checkAutoListingProductInfoSource(): CheckResult {
  const workbook = path.resolve("input/auto-listing/product-info.xlsx");
  if (fs.existsSync(workbook)) {
    return { name: "auto-listing product info source", ok: true, detail: workbook };
  }
  const feishuData = path.resolve("data/feishu/products.json");
  if (fs.existsSync(feishuData)) {
    return { name: "auto-listing product info source", ok: true, detail: `${feishuData} (Feishu mode)` };
  }
  return {
    name: "auto-listing product info source",
    ok: false,
    detail: `missing: ${workbook} or ${feishuData}`
  };
}

function checkAutoListingShopFolders(): CheckResult {
  const root = path.resolve("input/auto-listing/shops");
  if (!fs.existsSync(root)) {
    return { name: "auto-listing shop folders", ok: false, detail: `missing: ${root}` };
  }
  const existing = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const missing = ["01", "02", "03", "04", "05"].filter((code) => !existing.some((name) => name.startsWith(code)));
  if (missing.length > 0) {
    return { name: "auto-listing shop folders", ok: false, detail: `missing shop code(s): ${missing.join(", ")}` };
  }
  return { name: "auto-listing shop folders", ok: true, detail: root };
}

function autoListingChecks(options: DoctorOptions): CheckResult[] {
  return [
  checkCommand("Python Pillow", getPythonCommand(), ["-c", "import PIL; print(PIL.__version__)"]),
  ...(options.imageGenerationProvider === "dreamina"
    ? [
        checkPath("Dreamina executable", getDefaultDreaminaBin()),
        checkPath("Dreamina image wrapper", getDreaminaWrapperPath("image2image.py")),
        checkPath("Dreamina query wrapper", getDreaminaWrapperPath("query_result.py")),
        checkPath("Dreamina credit wrapper", getDreaminaWrapperPath("user_credit.py")),
        checkDreaminaAccountAccess(),
        ...(options.requireDreaminaGeneration ? [checkDreaminaGenerationAccess(true)] : [])
      ]
    : []),
  ...(options.requireImageGeneration && options.imageGenerationProvider === "openai-compatible"
    ? [checkOpenAiCompatibleImageGenerationConfig(options.imageGenerationConfigFile, true)]
    : []),
  checkPath("auto-listing feishu images", "input/auto-listing/feishu-images"),
  checkPath("auto-listing jimeng images", "input/auto-listing/jimeng-images"),
  checkPath("auto-listing titles", "input/auto-listing/titles"),
  checkPath("auto-listing qualifications", "input/auto-listing/qualifications"),
  checkAutoListingShopFolders(),
  checkAutoListingProductInfoSource()
  ];
}

function checkFeishuProductData(filePath: string): CheckResult {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { name: "Feishu product data", ok: false, detail: `missing: ${resolved}` };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as {
      ok?: boolean;
      count?: number;
      invalidRecords?: Array<{ recordId: string; missing: string[] }>;
    };
    const invalidRecords = parsed.invalidRecords || [];
    const count = parsed.count || 0;
    if (invalidRecords.length > 0 || parsed.ok === false) {
      return {
        name: "Feishu product data",
        ok: false,
        detail: `${resolved}; count=${count}; invalidRecords=${invalidRecords.length}`
      };
    }
    return { name: "Feishu product data", ok: true, detail: `${resolved}; count=${count}` };
  } catch (error) {
    return {
      name: "Feishu product data",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function feishuChecks(): CheckResult[] {
  return [
    checkPath("Feishu config", "input/feishu-bitable.config.json"),
    checkJson("input/feishu-bitable.config.example.json"),
    checkFeishuProductData("data/feishu/products.json")
  ];
}

const mode = parseMode(process.argv.slice(2));
const options = parseOptions(process.argv.slice(2));
const checks: CheckResult[] = [
  ...baseChecks(),
  ...(mode === "publish" || mode === "all" ? publishChecks() : []),
  ...(mode === "auto-listing" || mode === "all" ? autoListingChecks(options) : []),
  ...(mode === "feishu" || mode === "all" ? feishuChecks() : [])
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
