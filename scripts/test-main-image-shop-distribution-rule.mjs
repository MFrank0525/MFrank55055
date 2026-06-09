import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateMainImageAssets } from "../dist/src/autolist/jimeng-assets.js";
import { getProductCategoryPlan, getShopSpecs } from "../dist/src/autolist/product-category.js";

function prepareShopRoot(tmp) {
  const shopRoot = path.join(tmp, "shops");
  for (const shop of getShopSpecs()) {
    fs.mkdirSync(path.join(shopRoot, `${shop.shopCode}${shop.watermarkText}`), { recursive: true });
  }
  return shopRoot;
}

async function runSimulatedCategory(category) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `main-image-shop-${category}-`));
  const shopRoot = prepareShopRoot(tmp);
  const sourceImagePath = path.join(tmp, "source.png");
  fs.writeFileSync(sourceImagePath, "source-image", "utf8");
  const wordFiles = Array.from({ length: 5 }, (_, index) => path.join(tmp, `prompt-${index + 1}.docx`));
  const plan = getProductCategoryPlan(category);
  return generateMainImageAssets({
    runtimeDir: path.join(tmp, "runtime"),
    taskId: "image-001",
    shopRootDir: shopRoot,
    sourceImagePath,
    sellingPointText: "延草纲目,示例产品,示例通用名称",
    brandedGenericName: "延草纲目示例通用名称",
    wordFiles,
    imageGenerationProvider: "openai-compatible",
    imageGenerationConfigFile: "",
    mainImageExpectedCount: 4,
    mainImageCountStrategy: "require_exact",
    promptCount: plan.promptCount,
    shopCodes: plan.shopCodes,
    imagesPerShop: plan.imagesPerShop,
    simulateOnly: true
  });
}

const medical = await runSimulatedCategory("医疗器械");
assert.equal(medical.generatedFiles.length, 20);
assert.deepEqual(
  medical.generatedFiles.map((item) => path.basename(item.shopFolder).slice(0, 2)),
  ["01", "01", "02", "02", "03", "03", "04", "04", "05", "05", "06", "06", "07", "07", "08", "08", "09", "09", "10", "10"]
);

const otc = await runSimulatedCategory("非处方药");
assert.equal(otc.generatedFiles.length, 20);
assert.deepEqual(
  otc.generatedFiles.map((item) => path.basename(item.shopFolder).slice(0, 2)),
  ["01", "01", "01", "01", "02", "02", "02", "02", "03", "03", "03", "03", "04", "04", "04", "04", "05", "05", "05", "05"]
);

console.log("main image shop distribution rule passed");
