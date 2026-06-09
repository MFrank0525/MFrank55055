import assert from "node:assert/strict";
import {
  getProductCategoryPlan,
  getShopSpecs,
  resolveMainImageShopAssignments
} from "../dist/src/autolist/product-category.js";

const allShopNames = [
  "延草纲目大药房专营店",
  "延草纲目药品专营店",
  "延草纲目个护保健专营店",
  "延草纲目康复理疗专营店",
  "延草纲目医疗保健专营店",
  "延草纲目理疗器械旗舰店",
  "延草纲目健康护理专营店",
  "延草纲目家庭护理专营店",
  "延草纲目中医保健专营店",
  "延草纲目养生器械专营店"
];

assert.deepEqual(
  getShopSpecs().map((item) => item.watermarkText),
  allShopNames,
  "global shop order must match the publishing order"
);

assert.deepEqual(getProductCategoryPlan("医疗器械").shopCodes, ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
assert.equal(getProductCategoryPlan("医疗器械").promptCount, 5);
assert.equal(getProductCategoryPlan("医疗器械").titleCount, 20);
assert.equal(getProductCategoryPlan("医疗器械").imagesPerShop, 2);

assert.deepEqual(getProductCategoryPlan("保健食品").shopCodes, ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
assert.equal(getProductCategoryPlan("保健食品").promptCount, 5);
assert.equal(getProductCategoryPlan("保健食品").titleCount, 20);
assert.equal(getProductCategoryPlan("保健食品").imagesPerShop, 2);

assert.deepEqual(getProductCategoryPlan("非处方药").shopCodes, ["01", "02", "03", "04", "05"]);
assert.equal(getProductCategoryPlan("非处方药").promptCount, 5);
assert.equal(getProductCategoryPlan("非处方药").titleCount, 20);
assert.equal(getProductCategoryPlan("非处方药").imagesPerShop, 4);

const medicalAssignments = resolveMainImageShopAssignments({
  shopCodes: getProductCategoryPlan("医疗器械").shopCodes,
  imagesPerShop: getProductCategoryPlan("医疗器械").imagesPerShop,
  totalImageCount: 20
});
assert.equal(medicalAssignments.length, 20);
assert.deepEqual(medicalAssignments.slice(0, 5).map((item) => item.shopCode), ["01", "01", "02", "02", "03"]);
assert.deepEqual(medicalAssignments.slice(-4).map((item) => item.shopCode), ["09", "09", "10", "10"]);

const otcAssignments = resolveMainImageShopAssignments({
  shopCodes: getProductCategoryPlan("非处方药").shopCodes,
  imagesPerShop: getProductCategoryPlan("非处方药").imagesPerShop,
  totalImageCount: 20
});
assert.equal(otcAssignments.length, 20);
assert.deepEqual(otcAssignments.slice(0, 8).map((item) => item.shopCode), ["01", "01", "01", "01", "02", "02", "02", "02"]);
assert.deepEqual(otcAssignments.slice(-4).map((item) => item.shopCode), ["05", "05", "05", "05"]);

console.log("shop category rules passed");
