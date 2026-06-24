import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPublishJobMetadata } from "../dist/src/autolist/publish.js";
import { resolvePublishFromSpuMetadata } from "../dist/src/business/publish-from-spu.js";

const publishSource = fs.readFileSync("src/autolist/publish.ts", "utf8");
const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
const publishFromSpuSource = [
  "src/business/publish-from-spu.ts",
  "src/business/publish-from-spu/publish-flow.ts",
  "src/business/publish-from-spu/job.ts"
].map((file) => fs.readFileSync(file, "utf8")).join("\n");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.match(
  publishSource,
  /const metadataByTargetKey = new Map\([\s\S]*pendingFolders\.map[\s\S]*buildPublishJobMetadata\(\{[\s\S]*feishuProductRecord:\s*options\.feishuProductRecord[\s\S]*targetIdentity[\s\S]*if \(options\.simulateOnly\)/,
  "Every pending target must build metadata from the current Feishu record and the same canonical target identity before simulateOnly returns."
);
assert.match(
  orchestratorSource,
  /productIdentity:\s*buildPublishProductIdentity\(current,\s*feishuBatchFingerprint\),\s*feishuProductRecord:\s*current\.feishuProductRecord,/,
  "The orchestrator must pass identity and metadata source from the same current task."
);
assert.match(
  publishFromSpuSource,
  /runPublishFlow\(\s*runtimeDir,\s*resolvedMetadata,/s,
  "runPublishFromSpuJob must pass the complete resolved metadata object to runPublishFlow without a second projection."
);
assert.match(
  `${packageJson.scripts["prerules:check"] || ""} ${packageJson.scripts["rules:check"] || ""}`,
  /test-health-food-publish-metadata-rule\.mjs/,
  "The health-food metadata provenance test must run in rules:check."
);

const targetIdentity = {
  batchFingerprint: "batch-current",
  recordId: "rec-current",
  taskId: "image-003",
  shopCode: "07",
  watermarkNo: 13
};

const currentRecord = {
  recordId: "rec-current",
  userCognitionName: "当前保健食品",
  genericName: "当前通用名称",
  brand: "当前品牌",
  spu: "CURRENT-SPU",
  sellingPointText: "当前卖点",
  deepseekPromptText: "当前提示词",
  mainImageInstructionText: "当前主图指令",
  positivePromptText: "当前正向提示词",
  negativePromptText: "当前反向提示词",
  titleKeywordText: "当前标题关键词",
  titleSuffixText: "",
  productPriceText: "99,89,79,69",
  shortTitle: "当前短标题",
  productCategory: "保健食品",
  manufacturerName: "当前生产企业",
  manufacturerAddress: "当前生产地址",
  netContent: "60粒",
  productStandardCode: "Q/CURRENT 001",
  ingredients: "当前原料",
  healthFunction: "当前保健功能",
  specification: "0.5g×60粒",
  qualificationImages: [
    {
      fileToken: "qualification-secret-token",
      name: "当前资质.jpg",
      temporaryUrl: "https://temporary.example/qualification",
      raw: { token: "qualification-raw-token" }
    }
  ],
  whiteBackgroundImages: [
    {
      fileToken: "white-secret-token",
      name: "当前白底图.jpg",
      downloadUrl: "https://temporary.example/white",
      raw: { token: "white-raw-token" }
    }
  ],
  rawFields: {
    历史运行时字段: "禁止传播",
    token: "raw-fields-secret-token"
  }
};

const metadata = buildPublishJobMetadata({
  workbookFields: {
    title: "工作簿标题",
    shortTitle: "工作簿短标题",
    brand: "工作簿品牌",
    spu: "WORKBOOK-SPU",
    modelSpec: "工作簿规格",
    productPriceText: "1,2,3,4"
  },
  feishuProductRecord: currentRecord,
  targetIdentity
});

const resolvedMetadata = resolvePublishFromSpuMetadata({
  metadataOverride: metadata,
  workbook: {
    brand: "历史工作簿品牌",
    spu: "HISTORICAL-SPU",
    title: "历史工作簿标题",
    shortTitle: "历史工作簿短标题",
    modelSpec: "历史工作簿规格",
    productPriceText: "1,1,1,1"
  }
});
for (const field of [
  "productCategory",
  "manufacturerName",
  "manufacturerAddress",
  "netContent",
  "productStandardCode",
  "ingredients",
  "healthFunction",
  "specification",
  "canonicalIdentity"
]) {
  assert.deepEqual(
    resolvedMetadata[field],
    metadata[field],
    `runPublishFromSpuJob resolvedMetadata must retain ${field}.`
  );
}
assert.match(
  publishFromSpuSource,
  /data:\s*\{[\s\S]*metadata:\s*resolvedMetadata,/,
  "The publish job result must persist the same complete resolved metadata."
);

assert.deepEqual(
  {
    productCategory: metadata.productCategory,
    manufacturerName: metadata.manufacturerName,
    manufacturerAddress: metadata.manufacturerAddress,
    netContent: metadata.netContent,
    productStandardCode: metadata.productStandardCode,
    ingredients: metadata.ingredients,
    healthFunction: metadata.healthFunction,
    specification: metadata.specification
  },
  {
    productCategory: "保健食品",
    manufacturerName: "当前生产企业",
    manufacturerAddress: "当前生产地址",
    netContent: "60粒",
    productStandardCode: "Q/CURRENT 001",
    ingredients: "当前原料",
    healthFunction: "当前保健功能",
    specification: "0.5g×60粒"
  },
  "Health-food publish metadata must come from the exact current normalized FeishuProductRecord."
);
assert.deepEqual(
  metadata.canonicalIdentity,
  targetIdentity,
  "Publish job metadata must carry the exact canonical target identity."
);
assert.equal(metadata.feishuRecordId, targetIdentity.recordId);
assert.throws(
  () =>
    buildPublishJobMetadata({
      workbookFields: {
        title: "工作簿标题",
        shortTitle: "工作簿短标题",
        brand: "工作簿品牌",
        spu: "WORKBOOK-SPU",
        modelSpec: "工作簿规格",
        productPriceText: "1,2,3,4"
      },
      feishuProductRecord: { ...currentRecord, recordId: "rec-history" },
      targetIdentity
    }),
  /recordId.*canonical identity/i,
  "Historical Feishu records must not be attached to the current canonical publish target."
);

const serializedMetadata = JSON.stringify(metadata);
for (const forbidden of [
  "rawFields",
  "qualificationImages",
  "whiteBackgroundImages",
  "qualification-secret-token",
  "white-secret-token",
  "temporary.example",
  "raw-fields-secret-token"
]) {
  assert.equal(
    serializedMetadata.includes(forbidden),
    false,
    `Publish metadata must not carry ${forbidden}.`
  );
}

console.log("health food publish metadata rule passed");
