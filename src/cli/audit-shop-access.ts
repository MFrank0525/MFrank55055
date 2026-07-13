import path from "node:path";
import { disconnectAutomationBrowserConnections } from "../browser/launch.js";
import { validateShopAccessAuditReport } from "../autolist/shop-access-audit-rules.js";
import { runShopAccessAudit } from "../business/shop-access-audit.js";
import { formatTimestamp } from "../utils/path-names.js";

interface CliOptions {
  runtimeRoot: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let runtimeRoot = path.resolve("data", "auto-listing", "shop-access-audits");
  let json = false;
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
    throw new Error(`Unsupported shop access audit argument: ${argument}`);
  }
  return { runtimeRoot, json };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runtimeDir = path.join(options.runtimeRoot, formatTimestamp());
  const report = await runShopAccessAudit({ runtimeDir });
  const validation = validateShopAccessAuditReport(report);
  const output = {
    ok: validation.ok,
    status: report.status,
    runtimeDir: report.runtimeDir,
    resultFile: report.resultFile,
    shopCount: report.entries.length,
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
