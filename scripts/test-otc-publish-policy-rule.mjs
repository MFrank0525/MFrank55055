import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getPublishCategoryMutationPolicy,
  resolvePublishSpecTemplateKeyword
} from "../dist/src/business/publish-from-spu/publish-category-policy.js";
import { assertResolvedMetadata, resolvePublishFromSpuMetadata } from "../dist/src/business/publish-from-spu/metadata-resolution.js";
import { buildPublishJobMetadata } from "../dist/src/autolist/publish.js";

const otc = getPublishCategoryMutationPolicy("非处方药");
assert.equal(otc.categoryAttributes, "leave_platform_state");
assert.equal(otc.specTemplateSelection, "buy_two_get_one");
assert.equal(otc.healthFoodSpecification, false, "OTC must preserve every value supplied by the controlled template");
assert.equal(otc.serviceSpuVerification, "drug_approval_number");
assert.equal(otc.serviceAfterSalesPolicy, "unsupported_seven_day_returns");
assert.equal(resolvePublishSpecTemplateKeyword(otc, "久光小泽非处方药"), "买二送一");
assert.equal(otc.healthFoodSafetyAndCategoryAttributes, false);
assert.equal(otc.healthFoodPackagingLabel, false);
assert.equal(otc.medicalDeviceCertificate, false);

const medical = getPublishCategoryMutationPolicy("医疗器械");
assert.equal(medical.categoryAttributes, "fill_model_spec");
assert.equal(medical.specTemplateSelection, "title_controlled");
assert.equal(resolvePublishSpecTemplateKeyword(medical, "久光小泽医疗器械"), "久光小泽");

const healthFood = getPublishCategoryMutationPolicy("保健食品");
assert.equal(healthFood.categoryAttributes, "fill_health_food_fields");
assert.equal(healthFood.specTemplateSelection, "buy_two_get_one");
assert.equal(resolvePublishSpecTemplateKeyword(healthFood, "久光小泽保健食品"), "买二送一");

const resolvedOtc = resolvePublishFromSpuMetadata({
  metadataOverride: { productCategory: "非处方药" },
  workbook: {
    brand: "延草纲目",
    spu: "SPU-OTC-001",
    title: "测试非处方药标题",
    shortTitle: "测试短标题",
    modelSpec: "",
    productPriceText: "40,30,20,10"
  }
});
assert.equal(resolvedOtc.modelSpec, "", "OTC must not synthesize a category-attribute/model-spec value");
assert.doesNotThrow(() => assertResolvedMetadata(resolvedOtc, "publish_from_spu"));

const workbookFields = {
  title: "测试标题",
  shortTitle: "测试短标题",
  brand: "延草纲目",
  spu: "SPU-001",
  modelSpec: "旧工作簿盒装值",
  productPriceText: "40,30,20,10"
};
const targetIdentity = {
  batchFingerprint: "batch-category-policy",
  recordId: "record-category-policy",
  taskId: "task-category-policy",
  shopCode: "01",
  watermarkNo: 1
};
const baseRecord = {
  recordId: targetIdentity.recordId,
  brand: "延草纲目",
  spu: "SPU-001",
  shortTitle: "测试短标题",
  productPriceText: "40,30,20,10"
};
assert.equal(
  buildPublishJobMetadata({
    workbookFields,
    feishuProductRecord: { ...baseRecord, productCategory: "非处方药" },
    targetIdentity
  }).modelSpec,
  "",
  "OTC publish metadata must discard a stale workbook modelSpec value before browser actions"
);
assert.equal(
  buildPublishJobMetadata({
    workbookFields: { ...workbookFields, modelSpec: "" },
    feishuProductRecord: { ...baseRecord, productCategory: "医疗器械" },
    targetIdentity
  }).modelSpec,
  "盒装",
  "medical-device publish metadata must retain its controlled modelSpec default"
);

const publishFlowSource = fs.readFileSync("src/business/publish-from-spu/publish-flow.ts", "utf8");
assert.match(
  publishFlowSource,
  /getPublishCategoryMutationPolicy\(productCategory\)[\s\S]*categoryAttributes === "fill_model_spec"[\s\S]*modelSpec: metadata\.modelSpec/,
  "basic metadata must include modelSpec only when the category mutation policy permits it"
);

const specActionSource = fs.readFileSync("src/business/publish-from-spu/actions/spec-price-action.ts", "utf8");
assert.match(
  specActionSource,
  /resolvePublishSpecTemplateKeyword\([\s\S]*deps\.applyFixedSpecsOnPage/,
  "spec action must apply the template selected by the explicit category policy"
);
assert.match(
  specActionSource,
  /resolvePublishSpecTemplateKeyword\([\s\S]*deps\.applyFixedSpecsOnPage\([\s\S]*controlledTemplateKeyword/,
  "spec action must resolve and pass the category-controlled template instead of inferring OTC behavior from title text"
);

console.log("OTC publish policy rule passed");
