import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluateServiceFulfillmentCompletion,
  resolvePublishCheckBlockingFields
} from "../dist/src/business/publish-from-spu/publish-rules.js";

const publishSource = [
  fs.readFileSync("src/business/publish-from-spu/spec-service-page-action.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/service-fulfillment-page-action.ts", "utf8")
].join("\n");
const serviceActionSource = fs.readFileSync("src/business/publish-from-spu/actions/service-action.ts", "utf8");

assert.match(
  serviceActionSource,
  /before_service_module/,
  "publish flow must re-check basic info before entering service fulfillment"
);
assert.match(
  publishSource,
  /readVisibleFreightTemplateOptionTexts[\s\S]*slice\(0, 6\)/,
  "freight-template failure feedback must show a short option summary, not the whole page text"
);

assert.deepEqual(
  evaluateServiceFulfillmentCompletion({
    shippingModeSelected: true,
    shippingTimeSelected: true,
    productStatusSelected: true,
    freightTemplateName: "延草运费模板"
  }),
  { passed: true, issue: "" }
);

assert.deepEqual(
  evaluateServiceFulfillmentCompletion({
    shippingModeSelected: true,
    shippingTimeSelected: false,
    productStatusSelected: true,
    freightTemplateName: "延草运费模板"
  }),
  {
    passed: false,
    issue: "Missing configured fields: shippingTime"
  }
);

assert.deepEqual(
  evaluateServiceFulfillmentCompletion({
    shippingModeSelected: true,
    shippingTimeSelected: true,
    productStatusSelected: true,
    freightTemplateName: ""
  }),
  {
    passed: false,
    issue: "Freight template was not selected. Missing configured fields: freightTemplate"
  }
);

assert.deepEqual(
  resolvePublishCheckBlockingFields({
    blockingFields: ["白底图", "主图3:4", "型号规格"],
    completedFields: ["modelSpec"],
    filledPriceRows: 4,
    freightTemplateName: "延草运费模板"
  }),
  [],
  "Doudian fill-check must not block on white-background or 3:4 slots because they are outside the project publish flow"
);

assert.deepEqual(
  resolvePublishCheckBlockingFields({
    blockingFields: ["白底图", "商品标题"],
    completedFields: [],
    filledPriceRows: 0,
    freightTemplateName: ""
  }),
  ["商品标题"],
  "optional graphic slot filtering must not hide real publish blocking fields"
);

console.log("service fulfillment rule passed");
