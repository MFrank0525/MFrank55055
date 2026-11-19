import assert from "node:assert/strict";
import {
  FIXED_FEISHU_PRICE_STOCK,
  evaluateControlledSpecTemplatePriceCardinality,
  evaluatePriceInventoryRowCardinality,
  parseFeishuProductPrices,
  resolveFeishuPriceInventoryRows
} from "../dist/src/business/publish-from-spu/price-inventory-rules.js";
import {
  classifyPublishFailure,
  isVerifiedPreSubmitRecoveryFailure
} from "../dist/src/business/publish-from-spu/publish-rules.js";

assert.equal(FIXED_FEISHU_PRICE_STOCK, 2000);
assert.deepEqual(parseFeishuProductPrices("129,99,79,59"), [129, 99, 79, 59]);
assert.deepEqual(parseFeishuProductPrices("129\n99\n79\n59"), [129, 99, 79, 59]);
assert.deepEqual(resolveFeishuPriceInventoryRows("129,99,79,59"), [
  { price: 129, stock: 2000 },
  { price: 99, stock: 2000 },
  { price: 79, stock: 2000 },
  { price: 59, stock: 2000 }
]);
assert.deepEqual(resolveFeishuPriceInventoryRows("110.9,100.9"), [
  { price: 110.9, stock: 2000 },
  { price: 100.9, stock: 2000 }
]);
assert.deepEqual(evaluatePriceInventoryRowCardinality({ expectedPriceCount: 2, actualSkuRowCount: 2 }), {
  passed: true,
  issue: ""
});
assert.deepEqual(evaluatePriceInventoryRowCardinality({ expectedPriceCount: 2, actualSkuRowCount: 4 }), {
  passed: false,
  issue: "Price/inventory row count must exact match Feishu price count: expected=2; actual=4"
});
assert.deepEqual(evaluateControlledSpecTemplatePriceCardinality({ specTemplate: "买一送一", priceCount: 4 }), {
  passed: false,
  issue: "Feishu controlled spec-template/price cardinality mismatch: template=买一送一; expectedPrices=2; actualPrices=4. Correct 规格模板 or 产品价格 in Feishu before continuing."
});
assert.deepEqual(evaluateControlledSpecTemplatePriceCardinality({ specTemplate: "买二送一", priceCount: 4 }), {
  passed: true,
  issue: ""
});
assert.deepEqual(evaluateControlledSpecTemplatePriceCardinality({ specTemplate: "店铺自定义模板", priceCount: 4 }), {
  passed: true,
  issue: ""
});
assert.throws(() => parseFeishuProductPrices("99,129,79,59"), /从大到小/);
assert.throws(() => parseFeishuProductPrices("129,abc,79,59"), /产品价格/);
assert.throws(() => resolveFeishuPriceInventoryRows(""), /产品价格/);
assert.equal(classifyPublishFailure("Feishu 产品价格必须按照从大到小的顺序填写。"), "price_inventory_not_ready");
assert.equal(
  classifyPublishFailure("Feishu controlled spec-template/price cardinality mismatch: template=买一送一; expectedPrices=2; actualPrices=4."),
  "spec_template_price_cardinality_mismatch"
);
assert.equal(
  isVerifiedPreSubmitRecoveryFailure({
    errorClass: "spec_template_price_cardinality_mismatch",
    finalVerifyStatus: "not_checked",
    message: "Feishu controlled spec-template/price cardinality mismatch"
  }),
  true
);
assert.equal(
  isVerifiedPreSubmitRecoveryFailure({
    errorClass: "unknown_publish_failure",
    finalVerifyStatus: "not_checked",
    message: "Feishu 产品价格必须正好填写 4 个价格。"
  }),
  true,
  "audit and resume must reclassify a stale pre-submit price validation failure from its immutable message"
);

const priceActionSource = await import("node:fs").then((fs) => fs.readFileSync("src/business/publish-from-spu/price-inventory-action.ts", "utf8"));
assert.match(
  priceActionSource,
  /evaluatePriceInventoryRowCardinality\([\s\S]*expectedPriceCount: priceInventoryRows\.length[\s\S]*actualSkuRowCount: rows\.length/,
  "the browser action must fail closed before filling when template SKU rows do not match Feishu price count"
);
assert.doesNotMatch(
  priceActionSource,
  /Math\.min\(rows\.length, priceInventoryRows\.length\)/,
  "the browser action must never partially fill only the smaller side of a row-count mismatch"
);
