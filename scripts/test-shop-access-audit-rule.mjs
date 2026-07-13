import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getShopSpecs } from "../dist/src/autolist/product-category.js";
import { validateShopAccessAuditReport } from "../dist/src/autolist/shop-access-audit-rules.js";
import { runShopAccessAudit } from "../dist/src/business/shop-access-audit.js";

const shops = getShopSpecs();

function buildPassingReport() {
  return {
    runId: "shop-access-test",
    runtimeDir: "/tmp/shop-access-test",
    resultFile: "/tmp/shop-access-test/shop-access-audit.json",
    startedAt: "2026-07-13T00:00:00.000Z",
    finishedAt: "2026-07-13T00:01:00.000Z",
    status: "passed",
    expectedShopCount: shops.length,
    entries: shops.map((shop, index) => ({
      sequence: index + 1,
      shopCode: shop.shopCode,
      expectedShopName: shop.watermarkText,
      actualShopName: shop.watermarkText,
      startedAt: `2026-07-13T00:00:${String(index).padStart(2, "0")}.000Z`,
      finishedAt: `2026-07-13T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
      passed: true,
      errorClass: "",
      issue: ""
    })),
    sideEffects: {
      navigationAttempted: true,
      shopSwitchAttempted: true,
      publishAttempted: false,
      formMutationAttempted: false
    }
  };
}

const passing = buildPassingReport();
assert.deepEqual(validateShopAccessAuditReport(passing), { ok: true, errors: [] });

const missing = structuredClone(passing);
missing.entries.pop();
assert.equal(validateShopAccessAuditReport(missing).ok, false);
assert.match(validateShopAccessAuditReport(missing).errors.join("\n"), /entry count/i);

const duplicate = structuredClone(passing);
duplicate.entries[1].shopCode = duplicate.entries[0].shopCode;
assert.equal(validateShopAccessAuditReport(duplicate).ok, false);
assert.match(validateShopAccessAuditReport(duplicate).errors.join("\n"), /duplicate|sequence/i);

const outOfOrder = structuredClone(passing);
[outOfOrder.entries[0], outOfOrder.entries[1]] = [outOfOrder.entries[1], outOfOrder.entries[0]];
assert.equal(validateShopAccessAuditReport(outOfOrder).ok, false);
assert.match(validateShopAccessAuditReport(outOfOrder).errors.join("\n"), /sequence|expected shop/i);

const nameMismatch = structuredClone(passing);
nameMismatch.entries[5].actualShopName = "延草纲目错误店铺";
assert.equal(validateShopAccessAuditReport(nameMismatch).ok, false);
assert.match(validateShopAccessAuditReport(nameMismatch).errors.join("\n"), /name mismatch/i);

const publishSideEffect = structuredClone(passing);
publishSideEffect.sideEffects.publishAttempted = true;
assert.equal(validateShopAccessAuditReport(publishSideEffect).ok, false);
assert.match(validateShopAccessAuditReport(publishSideEffect).errors.join("\n"), /publish/i);

const formSideEffect = structuredClone(passing);
formSideEffect.sideEffects.formMutationAttempted = true;
assert.equal(validateShopAccessAuditReport(formSideEffect).ok, false);
assert.match(validateShopAccessAuditReport(formSideEffect).errors.join("\n"), /form/i);

function deterministicNow() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 13, 0, 0, tick++));
}

const successRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-access-success-"));
const successCalls = [];
const successReport = await runShopAccessAudit({
  runtimeDir: successRuntimeDir,
  dependencies: {
    openPage: async () => ({ fake: true }),
    ensureShopContext: async (_page, _runtimeDir, shopFolder) => {
      successCalls.push(path.basename(shopFolder));
      return shops.find((shop) => path.basename(shopFolder).startsWith(shop.shopCode))?.watermarkText || "";
    },
    now: deterministicNow()
  }
});
assert.deepEqual(successCalls, shops.map((shop) => `${shop.shopCode}${shop.watermarkText}`));
assert.equal(successReport.status, "passed");
assert.equal(successReport.entries.length, 20);
assert.deepEqual(validateShopAccessAuditReport(successReport), { ok: true, errors: [] });
assert.deepEqual(JSON.parse(fs.readFileSync(successReport.resultFile, "utf8")), successReport);

const failureRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-access-failure-"));
const failureCalls = [];
const failureReport = await runShopAccessAudit({
  runtimeDir: failureRuntimeDir,
  dependencies: {
    openPage: async () => ({ fake: true }),
    ensureShopContext: async (_page, _runtimeDir, shopFolder) => {
      const code = path.basename(shopFolder).slice(0, 2);
      failureCalls.push(code);
      if (code === "07") {
        throw new Error("Shop switch failed: target shop not found in selector for 延草纲目基础营养专卖店");
      }
      return shops.find((shop) => shop.shopCode === code)?.watermarkText || "";
    },
    now: deterministicNow()
  }
});
assert.deepEqual(failureCalls, ["01", "02", "03", "04", "05", "06", "07"]);
assert.equal(failureReport.status, "failed");
assert.equal(failureReport.entries.length, 7);
assert.equal(failureReport.entries.at(-1)?.passed, false);
assert.equal(failureReport.failure?.shopCode, "07");
assert.equal(failureReport.failure?.errorClass, "shop_not_found");
assert.deepEqual(JSON.parse(fs.readFileSync(failureReport.resultFile, "utf8")), failureReport);

console.log("shop access audit rules passed");
