import assert from "node:assert/strict";
import {
  FIXED_FEISHU_PRICE_STOCK,
  parseFeishuProductPrices,
  resolveFeishuPriceInventoryRows
} from "../dist/src/business/publish-from-spu/price-inventory-rules.js";

assert.equal(FIXED_FEISHU_PRICE_STOCK, 2000);
assert.deepEqual(parseFeishuProductPrices("129,99,79,59"), [129, 99, 79, 59]);
assert.deepEqual(parseFeishuProductPrices("129\n99\n79\n59"), [129, 99, 79, 59]);
assert.deepEqual(resolveFeishuPriceInventoryRows("129,99,79,59"), [
  { price: 129, stock: 2000 },
  { price: 99, stock: 2000 },
  { price: 79, stock: 2000 },
  { price: 59, stock: 2000 }
]);
assert.throws(() => parseFeishuProductPrices("99,129,79,59"), /从大到小/);
assert.throws(() => parseFeishuProductPrices("129,abc,79,59"), /产品价格/);
assert.throws(() => resolveFeishuPriceInventoryRows("129,99,79"), /4/);
assert.throws(() => resolveFeishuPriceInventoryRows(""), /产品价格/);
