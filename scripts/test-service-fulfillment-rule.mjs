import assert from "node:assert/strict";
import {
  evaluateServiceFulfillmentCompletion
} from "../src/business/publish-from-spu/publish-rules.ts";

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
