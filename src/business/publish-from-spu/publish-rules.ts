import {
  evaluateHealthFoodPublishRules,
  type HealthFoodPublishRuleInput,
  type HealthFoodRuleDecision
} from "./health-food-rules.js";

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
  publishClickAttempted?: boolean;
  publishIssue?: string;
}

export interface PublishResultRuleDecision {
  safelyPublished: boolean;
  finalVerifyStatus: "not_checked" | "publish_signal_confirmed" | "list_verified" | "submit_accepted_unconfirmed" | "needs_manual_review";
  errorClass: string;
  issue: string;
}

export interface PublishBatchFailureDecision {
  safelyPublished: boolean;
  errorClass: string;
}

export interface PublishRuleCheck {
  passed: boolean;
  issue: string;
}

export const OPTIONAL_GRAPHIC_SECTIONS_ARE_OUTSIDE_PUBLISH_FLOW = true;

export interface SpecTemplateCompletionRuleInput {
  selectedTemplate?: string;
  expectedTemplateKeyword?: string;
  filledSpecValues: number;
  expectedSpecValues: number;
  priceRows: number;
  blankSpecValueInputs: number;
}

export interface PriceInventoryEntryRuleInput {
  specIssue: string;
}

export interface ShippingBeforePriceInventoryRuleInput {
  shippingModeSelected: boolean;
  shippingTimeSelected: boolean;
}

export interface PriceInventoryEntryRuleDecision {
  action: "apply_price_inventory" | "block_until_spec_template_complete";
  issue: string;
}

export interface PriceInventoryRowInputCandidate {
  placeholder: string;
  context: string;
  centerX: number;
}

export interface PriceInventoryRowInputRoles {
  priceIndex: number;
  stockIndex: number;
}

export interface ServiceFulfillmentState {
  shippingModeSelected: boolean;
  shippingTimeSelected: boolean;
  productStatusSelected: boolean;
  freightTemplateName: string;
}

export interface DetailUploadOutcomeRuleInput {
  uploadActionCompleted: boolean;
  detailRule: PublishRuleCheck;
}

export interface MedicalDeviceCertificateUploadRuleInput {
  productCategory?: string;
  categoryText: string;
  selectedCertificateCount: number;
  qualificationImageCount: number;
}

export interface MedicalDeviceCertificateUploadRuleDecision {
  action: "not_required" | "leave_existing_certificate" | "upload_first_qualification_image" | "blocked_missing_qualification_image";
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

export interface PlatformSpuQueryPageReadinessInput {
  url: string;
  bodyText: string;
  visibleInputCount: number;
  brandInputFound: boolean;
  spuInputFound: boolean;
  accountMenuOpen: boolean;
  loading: boolean;
}

export interface PlatformSpuQueryPageReadinessDecision {
  ready: boolean;
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

export interface BasicPrefillReadinessInput {
  shortTitleRequired: boolean;
  shortTitleFieldVisible: boolean;
}

export interface BasicPrefillReadinessDecision {
  action: "ready" | "reopen_from_platform_spu";
  issue: string;
}

export interface BasicInfoGateRecoveryInput {
  expectedFields: string[];
  missingFields: string[];
}

export interface BasicInfoGateRecoveryDecision {
  action: "block" | "reopen_from_platform_spu";
  issue: string;
}

export type BasicFieldKey = "title" | "shortTitle" | "modelSpec";

export function resolveBasicFieldIdAliases(field: BasicFieldKey): string[] {
  if (field === "title") {
    return ["商品标题"];
  }
  if (field === "shortTitle") {
    return ["导购短标题", "短标题", "导购标题"];
  }
  return ["型号规格"];
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

export function resolveSpecTemplateKeywordCandidates(expectedKeyword: string): string[] {
  const normalized = normalizeVisibleText(expectedKeyword);
  if (normalized === "买二送一" || normalized === "买2送1" || normalized === "2送1") {
    return ["买二送一", "买2送1", "2送1"];
  }
  return normalized ? [normalized] : [];
}

export function isMatchingSpecTemplateValue(selectedTemplate: string, expectedKeyword: string): boolean {
  const selected = normalizeVisibleText(selectedTemplate);
  return resolveSpecTemplateKeywordCandidates(expectedKeyword).some((candidate) => selected.includes(candidate));
}

export function isDoudianLoginPageText(value: string): boolean {
  const text = normalizeVisibleText(value);
  return (
    (text.includes("扫码登录") && (text.includes("抖店App") || text.includes("抖店APP"))) ||
    text.includes("打开抖店App扫码登录") ||
    text.includes("切换为手机/邮箱登录") ||
    (
      text.includes("手机登录") &&
      text.includes("邮箱登录") &&
      text.includes("验证码") &&
      text.includes("登录") &&
      (text.includes("用户协议") || text.includes("隐私条款"))
    )
  );
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
  if (
    bodyText.includes("数据异常请刷新重试") ||
    bodyText.includes("数据异常") && bodyText.includes("刷新重试") ||
    bodyText.includes("网络异常") ||
    bodyText.includes("系统繁忙") ||
    bodyText.includes("请稍后重试")
  ) {
    return { action: "wait_or_reload", issue: "Publish create page reported recoverable data/network error." };
  }
  if (input.loading) {
    return { action: "wait_or_reload", issue: "Publish create page is still loading." };
  }
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

export function evaluateBasicInfoGateRecovery(input: BasicInfoGateRecoveryInput): BasicInfoGateRecoveryDecision {
  const expected = new Set(input.expectedFields.filter(Boolean));
  const missing = new Set(input.missingFields.filter(Boolean));
  if (expected.size > 0 && expected.size === missing.size && [...expected].every((field) => missing.has(field))) {
    return {
      action: "reopen_from_platform_spu",
      issue: "All expected basic-info fields disappeared from the publish page."
    };
  }
  return { action: "block", issue: "Basic-info fields are incomplete." };
}

export function evaluateBasicPrefillReadiness(input: BasicPrefillReadinessInput): BasicPrefillReadinessDecision {
  if (input.shortTitleRequired && !input.shortTitleFieldVisible) {
    return {
      action: "reopen_from_platform_spu",
      issue: "Expected short-title field is missing from the SPU-prefilled publish page."
    };
  }
  return { action: "ready", issue: "" };
}

export function evaluatePlatformSpuQueryPageReadiness(input: PlatformSpuQueryPageReadinessInput): PlatformSpuQueryPageReadinessDecision {
  const bodyText = normalizeVisibleText(input.bodyText || "");
  if (isDoudianLoginPageText(bodyText)) {
    return { ready: false, issue: "Doudian login is required before publishing can continue." };
  }
  if (!input.url.includes("/ffa/g/spu-record")) {
    return { ready: false, issue: "Platform SPU query page URL is not active." };
  }
  if (input.accountMenuOpen) {
    return { ready: false, issue: "Top-right account/shop menu is open over the platform SPU page." };
  }
  if (input.loading) {
    return { ready: false, issue: "Platform SPU query page is still loading." };
  }
  if (
    !bodyText.includes("平台标品") ||
    !bodyText.includes("查询") ||
    !bodyText.includes("SPU") ||
    input.visibleInputCount < 2 ||
    !input.brandInputFound ||
    !input.spuInputFound
  ) {
    return { ready: false, issue: "Platform SPU query controls are incomplete." };
  }
  return { ready: true, issue: "" };
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
  if (text.includes("Missingrequiredhealth-foodmetadatafields")) {
    return "health_food_field_missing";
  }
  if (text.includes("食品安全模块未完成") || text.includes("Health-foodfixedfieldmismatch")) {
    return "health_food_food_safety_not_ready";
  }
  if (
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:产地与包装") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:保质期") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:贮存条件") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:生产企业名称") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:生产企业地址") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:净含量") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:产品标准代码") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:配料表") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:上传外包装图") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:商品外包装图")
  ) {
    return "health_food_food_safety_not_ready";
  }
  if (
    text.includes("保健食品类目属性模块未完成") ||
    text.includes("Health-foodfunctionoptionmustexactmatchFeishuvalue") ||
    text.includes("Health-foodfieldrootnotfoundforvisiblelabel:保健功能")
  ) {
    return "health_food_category_attributes_not_ready";
  }
  if (
    text.includes("发货与规格前置模块未完成") ||
    text.includes("Health-foodspecificationreplacementdidnotpassreadback") ||
    text.includes("Health-food商品规格mustexposeexactlyonepopulatedvalueinputingroup规格") ||
    text.includes("Health-foodfullspecificationinputmustbelongtoexactgroup规格") ||
    text.includes("Health-foodfullspecificationreadbackmustexactlymatchFeishuspecification") ||
    text.includes("Health-foodfullspecificationreadbackmismatch")
  ) {
    return "health_food_specification_not_ready";
  }
  if (text.includes("保健食品包装标签模块未完成") || text.includes("Health-foodqualificationimageslotsmissingimages:包装标签图")) {
    return "health_food_packaging_label_not_ready";
  }
  if (
    text.includes("Doudianloginrequired") ||
    text.includes("Doudianloginisrequiredbeforepublishingcancontinue") ||
    isDoudianLoginPageText(text)
  ) {
    return "doudian_login_required";
  }
  if (
    text.includes("Publishcreatepagedidnotbecomeready") ||
    text.includes("PublishcreatepagehasnopublishsectionsafterSPUquery") ||
    text.includes("spu信息填充失败") ||
    text.includes("spu填充失败") ||
    text.includes("信息填充失败")
  ) {
    return "platform_spu_prefill_failed";
  }
  if (text.includes("PlatformSPUquerypagewasnotready") || text.includes("标品管理") && text.includes("加载")) {
    return "platform_page_not_ready";
  }
  if (
    (text.includes("SPUinputvaluemismatchaftertyping") || text.includes("Brandinputvaluemismatchaftertyping")) &&
    text.includes("actual=<empty>")
  ) {
    return "platform_page_not_ready";
  }
  if (text.includes("Failedtoactivatepublishsectiontab") && text.includes("actual=<unknown>")) {
    return "platform_page_not_ready";
  }
  if (text.includes("Allexpectedbasic-infofieldsdisappearedfromthepublishpage")) {
    return "platform_page_not_ready";
  }
  if (
    text.includes("Novisiblefreighttemplateoptionmatchedkeyword") ||
    text.includes("Novisiblefreighttemplatecomboboxmatchedkeyword") ||
    text.includes("Servicesectionfreightlabelisnotvisibleaftertabactivation")
  ) {
    return "service_section_not_ready";
  }
  if (
    text.includes("基础信息模块未完成") ||
    text.includes("Titleinputnotfoundonpublishpage") ||
    text.includes("Shorttitleinputnotfoundonpublishpage") ||
    text.includes("Modelspecinputnotfoundonpublishpage") ||
    text.includes("Basicinfogatefailed")
  ) {
    return "basic_info_field_not_ready";
  }
  if (
    text.includes("Spectemplateselectiondidnotmatchrequiredkeyword") ||
    text.includes("Spectemplatesearchinputwasnotfound") ||
    text.includes("Novisiblespectemplatematchedkeyword") ||
    text.includes("Novisiblespectemplatedropdownoptionmatchedcontrolledaliases") ||
    text.includes("Manualspectemplateentrymodewasnotvisible") ||
    text.includes("Spectemplateentrycontrolwasnotvisible") ||
    text.includes("Spectemplateselectedbutmanualspecvaluesorprice/inventoryrowswerenotvisibleafterswitchingfromsmart-fillmode") ||
    text.includes("Spectemplateleft") && text.includes("blankrequiredspecvalueinput")
  ) {
    return "spec_template_not_ready";
  }
  if (
    text.includes("Price/inventoryverificationfailed") ||
    text.includes("价格库存模块未完成") && text.includes("actualprice") && text.includes("stock")
  ) {
    return "price_inventory_not_ready";
  }
  if (
    text.includes("图文信息模块未完成") &&
    (text.includes("Qualificationdetailuploadwasnotacknowledgedperfile") ||
      text.includes("Detailimagecountdidnotreachexpectedcount"))
  ) {
    return "detail_qualification_not_ready";
  }
  if (text.includes("营养成分表错误") || text.includes("nutritiontable")) {
    return "health_food_nutrition_table_invalid";
  }
  if (
    text.includes("最终发布动作未完成") ||
    text.includes("Publishproductbuttonclickfailed") ||
    text.includes("Publishproductbuttonwasclicked,butnosubmissionsuccesssignalwasdetected")
  ) {
    return "final_publish_state_uncertain";
  }
  if (text.includes("Shopswitchfailed") && text.includes("couldnotfind切换组织/店铺")) {
    return "shop_switch_entry_unavailable";
  }
  if (
    text.includes("contextwaslost") ||
    text.includes("pagecontextwaslost") ||
    text.includes("Executioncontextwasdestroyed") ||
    text.includes("mostlikelybecauseofanavigation") ||
    text.includes("Targetclosed")
  ) {
    return "page_context_lost";
  }
  if (
    text.includes("Remotedebuggingbrowserdidnotbecomeready") ||
    text.includes("connectEPERM127.0.0.1") ||
    text.includes("connectOverCDP") ||
    text.includes("Browser.setDownloadBehavior") ||
    text.includes("Browsercontextmanagementisnotsupported") ||
    text.includes("devtools/browser")
  ) {
    return "browser_remote_debugging_unavailable";
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
  if (text.includes("Spectemplateisnotconfiguredforcurrentshop") || text.includes("规格模板未配置")) {
    return "spec_template_configuration_missing";
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
  const effectiveMaxRetryAttempts =
    errorClass === "platform_page_not_ready"
      ? Math.max(maxRetryAttempts, 4)
      : errorClass === "platform_spu_prefill_failed"
        ? Math.max(maxRetryAttempts, 4)
      : errorClass === "price_inventory_not_ready"
        ? Math.max(maxRetryAttempts, 3)
      : maxRetryAttempts;
  if (retryAttempt >= effectiveMaxRetryAttempts) {
    return false;
  }
  return [
    "platform_page_not_ready",
    "platform_spu_prefill_failed",
    "final_publish_submit_transient",
    "service_section_not_ready",
    "basic_info_field_not_ready",
    "price_inventory_not_ready",
    "page_context_lost",
    "shop_switch_entry_unavailable",
    "browser_remote_debugging_unavailable"
  ].includes(errorClass);
}

export function shouldStopPublishBatchAfterFailure(
  decisions: PublishBatchFailureDecision[],
  consecutiveFailureThreshold = 2
): boolean {
  const singleFailureStopClasses = new Set([
    "price_inventory_not_ready",
    "detail_qualification_not_ready",
    "health_food_field_missing",
    "health_food_food_safety_not_ready",
    "health_food_category_attributes_not_ready",
    "health_food_specification_not_ready",
    "health_food_packaging_label_not_ready",
    "doudian_login_required",
    "shop_context_mismatch",
    "spec_template_configuration_missing",
    "final_publish_state_uncertain"
  ]);
  const systemicClasses = new Set(["spec_template_not_ready", "service_section_not_ready", "basic_info_field_not_ready"]);
  let lastClass = "";
  let consecutiveCount = 0;
  for (const decision of decisions) {
    if (!decision.safelyPublished && singleFailureStopClasses.has(decision.errorClass)) {
      return true;
    }
    if (decision.safelyPublished || !systemicClasses.has(decision.errorClass)) {
      lastClass = "";
      consecutiveCount = 0;
      continue;
    }
    if (decision.errorClass === lastClass) {
      consecutiveCount += 1;
    } else {
      lastClass = decision.errorClass;
      consecutiveCount = 1;
    }
    if (consecutiveCount >= consecutiveFailureThreshold) {
      return true;
    }
  }
  return false;
}

export function evaluatePublishResult(input: PublishResultRuleInput): PublishResultRuleDecision {
  const message = input.message || "";
  const publishIssue = input.publishIssue || "";
  const issueText = publishIssue || message;
  const errorClass = classifyPublishFailure(issueText);
  if (input.ok === true && input.status === "published" && input.publishClicked === true) {
    return {
      safelyPublished: true,
      finalVerifyStatus: "publish_signal_confirmed",
      errorClass: "",
      issue: ""
    };
  }
  if (input.publishClickAttempted === true && !publishIssue && input.status === "published") {
    return {
      safelyPublished: false,
      finalVerifyStatus: "submit_accepted_unconfirmed",
      errorClass: "final_publish_state_uncertain",
      issue: message || "Publish button click was accepted, but no submission success signal was observed."
    };
  }
  if (input.publishClickAttempted === true && errorClass === "final_publish_state_uncertain") {
    return {
      safelyPublished: false,
      finalVerifyStatus: "submit_accepted_unconfirmed",
      errorClass,
      issue: publishIssue || message || "Publish button click was accepted, but no submission success signal was observed."
    };
  }
  if (input.publishClickAttempted === true && publishIssue) {
    return {
      safelyPublished: false,
      finalVerifyStatus: "needs_manual_review",
      errorClass,
      issue: publishIssue || message || "Publish result did not include a safe success signal."
    };
  }
  return {
    safelyPublished: false,
    finalVerifyStatus: "not_checked",
    errorClass,
    issue: publishIssue || message || "Publish result did not include a safe success signal."
  };
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
  baselineDetailCount: number;
  qualificationImageCount: number;
  acknowledgedQualificationCount: number;
  finalDetailCount: number;
  expectedDetailCount: number;
}): PublishRuleCheck {
  if (!input.filledFromMain) {
    return { passed: false, issue: "Detail section was not filled from main images before qualification upload." };
  }
  if (input.qualificationImageCount <= 0) {
    return { passed: false, issue: "No Feishu qualification images were available for detail section." };
  }
  if (input.acknowledgedQualificationCount !== input.qualificationImageCount) {
    return {
      passed: false,
      issue: `Qualification detail upload was not acknowledged per file. expected=${input.qualificationImageCount}; acknowledged=${input.acknowledgedQualificationCount}; baseline=${input.baselineDetailCount}; final=${input.finalDetailCount}`
    };
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

export function evaluateDetailUploadOutcome(input: DetailUploadOutcomeRuleInput): PublishRuleCheck {
  if (input.detailRule.passed) {
    return { passed: true, issue: "" };
  }
  return input.detailRule;
}

export function evaluateMedicalDeviceCertificateUploadRule(
  input: MedicalDeviceCertificateUploadRuleInput
): MedicalDeviceCertificateUploadRuleDecision {
  const productCategory = normalizeVisibleText(input.productCategory || "");
  if (productCategory && !productCategory.includes("医疗器械")) {
    return { action: "not_required", issue: "" };
  }
  const categoryText = normalizeVisibleText(input.categoryText);
  if (!productCategory && !categoryText.includes("医疗器械")) {
    return { action: "not_required", issue: "" };
  }
  if (input.selectedCertificateCount > 0) {
    return { action: "leave_existing_certificate", issue: "" };
  }
  if (input.qualificationImageCount <= 0) {
    return {
      action: "blocked_missing_qualification_image",
      issue: "Medical device certificate slot is empty but no Feishu qualification image is available."
    };
  }
  return { action: "upload_first_qualification_image", issue: "" };
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

export function evaluateShippingBeforePriceInventoryCompletion(
  input: ShippingBeforePriceInventoryRuleInput
): PublishRuleCheck {
  const missingFields = [
    input.shippingModeSelected ? "" : "shippingMode",
    input.shippingTimeSelected ? "" : "shippingTime"
  ].filter(Boolean);
  if (missingFields.length > 0) {
    return {
      passed: false,
      issue: `Missing price-inventory precondition fields: ${missingFields.join(", ")}`
    };
  }
  return { passed: true, issue: "" };
}

export function evaluateSpecTemplateCompletion(input: SpecTemplateCompletionRuleInput): PublishRuleCheck {
  const expectedTemplateKeyword = (input.expectedTemplateKeyword || "").trim();
  const selectedTemplate = (input.selectedTemplate || "").trim();
  if (expectedTemplateKeyword && selectedTemplate && !isMatchingSpecTemplateValue(selectedTemplate, expectedTemplateKeyword)) {
    return {
      passed: false,
      issue: `Spec template selection did not match required keyword. expectedKeyword=${expectedTemplateKeyword}; selectedTemplate=${
        selectedTemplate || "<empty>"
      }`
    };
  }
  if (expectedTemplateKeyword && isMatchingSpecTemplateValue(selectedTemplate, expectedTemplateKeyword)) {
    return { passed: true, issue: "" };
  }
  if (input.priceRows >= input.expectedSpecValues) {
    return { passed: true, issue: "" };
  }
  if (input.filledSpecValues >= input.expectedSpecValues) {
    return { passed: true, issue: "" };
  }
  return {
    passed: false,
    issue: `Spec values were incomplete after template apply. expected=${input.expectedSpecValues}; actual=${input.filledSpecValues}; priceRows=${input.priceRows}`
  };
}

export function evaluatePriceInventoryEntryRule(input: PriceInventoryEntryRuleInput): PriceInventoryEntryRuleDecision {
  if (input.specIssue) {
    return {
      action: "block_until_spec_template_complete",
      issue: input.specIssue
    };
  }
  return { action: "apply_price_inventory", issue: "" };
}

export function resolvePriceInventoryRowInputRoles(
  candidates: PriceInventoryRowInputCandidate[]
): PriceInventoryRowInputRoles | undefined {
  const editable = candidates
    .map((candidate, index) => ({ ...candidate, index }))
    .filter((candidate) => {
      const text = `${candidate.placeholder} ${candidate.context}`.replace(/\s+/g, " ").trim();
      return !/erp编码|商家编码/i.test(text) && !/规格值|请输入规格值/i.test(text);
    })
    .sort((a, b) => a.centerX - b.centerX);

  const stock = editable.find((candidate) => /库存/.test(`${candidate.placeholder} ${candidate.context}`));
  const price = editable.find((candidate) => candidate.index !== stock?.index);
  if (!price || !stock) {
    return undefined;
  }
  return {
    priceIndex: price.index,
    stockIndex: stock.index
  };
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

export function evaluateServiceFulfillmentCompletion(input: ServiceFulfillmentState): PublishRuleCheck {
  const missingFields = [
    input.shippingModeSelected ? "" : "shippingMode",
    input.shippingTimeSelected ? "" : "shippingTime",
    input.productStatusSelected ? "" : "productStatus",
    input.freightTemplateName ? "" : "freightTemplate"
  ].filter(Boolean);
  return evaluateServiceCompletion({
    freightTemplateName: input.freightTemplateName,
    missingFields
  });
}

export function resolvePublishCheckBlockingFields(input: {
  blockingFields: string[];
  completedFields: string[];
  filledPriceRows: number;
  freightTemplateName: string;
}): string[] {
  const completedFieldSet = new Set(input.completedFields);
  return input.blockingFields.filter((field) => {
    if (
      OPTIONAL_GRAPHIC_SECTIONS_ARE_OUTSIDE_PUBLISH_FLOW &&
      (field === "白底图" || field === "主图3:4" || field.includes("白底图") || field.includes("3:4"))
    ) {
      return false;
    }
    if (field === "型号规格" && completedFieldSet.has("modelSpec")) {
      return false;
    }
    if ((field === "价格" || field === "现货库存") && input.filledPriceRows > 0) {
      return false;
    }
    if (field === "运费模板" && input.freightTemplateName) {
      return false;
    }
    if (field === "医疗器械注册证" && completedFieldSet.has("medicalDeviceCertificate")) {
      return false;
    }
    return true;
  });
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

export function resolveHealthFoodPublishRules(input: HealthFoodPublishRuleInput): HealthFoodRuleDecision {
  return evaluateHealthFoodPublishRules(input);
}
