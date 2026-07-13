import assert from "node:assert/strict";
import { getShopSpecs } from "../dist/src/autolist/product-category.js";
import { validateShopAccessAuditReport } from "../dist/src/autolist/shop-access-audit-rules.js";

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

console.log("shop access audit rules passed");
