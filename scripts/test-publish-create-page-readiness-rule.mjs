import assert from "node:assert/strict";
import {
  classifyPublishFailure,
  shouldRetryPublishFailure,
  evaluateBasicInfoGateRecovery,
  evaluateBasicPrefillReadiness,
  evaluatePublishCreatePageReadiness,
  resolveBasicFieldIdAliases
} from "../src/business/publish-from-spu/publish-rules.ts";

assert.deepEqual(
  evaluatePublishCreatePageReadiness({
    usable: true,
    bodyTextLength: 120,
    sectionCount: 4,
    loading: false,
    loginRequired: false,
    bodyText: "基础信息图文信息价格库存服务与履约发布商品数据异常请刷新重试立即刷新"
  }),
  {
    action: "wait_or_reload",
    issue: "Publish create page reported recoverable data/network error."
  }
);

const sectionActivationFailureClass = classifyPublishFailure(
  "Failed to activate publish section tab: expected=图文信息; actual=<unknown>"
);
assert.equal(sectionActivationFailureClass, "platform_page_not_ready");
assert.equal(shouldRetryPublishFailure(sectionActivationFailureClass, 0), true);

assert.deepEqual(
  evaluatePublishCreatePageReadiness({
    usable: true,
    bodyTextLength: 120,
    sectionCount: 4,
    loading: true,
    loginRequired: false,
    bodyText: "基础信息图文信息价格库存服务与履约发布商品加载中"
  }),
  {
    action: "wait_or_reload",
    issue: "Publish create page is still loading."
  }
);

assert.deepEqual(
  evaluateBasicPrefillReadiness({
    shortTitleRequired: true,
    shortTitleFieldVisible: false
  }),
  {
    action: "reopen_from_platform_spu",
    issue: "Expected short-title field is missing from the SPU-prefilled publish page."
  }
);

assert.deepEqual(
  evaluateBasicPrefillReadiness({
    shortTitleRequired: true,
    shortTitleFieldVisible: true
  }),
  {
    action: "ready",
    issue: ""
  }
);
assert.deepEqual(
  resolveBasicFieldIdAliases("shortTitle"),
  ["导购短标题", "短标题", "导购标题"],
  "short-title field lookup must be rule-driven and tolerate Doudian label variants"
);

assert.deepEqual(
  evaluateBasicInfoGateRecovery({
    expectedFields: ["title", "shortTitle", "modelSpec"],
    missingFields: ["title", "shortTitle", "modelSpec"]
  }),
  {
    action: "reopen_from_platform_spu",
    issue: "All expected basic-info fields disappeared from the publish page."
  }
);

assert.deepEqual(
  evaluateBasicInfoGateRecovery({
    expectedFields: ["title", "shortTitle", "modelSpec"],
    missingFields: ["modelSpec"]
  }),
  {
    action: "block",
    issue: "Basic-info fields are incomplete."
  }
);

console.log("publish create page readiness rule passed");
