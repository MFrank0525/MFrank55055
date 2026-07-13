import assert from "node:assert/strict";
import fs from "node:fs";
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
  "延草纲目滋补专卖店",
  "延草纲目基础营养专卖店",
  "延草纲目身体护理专卖店",
  "延草纲目保健用品专卖店",
  "延草纲目营养膳食专卖店",
  "延草纲目理疗器械旗舰店",
  "延草纲目健康护理专营店",
  "延草纲目家庭护理专营店",
  "延草纲目中医保健专营店",
  "延草纲目养生器械专营店",
  "延草纲目特医食品专营店",
  "延草纲目美体器械专卖店",
  "延草纲目护肤专卖店",
  "延草纲目体外检测专卖店",
  "延草纲目防护用品专卖店"
];

const allShopCodes = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, "0"));

assert.deepEqual(
  getShopSpecs().map((item) => item.watermarkText),
  allShopNames,
  "global shop order must match the publishing order"
);

const publishRuleText = fs.readFileSync("docs/auto-listing/steps/10-publish.md", "utf8");
let previousShopRuleIndex = -1;
for (const [index, shopName] of allShopNames.entries()) {
  const expectedRuleText = `${String(index + 1).padStart(2, "0")} ${shopName}`;
  const currentShopRuleIndex = publishRuleText.indexOf(expectedRuleText);
  assert.ok(currentShopRuleIndex > previousShopRuleIndex, `publish rule must list ${expectedRuleText} in canonical order`);
  previousShopRuleIndex = currentShopRuleIndex;
}

const trackedShopFolders = fs
  .readdirSync("input/auto-listing/shops", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "zh-CN"));
assert.deepEqual(
  trackedShopFolders,
  getShopSpecs().map((shop) => `${shop.shopCode}${shop.watermarkText}`),
  "tracked shop folders must match the canonical code/name catalog exactly"
);

const doctorSource = fs.readFileSync("src/cli/doctor.ts", "utf8");
assert.match(
  doctorSource,
  /const expectedName = `\$\{shop\.shopCode\}\$\{shop\.watermarkText\}`/,
  "doctor must validate the exact canonical shop folder name instead of only its numeric prefix"
);

assert.deepEqual(getProductCategoryPlan("医疗器械").shopCodes, allShopCodes);
assert.equal(getProductCategoryPlan("医疗器械").promptCount, 5);
assert.equal(getProductCategoryPlan("医疗器械").titleCount, 20);
assert.equal(getProductCategoryPlan("医疗器械").imagesPerShop, 1);

assert.deepEqual(getProductCategoryPlan("保健食品").shopCodes, allShopCodes);
assert.equal(getProductCategoryPlan("保健食品").promptCount, 5);
assert.equal(getProductCategoryPlan("保健食品").titleCount, 20);
assert.equal(getProductCategoryPlan("保健食品").imagesPerShop, 1);

assert.deepEqual(getProductCategoryPlan("非处方药").shopCodes, allShopCodes.slice(0, 10));
assert.equal(getProductCategoryPlan("非处方药").promptCount, 5);
assert.equal(getProductCategoryPlan("非处方药").titleCount, 20);
assert.equal(getProductCategoryPlan("非处方药").imagesPerShop, 2);

for (const category of ["医疗器械", "非处方药", "保健食品"]) {
  const plan = getProductCategoryPlan(category);
  assert.equal(plan.shopCodes.length * plan.imagesPerShop, 20, `${category} must resolve to exactly 20 publish targets`);
}

const medicalAssignments = resolveMainImageShopAssignments({
  shopCodes: getProductCategoryPlan("医疗器械").shopCodes,
  imagesPerShop: getProductCategoryPlan("医疗器械").imagesPerShop,
  totalImageCount: 20
});
assert.equal(medicalAssignments.length, 20);
assert.deepEqual(medicalAssignments.map((item) => item.shopCode), allShopCodes);

const otcAssignments = resolveMainImageShopAssignments({
  shopCodes: getProductCategoryPlan("非处方药").shopCodes,
  imagesPerShop: getProductCategoryPlan("非处方药").imagesPerShop,
  totalImageCount: 20
});
assert.equal(otcAssignments.length, 20);
assert.deepEqual(
  otcAssignments.map((item) => item.shopCode),
  allShopCodes.slice(0, 10).flatMap((code) => [code, code])
);

console.log("shop category rules passed");
