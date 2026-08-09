import fs from "node:fs";
import path from "node:path";
import { disconnectAutomationBrowserConnections } from "../browser/launch.js";
import { validateShopAccessAuditReport } from "../autolist/shop-access-audit-rules.js";
import { runShopAccessAudit } from "../business/shop-access-audit.js";
import { formatTimestamp } from "../utils/path-names.js";
import { getProductCategoryPlan, getShopSpecs } from "../autolist/product-category.js";

interface CliOptions {
  runtimeRoot: string;
  json: boolean;
  category?: string;
}

function assertNoActiveAutoListingBrowserOwner(): void {
  const childFile = path.resolve("data", "auto-listing", "control", "auto-listing-child.json");
  if (!fs.existsSync(childFile)) {
    return;
  }
  let child: { pid?: number; label?: string };
  try {
    child = JSON.parse(fs.readFileSync(childFile, "utf8")) as { pid?: number; label?: string };
  } catch {
    throw new Error(`Shop access audit refused: unreadable listing child ownership record ${childFile}.`);
  }
  if (typeof child.pid !== "number" || !Number.isInteger(child.pid) || child.pid <= 0) {
    throw new Error(`Shop access audit refused: invalid listing child ownership record ${childFile}.`);
  }
  try {
    process.kill(child.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return;
    }
    if ((error as NodeJS.ErrnoException).code !== "EPERM") {
      throw error;
    }
  }
  throw new Error(
    `Shop access audit refused: active listing child PID ${child.pid} (${child.label || "unknown"}) owns the shared Doudian browser context. Pause listing at a safe boundary before auditing.`
  );
}

function parseArgs(argv: string[]): CliOptions {
  let runtimeRoot = path.resolve("data", "auto-listing", "shop-access-audits");
  let json = false;
  let category: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--runtime-root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Usage: audit-shop-access [--runtime-root <directory>] [--json]");
      }
      runtimeRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--category") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Usage: audit-shop-access [--runtime-root <directory>] [--category <产品类目>] [--json]");
      }
      category = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported shop access audit argument: ${argument}`);
  }
  return { runtimeRoot, json, category };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertNoActiveAutoListingBrowserOwner();
  const runtimeDir = path.join(options.runtimeRoot, formatTimestamp());
  const categoryPlan = options.category ? getProductCategoryPlan(options.category) : undefined;
  const shops = categoryPlan
    ? getShopSpecs().filter((shop) => categoryPlan.shopCodes.includes(shop.shopCode))
    : getShopSpecs();
  const report = await runShopAccessAudit({ runtimeDir, shops });
  const validation = validateShopAccessAuditReport(report, shops);
  const output = {
    ok: validation.ok,
    status: report.status,
    runtimeDir: report.runtimeDir,
    resultFile: report.resultFile,
    shopCount: report.entries.length,
    category: categoryPlan?.category,
    failure: report.failure,
    validationErrors: validation.errors,
    sideEffects: report.sideEffects
  };
  console.log(options.json ? JSON.stringify(output, null, 2) : JSON.stringify(output));
  if (!validation.ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAutomationBrowserConnections();
  });
