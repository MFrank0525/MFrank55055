import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { getShopSpecs } from "../autolist/product-category.js";
import { resolveOpenAiCompatibleImageMode } from "../autolist/image-generation-rules.js";
import { validateFeishuProductPayload } from "../feishu/cache-contract.js";
import { loadFeishuBitableConfig } from "../feishu/config.js";
import { assertNoGptPlusWebUrl } from "../utils/gpt-plus-guard.js";
import { getPythonCommand } from "../utils/platform.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  required?: boolean;
}

type DoctorMode = "base" | "publish" | "auto-listing" | "feishu" | "all";

interface DoctorOptions {
  requireImageGeneration: boolean;
  imageGenerationProvider: "openai-compatible";
  imageGenerationConfigFile: string;
}

interface AutoListingJobSummary {
  input?: {
    simulateOnly?: boolean;
    deepseekConversationUrl?: string;
    imageGenerationProvider?: "openai-compatible";
    imageGenerationConfigFile?: string;
    pauseSignalFile?: string;
    startStep?: string;
  };
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

function checkNotGitTracked(name: string, targetPath: string): CheckResult {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    return {
      name,
      ok: true,
      detail: `not present: ${resolved}`,
      required: false
    };
  }
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", targetPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return {
      name,
      ok: false,
      detail: `tracked by git and must be removed from the index: ${targetPath}`
    };
  } catch {
    return {
      name,
      ok: true,
      detail: `present locally but not git-tracked: ${targetPath}`,
      required: false
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
      mode?: unknown;
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
    resolveOpenAiCompatibleImageMode(parsed.mode, parsed.apiUrl || "");
    if (parsed.model !== "gpt-image-2") {
      throw new Error(`OpenAI-compatible image generation model must be gpt-image-2: ${resolved}`);
    }
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
  const configIndex = argv.indexOf("--image-generation-config");
  return {
    requireImageGeneration: argv.includes("--require-image-generation"),
    imageGenerationProvider: "openai-compatible",
    imageGenerationConfigFile:
      configIndex >= 0 ? argv[configIndex + 1] || "input/image-generation.config.json" : "input/image-generation.config.json"
  };
}

function baseChecks(): CheckResult[] {
  return [
  checkPath("node_modules", "node_modules"),
  checkBrowser(),
  checkJson("input/publish-from-spu.job.example.json"),
  checkJson("input/auto-listing.job.example.json"),
  checkCommand("Python", getPythonCommand()),
  checkNotGitTracked("secret file guard: Feishu config", "input/feishu-bitable.config.json"),
  checkNotGitTracked("secret file guard: image generation config", "input/image-generation.config.json"),
  checkNotGitTracked("secret file guard: browser storage", "data/browser-profile"),
  checkNotGitTracked("secret file guard: fallback browser storage", "data/browser-profile-fallback"),
  checkNotGitTracked("secret file guard: cookie artifacts", "cookies.json"),
  checkNotGitTracked("runtime data guard", "data"),
  checkNotGitTracked("output guard", "output")
  ];
}

function publishChecks(): CheckResult[] {
  return [
    checkJson("input/publish-from-spu.job.example.json")
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
  const missing = getShopSpecs().filter((shop) => {
    const expectedName = `${shop.shopCode}${shop.watermarkText}`;
    return !existing.includes(expectedName);
  });
  if (missing.length > 0) {
    return {
      name: "auto-listing shop folders",
      ok: false,
      detail: `missing canonical shop folder(s): ${missing.map((shop) => `${shop.shopCode}${shop.watermarkText}`).join(", ")}`
    };
  }
  return { name: "auto-listing shop folders", ok: true, detail: root };
}

function checkAutoListingJobFile(jobFile: string): CheckResult {
  const resolved = path.resolve(jobFile);
  if (!fs.existsSync(resolved)) {
    return {
      name: `auto-listing job: ${path.basename(jobFile)}`,
      ok: true,
      required: false,
      detail: `not present: ${resolved}`
    };
  }
  try {
    const job = JSON.parse(fs.readFileSync(resolved, "utf8")) as AutoListingJobSummary;
    const input = job.input || {};
    if (input.deepseekConversationUrl) {
      assertNoGptPlusWebUrl(input.deepseekConversationUrl, `${jobFile} deepseekConversationUrl`);
    }
    const provider = input.imageGenerationProvider || "openai-compatible";
    if (input.simulateOnly === false && provider === "openai-compatible") {
      const configFile = input.imageGenerationConfigFile || "input/image-generation.config.json";
      const configCheck = checkOpenAiCompatibleImageGenerationConfig(configFile, true);
      if (!configCheck.ok) {
        return {
          name: `auto-listing job: ${path.basename(jobFile)}`,
          ok: false,
          detail: `real job image generation config invalid: ${configCheck.detail}`
        };
      }
    }
    if (input.simulateOnly === false && !input.pauseSignalFile) {
      return {
        name: `auto-listing job: ${path.basename(jobFile)}`,
        ok: false,
        detail: "real job missing pauseSignalFile"
      };
    }
    if (input.startStep === "discovered") {
      return {
        name: `auto-listing job: ${path.basename(jobFile)}`,
        ok: false,
        detail: "uses removed startStep=discovered; use source_images_discovered"
      };
    }
    return {
      name: `auto-listing job: ${path.basename(jobFile)}`,
      ok: true,
      detail: `${resolved}; simulateOnly=${String(input.simulateOnly ?? true)}`
    };
  } catch (error) {
    return {
      name: `auto-listing job: ${path.basename(jobFile)}`,
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkAutoListingJobFiles(): CheckResult[] {
  const inputDir = path.resolve("input");
  if (!fs.existsSync(inputDir)) {
    return [];
  }
  return fs
    .readdirSync(inputDir)
    .filter((name) => /^auto-listing\.job.*\.json$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => checkAutoListingJobFile(path.join("input", name)));
}

function autoListingChecks(options: DoctorOptions): CheckResult[] {
  return [
  checkCommand("Python Pillow", getPythonCommand(), ["-c", "import PIL; print(PIL.__version__)"]),
  ...(options.requireImageGeneration
    ? [checkOpenAiCompatibleImageGenerationConfig(options.imageGenerationConfigFile, true)]
    : []),
  checkPath("auto-listing feishu images", "input/auto-listing/feishu-images"),
  checkPath("auto-listing main image work dir", "input/auto-listing/main-images"),
  checkPath("auto-listing titles", "input/auto-listing/titles"),
  checkPath("auto-listing qualifications", "input/auto-listing/qualifications"),
  checkAutoListingShopFolders(),
  checkAutoListingProductInfoSource(),
  ...checkAutoListingJobFiles()
  ];
}

function checkFeishuConfig(filePath: string): CheckResult {
  const resolved = path.resolve(filePath);
  try {
    loadFeishuBitableConfig(resolved);
    return { name: "Feishu config", ok: true, detail: `${resolved}; current field map valid` };
  } catch (error) {
    return {
      name: "Feishu config",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkFeishuProductData(filePath: string): CheckResult {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { name: "Feishu product data", ok: false, detail: `missing: ${resolved}` };
  }
  try {
    const parsed = validateFeishuProductPayload(JSON.parse(fs.readFileSync(resolved, "utf8")));
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
    checkFeishuConfig("input/feishu-bitable.config.json"),
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
