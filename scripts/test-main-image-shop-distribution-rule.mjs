import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateMainImageAssets, resolveOpenAiCompatibleGeneratedImageIndex } from "../dist/src/autolist/main-image-assets.js";
import { writeFeishuPromptWordFiles } from "../dist/src/autolist/deepseek-word-docs.js";
import { getProductCategoryPlan, getShopSpecs } from "../dist/src/autolist/product-category.js";

const fixturePng = fs.readFileSync("input/fixed-main-images/辅助图02.png");

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
    feishuRecordId: `record-${category}`,
    simulateOnly: true
  });
}

const medical = await runSimulatedCategory("医疗器械");
assert.equal(medical.generatedFiles.length, 20);
assert.ok(medical.generatedFiles.every((item) => path.basename(item.productFolder).includes("record-医疗器械")));
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

async function runRecoveredRawCategory(category) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `main-image-reuse-shop-${category}-`));
  const shopRoot = prepareShopRoot(tmp);
  const sourceImagePath = path.join(tmp, "source.png");
  fs.writeFileSync(sourceImagePath, fixturePng);
  const wordFiles = writeFeishuPromptWordFiles({
    mainImageWorkDir: path.join(tmp, "words"),
    mainImageInstructionText: "飞书主图指令",
    sellingPointText: "产品卖点",
    prompts: ["场景一,产品展示", "场景二,产品展示", "场景三,产品展示", "场景四,产品展示", "场景五,产品展示"],
    positivePromptText: "飞书正向提示词",
    negativePromptText: "飞书反向提示词",
    promptCount: 5
  });
  const configFile = path.join(tmp, "image-generation.config.json");
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      provider: "openai-compatible",
      apiUrl: "https://example.invalid/v1/images/edits",
      apiKey: "test-api-key",
      model: "test-model",
      mode: "edits"
    }) + "\n",
    "utf8"
  );

  const currentRuntimeDir = path.join(tmp, "runs", "current");
  const currentTaskDir = path.join(currentRuntimeDir, "tasks", "image-001");
  fs.mkdirSync(currentTaskDir, { recursive: true });
  fs.writeFileSync(
    path.join(currentTaskDir, "reuse-identity.json"),
    JSON.stringify({
      sourceImagePath,
      sourceImageName: path.basename(sourceImagePath),
      feishuRecordId: "record-001"
    }) + "\n",
    "utf8"
  );
  for (let promptIndex = 1; promptIndex <= 5; promptIndex += 1) {
    const rawDir = path.join(currentTaskDir, `main-image-${String(promptIndex).padStart(2, "0")}`, "openai-compatible", "raw");
    fs.mkdirSync(rawDir, { recursive: true });
    for (let imageIndex = 1; imageIndex <= 4; imageIndex += 1) {
      fs.writeFileSync(path.join(rawDir, `generated-${String(imageIndex).padStart(2, "0")}.png`), fixturePng);
    }
  }
  const staleStageDir = path.join(currentTaskDir, "staged", "03");
  fs.mkdirSync(staleStageDir, { recursive: true });
  fs.writeFileSync(path.join(staleStageDir, "wrong-watermark-leftover.png"), fixturePng);

  const plan = getProductCategoryPlan(category);
  return generateMainImageAssets({
    runtimeDir: currentRuntimeDir,
    taskId: "image-001",
    shopRootDir: shopRoot,
    sourceImagePath,
    sellingPointText: "延草纲目,示例产品,示例通用名称",
    brandedGenericName: "延草纲目示例通用名称",
    wordFiles,
    imageGenerationProvider: "openai-compatible",
    imageGenerationConfigFile: configFile,
    mainImageExpectedCount: 4,
    mainImageCountStrategy: "require_exact",
    promptCount: plan.promptCount,
    shopCodes: plan.shopCodes,
    imagesPerShop: plan.imagesPerShop,
    feishuRecordId: "record-001",
    simulateOnly: false
  });
}

const recovered = await runRecoveredRawCategory("医疗器械");
assert.equal(recovered.generatedFiles.length, 20);
assert.deepEqual(
  recovered.generatedFiles.map((item) => path.basename(item.shopFolder).slice(0, 2)),
  ["01", "01", "02", "02", "03", "03", "04", "04", "05", "05", "06", "06", "07", "07", "08", "08", "09", "09", "10", "10"]
);
assert.deepEqual(
  recovered.generatedFiles.map(
    (item) => getShopSpecs().find((shop) => path.basename(item.imageFile).includes(shop.watermarkText))?.watermarkText || ""
  ),
  [
    "延草纲目大药房专营店",
    "延草纲目大药房专营店",
    "延草纲目药品专营店",
    "延草纲目药品专营店",
    "延草纲目个护保健专营店",
    "延草纲目个护保健专营店",
    "延草纲目康复理疗专营店",
    "延草纲目康复理疗专营店",
    "延草纲目医疗保健专营店",
    "延草纲目医疗保健专营店",
    "延草纲目理疗器械旗舰店",
    "延草纲目理疗器械旗舰店",
    "延草纲目健康护理专营店",
    "延草纲目健康护理专营店",
    "延草纲目家庭护理专营店",
    "延草纲目家庭护理专营店",
    "延草纲目中医保健专营店",
    "延草纲目中医保健专营店",
    "延草纲目养生器械专营店",
    "延草纲目养生器械专营店"
  ]
);

assert.deepEqual(resolveOpenAiCompatibleGeneratedImageIndex({ imageIndexOffset: 1, localImageIndex: 1 }), {
  absoluteImageIndex: 2,
  paddedImageIndex: "02"
});

console.log("main image shop distribution rule passed");
