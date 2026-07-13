import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { getWorkspacePage, launchPersistentBrowser } from "../browser/launch.js";
import {
  shopAccessNamesMatch,
  validateShopAccessAuditReport,
  type ShopAccessAuditEntry,
  type ShopAccessAuditReport
} from "../autolist/shop-access-audit-rules.js";
import { getShopSpecs } from "../autolist/shop-rules.js";
import { gotoWithTolerance } from "./publish-from-spu/browser-session.js";
import { PLATFORM_SPU_URL } from "./publish-from-spu/constants.js";
import { ensureShopContext } from "./publish-from-spu/shop-switch-action.js";

export interface ShopAccessAuditDependencies {
  openPage(): Promise<Page>;
  ensureShopContext(page: Page, runtimeDir: string, shopFolder: string): Promise<string>;
  now(): Date;
}

function classifyShopAccessFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Doudian login required|扫码登录|login required/i.test(message)) {
    return "login_required";
  }
  if (/target shop not found|目标店铺.*不存在/i.test(message)) {
    return "shop_not_found";
  }
  if (/expected=.*actual=|shop context mismatch|切换后.*不一致/i.test(message)) {
    return "shop_context_mismatch";
  }
  return "browser_operation_failed";
}

async function openDefaultAuditPage(): Promise<Page> {
  const context = await launchPersistentBrowser();
  const page = await getWorkspacePage(context, "shop");
  await gotoWithTolerance(page, PLATFORM_SPU_URL, 2500);
  return page;
}

function writeReport(report: ShopAccessAuditReport): void {
  fs.mkdirSync(report.runtimeDir, { recursive: true });
  const temporaryFile = `${report.resultFile}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, report.resultFile);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runShopAccessAudit(input: {
  runtimeDir: string;
  dependencies?: Partial<ShopAccessAuditDependencies>;
}): Promise<ShopAccessAuditReport> {
  const runtimeDir = path.resolve(input.runtimeDir);
  const resultFile = path.join(runtimeDir, "shop-access-audit.json");
  const dependencies: ShopAccessAuditDependencies = {
    openPage: input.dependencies?.openPage || openDefaultAuditPage,
    ensureShopContext: input.dependencies?.ensureShopContext || ensureShopContext,
    now: input.dependencies?.now || (() => new Date())
  };
  const shops = getShopSpecs();
  const report: ShopAccessAuditReport = {
    runId: path.basename(runtimeDir),
    runtimeDir,
    resultFile,
    startedAt: dependencies.now().toISOString(),
    finishedAt: "",
    status: "failed",
    expectedShopCount: shops.length,
    entries: [],
    sideEffects: {
      navigationAttempted: true,
      shopSwitchAttempted: false,
      publishAttempted: false,
      formMutationAttempted: false
    }
  };

  let page: Page;
  try {
    page = await dependencies.openPage();
  } catch (error) {
    report.finishedAt = dependencies.now().toISOString();
    report.failure = {
      shopCode: "",
      errorClass: classifyShopAccessFailure(error),
      message: errorMessage(error)
    };
    writeReport(report);
    return report;
  }

  for (let index = 0; index < shops.length; index += 1) {
    const shop = shops[index];
    const startedAt = dependencies.now().toISOString();
    report.sideEffects.shopSwitchAttempted = true;
    const shopFolder = path.join(runtimeDir, "shop-targets", `${shop.shopCode}${shop.watermarkText}`);
    try {
      const actualShopName = await dependencies.ensureShopContext(page, runtimeDir, shopFolder);
      if (!shopAccessNamesMatch(actualShopName, shop.watermarkText)) {
        throw new Error(`Shop context mismatch: expected=${shop.watermarkText}; actual=${actualShopName || "<empty>"}`);
      }
      const entry: ShopAccessAuditEntry = {
        sequence: index + 1,
        shopCode: shop.shopCode,
        expectedShopName: shop.watermarkText,
        actualShopName,
        startedAt,
        finishedAt: dependencies.now().toISOString(),
        passed: true,
        errorClass: "",
        issue: ""
      };
      report.entries.push(entry);
      writeReport(report);
    } catch (error) {
      const failure = {
        shopCode: shop.shopCode,
        errorClass: classifyShopAccessFailure(error),
        message: errorMessage(error)
      };
      report.entries.push({
        sequence: index + 1,
        shopCode: shop.shopCode,
        expectedShopName: shop.watermarkText,
        actualShopName: "",
        startedAt,
        finishedAt: dependencies.now().toISOString(),
        passed: false,
        errorClass: failure.errorClass,
        issue: failure.message
      });
      report.failure = failure;
      report.finishedAt = dependencies.now().toISOString();
      writeReport(report);
      return report;
    }
  }

  report.status = "passed";
  report.finishedAt = dependencies.now().toISOString();
  const validation = validateShopAccessAuditReport(report, shops);
  if (!validation.ok) {
    report.status = "failed";
    report.failure = {
      shopCode: "",
      errorClass: "evidence_invalid",
      message: validation.errors.join(" ")
    };
  }
  writeReport(report);
  return report;
}
