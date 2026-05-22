export interface PublishPageSnapshot {
  url: string;
  bodyText: string;
}

export interface PublishSubmissionRuleResult {
  submitted: boolean;
  issue: string;
  freshCreatePage: boolean;
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

export function isFreshPublishCreatePage(snapshot: PublishPageSnapshot): boolean {
  const bodyText = normalizeVisibleText(snapshot.bodyText);
  return (
    snapshot.url.includes("/ffa/g/create") &&
    bodyText.includes("商品发布") &&
    bodyText.includes("上传主图") &&
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
