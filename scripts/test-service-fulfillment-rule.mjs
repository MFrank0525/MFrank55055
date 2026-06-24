import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluateServiceFulfillmentCompletion
} from "../dist/src/business/publish-from-spu/publish-rules.js";

const publishSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");

assert.match(
  publishSource,
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

console.log("service fulfillment rule passed");
