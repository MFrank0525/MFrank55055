import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyPublishFailure,
  shouldRetryPublishFailure,
  evaluateBasicInfoGateRecovery,
  evaluateBasicPrefillReadiness,
  evaluatePublishCreatePageReadiness,
  resolveBasicFieldIdAliases
} from "../dist/src/business/publish-from-spu/publish-rules.js";

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

const readinessActionSource = fs.readFileSync("src/business/publish-from-spu/publish-page-readiness.ts", "utf8");
assert.match(
  readinessActionSource,
  /getByRole\("button", \{ name: "立即刷新", exact: true \}\)/,
  "A publish-page data-error surface must use its exact DOM refresh action before navigation fallback"
);
const publishFlowSource = fs.readFileSync("src/business/publish-from-spu/publish-flow.ts", "utf8");
assert.match(
  readinessActionSource,
  /export async function assertPublishMutationBoundaryReady/,
  "Every publish module needs one shared, read-only session/readiness boundary"
);
for (const boundary of ["before_graphic_info", "before_price_inventory", "before_service_fulfillment", "before_final_submit"]) {
  assert.match(
    publishFlowSource,
    new RegExp(`assertPublishMutationBoundaryReady\\([^)]*${boundary}`),
    `Publish flow must verify the visible session and create-page health at ${boundary}`
  );
}

assert.deepEqual(
  evaluatePublishCreatePageReadiness({
    usable: false,
    bodyTextLength: 12,
    sectionCount: 0,
    loading: false,
    loginRequired: false,
    bodyText: "返回商家后台 商品发布"
  }),
  {
    action: "wait_or_reload",
    issue: "Publish create page is not ready yet."
  },
  "A spinner-only create-page shell must be allowed to finish rendering instead of being misclassified as SPU prefill failure"
);

assert.deepEqual(
  evaluatePublishCreatePageReadiness({
    usable: false,
    bodyTextLength: 16,
    sectionCount: 0,
    loading: false,
    loginRequired: false,
    bodyText: "商品发布 SPU信息填充失败"
  }),
  {
    action: "reopen_from_platform_spu",
    issue: "Publish create page reported SPU prefill failure."
  },
  "An explicit SPU prefill failure must still reopen from the authoritative platform SPU query"
);

const sectionActivationFailureClass = classifyPublishFailure(
  "Failed to activate publish section tab: expected=图文信息; actual=<unknown>"
);
assert.equal(sectionActivationFailureClass, "platform_page_not_ready");
assert.equal(shouldRetryPublishFailure(sectionActivationFailureClass, 0), true);

const staleActiveSectionFailureClass = classifyPublishFailure(
  "Failed to activate publish section tab: expected=价格库存; actual=图文信息"
);
assert.equal(
  staleActiveSectionFailureClass,
  "platform_page_not_ready",
  "A stale active section is still a verified pre-submit page readiness failure and must receive bounded safe recovery"
);
assert.equal(shouldRetryPublishFailure(staleActiveSectionFailureClass, 0), true);

const sectionNavigationSource = fs.readFileSync(
  "src/business/publish-from-spu/publish-section-navigation.ts",
  "utf8"
);
const readActiveSectionSource = sectionNavigationSource.slice(
  sectionNavigationSource.indexOf("export async function readActivePublishSectionTab"),
  sectionNavigationSource.indexOf("export async function isPublishSectionContentVisible")
);
assert.match(
  readActiveSectionSource,
  /\[role="tab"\]\[aria-selected="true"\]/,
  "Active-section readback must use the platform's exact selected-tab ARIA contract"
);
assert.doesNotMatch(
  readActiveSectionSource,
  /querySelectorAll\("body \*"\)|getComputedStyle|getBoundingClientRect/,
  "Active-section readback must not infer state from broad text, geometry, color, or font styling"
);
const ensureSectionSource = sectionNavigationSource.slice(
  sectionNavigationSource.indexOf("export async function ensurePublishSectionTab"),
  sectionNavigationSource.indexOf("export async function ensureServiceSectionReady")
);
assert.match(
  ensureSectionSource,
  /getByRole\("tab", \{ name: text, exact: true \}\)/,
  "Section navigation must target the unique exact ARIA tab"
);
assert.match(
  ensureSectionSource,
  /aria-selected/,
  "Section navigation must verify the target tab's ARIA selected state after clicking"
);
assert.match(
  ensureSectionSource,
  /goodsEditScrollContainer-\$\{text\}/,
  "Section navigation must verify the exact Doudian section container instead of fuzzy field text or coordinates"
);
assert.doesNotMatch(
  ensureSectionSource,
  /querySelectorAll\("body \*"\)|clickVisibleText|\.el\.click\(\)|target\?\.click\(\)/,
  "Section navigation must not fall back to broad body-text searches or unverified DOM clicks"
);

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
