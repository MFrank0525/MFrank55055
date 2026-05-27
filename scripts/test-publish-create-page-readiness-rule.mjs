import assert from "node:assert/strict";
import {
  classifyPublishFailure,
  shouldRetryPublishFailure,
  evaluatePublishCreatePageReadiness
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

console.log("publish create page readiness rule passed");
