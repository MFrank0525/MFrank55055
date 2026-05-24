export interface PublishPageSnapshot {
  url: string;
  bodyText: string;
}

export interface PublishSubmissionRuleResult {
  submitted: boolean;
  issue: string;
  freshCreatePage: boolean;
}

export interface PublishResultRuleInput {
  ok?: boolean;
  status?: string;
  message?: string;
  publishClicked?: boolean;
  publishIssue?: string;
}

export interface PublishResultRuleDecision {
  safelyPublished: boolean;
  finalVerifyStatus: "not_checked" | "publish_signal_confirmed" | "list_verified" | "needs_manual_review";
  errorClass: string;
  issue: string;
}

export interface PublishRuleCheck {
  passed: boolean;
  issue: string;
}

export interface ShopSwitchMenuStateInput {
  expectedShopName: string;
  currentShopName: string;
  menuOpened: boolean;
  switchEntryVisible: boolean;
}

export interface ShopSwitchMenuStateDecision {
  action: "already_in_target_shop" | "click_switch_entry" | "retry_menu" | "open_menu";
  issue: string;
}

export interface PublishCreatePageHealthInput {
  usable: boolean;
  bodyTextLength: number;
  sectionCount: number;
  loading: boolean;
  loginRequired: boolean;
  bodyText?: string;
}

export interface PublishCreatePageReadinessDecision {
  action: "ready" | "fail_login" | "wait_or_reload" | "reopen_from_platform_spu";
  issue: string;
}

const SUBMISSION_SUCCESS_TEXTS = [
  "发布成功",
  "提交成功",
  "商品发布成功",
  "已提交审核",
  "提交审核成功",
  "创建成功",
  "发布任务已提交"
];

const SUBMISSION_BLOCKING_TEXTS = ["必填", "请填写", "错误", "失败", "待处理", "校验未通过", "请上传", "不能为空"];

export function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function normalizeShopRuleText(value: string): string {
  return normalizeVisibleText(value).replace(/^\d+/, "");
}

export function isExpectedShopContext(currentShopName: string, expectedShopName: string): boolean {
  const current = normalizeShopRuleText(currentShopName);
  const expected = normalizeShopRuleText(expectedShopName);
  return Boolean(current && expected && (current.includes(expected) || expected.includes(current)));
}

export function evaluateShopSwitchMenuState(input: ShopSwitchMenuStateInput): ShopSwitchMenuStateDecision {
  if (isExpectedShopContext(input.currentShopName, input.expectedShopName)) {
    return { action: "already_in_target_shop", issue: "" };
  }
  if (!input.menuOpened) {
    return { action: "open_menu", issue: "Shop switch menu is not open." };
  }
  if (input.switchEntryVisible) {
    return { action: "click_switch_entry", issue: "" };
  }
  return {
    action: "retry_menu",
    issue: "Shop switch entry is unavailable while current shop does not match target."
  };
}

export function evaluatePublishCreatePageReadiness(input: PublishCreatePageHealthInput): PublishCreatePageReadinessDecision {
  const bodyText = normalizeVisibleText(input.bodyText || "").toLowerCase();
  if (input.usable) {
    return { action: "ready", issue: "" };
  }
  if (input.loginRequired) {
    return { action: "fail_login", issue: "Doudian login is required before publishing can continue." };
  }
  if (bodyText.includes("spu信息填充失败") || bodyText.includes("spu填充失败") || bodyText.includes("信息填充失败")) {
    return { action: "reopen_from_platform_spu", issue: "Publish create page reported SPU prefill failure." };
  }
  if (!input.loading && input.sectionCount === 0 && input.bodyTextLength > 0 && input.bodyTextLength <= 120) {
    return { action: "reopen_from_platform_spu", issue: "Publish create page has no publish sections after SPU query." };
  }
  return { action: "wait_or_reload", issue: "Publish create page is not ready yet." };
}

export function isFreshPublishCreatePage(snapshot: PublishPageSnapshot): boolean {
  const bodyText = normalizeVisibleText(snapshot.bodyText);
  return (
    snapshot.url.includes("/ffa/g/create") &&
    (bodyText.includes("主图上传") || bodyText.includes("上传主图")) &&
    bodyText.includes("商品标题") &&
    bodyText.includes("0/60")
  );
}

export function evaluatePublishSubmission(snapshot: PublishPageSnapshot): PublishSubmissionRuleResult {
  const bodyText = normalizeVisibleText(snapshot.bodyText);
  if (SUBMISSION_SUCCESS_TEXTS.some((text) => bodyText.includes(text))) {
    return { submitted: true, issue: "", freshCreatePage: false };
  }
  if (!snapshot.url.includes("/ffa/g/create") && /\/ffa\/g\/(success|audit)/.test(snapshot.url) && !bodyText.includes("发布商品")) {
    return { submitted: true, issue: "", freshCreatePage: false };
  }

  const freshCreatePage = isFreshPublishCreatePage(snapshot);
  const issue =
    bodyText
      .split(/[\n。；;，,]/)
      .map((line) => line.trim())
      .filter((line) => SUBMISSION_BLOCKING_TEXTS.some((text) => line.includes(text)))
      .slice(0, 3)
      .join(" | ") || "No publish success signal was detected after clicking 发布商品.";
  return { submitted: false, issue, freshCreatePage };
}

export function evaluatePublishSubmissionAfterAction(
  snapshot: PublishPageSnapshot,
  publishClickAttempted: boolean
): PublishSubmissionRuleResult {
  const state = evaluatePublishSubmission(snapshot);
  if (!state.submitted && state.freshCreatePage && publishClickAttempted) {
    return { submitted: true, issue: "", freshCreatePage: true };
  }
  return state;
}

export function classifyPublishFailure(message: string): string {
  const text = normalizeVisibleText(message);
  if (!text) return "";
  if (
    text.includes("Publishcreatepagedidnotbecomeready") ||
    text.includes("spu信息填充失败") ||
    text.includes("spu填充失败") ||
    text.includes("信息填充失败")
  ) {
    return "platform_spu_prefill_failed";
  }
  if (text.includes("PlatformSPUquerypagewasnotready") || text.includes("标品管理") && text.includes("加载")) {
    return "platform_page_not_ready";
  }
  if (text.includes("Shopswitchfailed") && text.includes("couldnotfind切换组织/店铺")) {
    return "shop_switch_entry_unavailable";
  }
  if (text.includes("contextwaslost") || text.includes("pagecontextwaslost") || text.includes("Targetclosed")) {
    return "page_context_lost";
  }
  if (text.includes("freshcreatepage") || text.includes("空白") || text.includes("0/60")) {
    return "fresh_create_after_submit";
  }
  if (text.includes("必填") || text.includes("请填写") || text.includes("不能为空") || text.includes("校验未通过")) {
    return "validation_blocked";
  }
  if (text.includes("主图") || text.includes("白底图") || text.includes("3:4") || text.includes("详情")) {
    return "image_section_blocked";
  }
  if (text.includes("店铺") || text.includes("shop")) {
    return "shop_context_mismatch";
  }
  if (text.includes("SPU") || text.includes("标品")) {
    return "spu_query_or_match_failed";
  }
  return "unknown_publish_failure";
}

export function shouldRetryPublishFailure(errorClass: string, retryAttempt: number, maxRetryAttempts = 2): boolean {
  if (retryAttempt >= maxRetryAttempts) {
    return false;
  }
  return ["platform_page_not_ready", "platform_spu_prefill_failed", "page_context_lost", "shop_switch_entry_unavailable"].includes(errorClass);
}

export function evaluatePublishResult(input: PublishResultRuleInput): PublishResultRuleDecision {
  const message = input.message || input.publishIssue || "";
  if (input.ok === true && input.status === "published" && input.publishClicked === true) {
    return {
      safelyPublished: true,
      finalVerifyStatus: "publish_signal_confirmed",
      errorClass: "",
      issue: ""
    };
  }
  return {
    safelyPublished: false,
    finalVerifyStatus: "needs_manual_review",
    errorClass: classifyPublishFailure(message),
    issue: message || "Publish result did not include a safe success signal."
  };
}

export function evaluateForbiddenGraphicSections(remainingSections: string[]): PublishRuleCheck {
  return remainingSections.length
    ? {
        passed: false,
        issue: `Forbidden graphic sections were not empty: ${remainingSections.join(", ")}`
      }
    : { passed: true, issue: "" };
}

export function isUploadPlaceholderGraphicContext(value: string): boolean {
  const text = normalizeVisibleText(value);
  if (!text) {
    return false;
  }
  if (text.includes("删除")) {
    return false;
  }
  return /上传(?:白底图|主图|辅助图)/.test(text);
}

export function evaluateDetailImageCompletion(input: {
  filledFromMain: boolean;
  qualificationImageCount: number;
  finalDetailCount: number;
  expectedDetailCount: number;
}): PublishRuleCheck {
  if (!input.filledFromMain) {
    return { passed: false, issue: "Detail section was not filled from main images before qualification upload." };
  }
  if (input.qualificationImageCount <= 0) {
    return { passed: false, issue: "No Feishu qualification images were available for detail section." };
  }
  if (input.finalDetailCount < input.expectedDetailCount) {
    return {
      passed: false,
      issue: `Detail image count did not reach expected count. expected=${input.expectedDetailCount}; actual=${input.finalDetailCount}`
    };
  }
  if (input.finalDetailCount > input.expectedDetailCount) {
    return {
      passed: false,
      issue: `Detail image count exceeded expected count. expected=${input.expectedDetailCount}; actual=${input.finalDetailCount}`
    };
  }
  return { passed: true, issue: "" };
}

export function evaluatePriceInventoryCompletion(input: {
  filledPriceRows: number;
  expectedRows: number;
  priceIssue: string;
  specIssue: string;
}): PublishRuleCheck {
  if (input.specIssue) {
    return { passed: false, issue: input.specIssue };
  }
  if (input.priceIssue) {
    return { passed: false, issue: input.priceIssue };
  }
  if (input.filledPriceRows < input.expectedRows) {
    return {
      passed: false,
      issue: `Expected ${input.expectedRows} price rows but filled ${input.filledPriceRows}.`
    };
  }
  return { passed: true, issue: "" };
}

export function evaluateServiceCompletion(input: { freightTemplateName: string; missingFields: string[] }): PublishRuleCheck {
  if (!input.freightTemplateName || input.missingFields.length) {
    return {
      passed: false,
      issue: [
        !input.freightTemplateName ? "Freight template was not selected." : "",
        input.missingFields.length ? `Missing configured fields: ${input.missingFields.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join(" ")
    };
  }
  return { passed: true, issue: "" };
}

export function evaluatePublishCheckResult(input: {
  checkPassed: boolean;
  blockingFields: string[];
  uploadIssue: string;
  specIssue: string;
  priceIssue: string;
}): PublishRuleCheck {
  if (input.blockingFields.length) {
    return { passed: false, issue: `blockingFields=${input.blockingFields.join(", ")}` };
  }
  const issue = input.uploadIssue || input.specIssue || input.priceIssue;
  if (!input.checkPassed || issue) {
    return { passed: false, issue: issue || "Publish check still reports blocking issues on the page." };
  }
  return { passed: true, issue: "" };
}
