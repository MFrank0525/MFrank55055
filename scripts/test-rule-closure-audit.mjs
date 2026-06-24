import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

const docs = [
  read("docs/auto-listing/steps/10-publish.md"),
  read("docs/auto-listing/steps/11-cleanup.md"),
  read("docs/PUBLISH_FLOW_SOP.md"),
  read("docs/auto-listing/stability-checklist.md")
].join("\n");
const publishSource = [
  "src/business/publish-from-spu.ts",
  "src/business/publish-from-spu/basic-info-page-action.ts",
  "src/business/publish-from-spu/spec-service-page-action.ts",
  "src/business/publish-from-spu/service-fulfillment-page-action.ts",
  "src/business/publish-from-spu/graphic-file-input-action.ts",
  "src/business/publish-from-spu/graphic-section-preview-action.ts",
  "src/business/publish-from-spu/graphic-upload-page-action.ts",
  "src/business/publish-from-spu/publish-submit-page-action.ts",
  "src/business/publish-from-spu/publish-flow.ts",
  "src/business/publish-from-spu/job.ts"
].map(read).join("\n");
const publishRulesSource = read("src/business/publish-from-spu/publish-rules.ts");
const publishConstantsSource = read("src/business/publish-from-spu/constants.ts");
const orchestratorSource = read("src/autolist/orchestrator.ts");
const feishuProductsSource = read("src/autolist/feishu-products.ts");
const progressTestSource = read("scripts/test-progress-state.mjs");
const specTestSource = read("scripts/test-spec-template-rule.mjs");
const moduleTestSource = read("scripts/test-publish-module-sequence-rule.mjs");

const closures = [
  {
    name: "3:4 and white-background slots are outside the project publish flow",
    docs: ["主图3:4", "白底图", "不上传", "不清空", "不阻塞"],
    rules: ["OPTIONAL_GRAPHIC_SECTIONS_ARE_OUTSIDE_PUBLISH_FLOW = true"],
    actions: ["optionalGraphicSectionsIgnored"],
    tests: ["the obsolete forbidden-section constant must be deleted"]
  },
  {
    name: "spec template follows template and does not edit blank spec-value placeholders",
    docs: ["价格库存已生成 4 行", "空白 `请输入规格值`", "不得填写", "不得删除"],
    rules: ["evaluateSpecTemplateCompletion", "input.priceRows >= input.expectedSpecValues"],
    actions: ["applySpecTemplateWithVerificationOnPage", "countVisibleBlankSpecValueInputs"],
    tests: ["template-generated price rows are the authoritative signal", "blank placeholder spec-value inputs must not be filled or deleted"]
  },
  {
    name: "detail images use final expected count instead of repeating qualification uploads",
    docs: ["商品详情图最终数量必须刚好等于", "禁止因为页面计数延迟而整批重复上传"],
    rules: ["evaluateDetailImageCompletion", "evaluateDetailUploadOutcome"],
    actions: ["ensureDetailImagesFromMainThenQualifications"],
    tests: ["evaluateDetailImageCompletion", "evaluateDetailUploadOutcome"]
  },
  {
    name: "medical-device certificate is verified as its own publish rule",
    docs: ["医疗器械注册证", "已有填充物不覆盖"],
    rules: ["evaluateMedicalDeviceCertificateUploadRule"],
    actions: ["ensureMedicalDeviceCertificateFromFirstQualification"],
    tests: ["evaluateMedicalDeviceCertificateUploadRule"]
  },
  {
    name: "publish page readiness treats platform/network failures as retryable gates",
    docs: ["数据异常请刷新重试", "发布页因网络抖动"],
    rules: ["evaluatePublishCreatePageReadiness", "classifyPublishFailure"],
    actions: ["waitForPublishCreatePageReady"],
    tests: ["evaluatePublishCreatePageReadiness"]
  },
  {
    name: "same-batch continuation ignores cleaned assets for already processed Feishu rows",
    docs: ["processedImageManifest", "已处理行的白底图和资质图允许被清理删除", "不能阻塞后续未处理记录"],
    rules: ["resolvePendingFeishuProductSourceImagesFromRecords", "processedImages"],
    actions: ["readProcessedImages", "resolvePendingFeishuProductSourceImagesFromRecords"],
    tests: ["pendingFeishuSourceImages", "white background image was missing"]
  }
];

for (const closure of closures) {
  for (const marker of closure.docs) {
    assert.match(docs, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${closure.name}: missing doc marker ${marker}`);
  }
  for (const marker of closure.rules) {
    assert.match(
      publishRulesSource + publishConstantsSource + publishSource + orchestratorSource + feishuProductsSource,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${closure.name}: missing rule marker ${marker}`
    );
  }
  for (const marker of closure.actions) {
    assert.match(
      publishSource + orchestratorSource + feishuProductsSource,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${closure.name}: missing action marker ${marker}`
    );
  }
  for (const marker of closure.tests) {
    assert.match(
      progressTestSource + specTestSource + moduleTestSource + read("scripts/test-detail-upload-outcome-rule.mjs") + read("scripts/test-medical-device-certificate-rule.mjs") + read("scripts/test-publish-create-page-readiness-rule.mjs"),
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${closure.name}: missing test marker ${marker}`
    );
  }
}

assert.doesNotMatch(
  docs,
  /必须同时确认商品规格编辑区已读回 4 个模板规格值/,
  "spec template docs must not require spec-value readback when price rows prove the template expanded"
);

assert.doesNotMatch(
  publishRulesSource,
  /blankSpecValueInputs\s*>\s*0[\s\S]{0,240}Spec template left/,
  "spec template rule code must not contradict the manual by blocking on blank placeholder spec-value inputs"
);

assert.doesNotMatch(
  specTestSource,
  /Spec template left \d+ blank required spec value input\(s\)/,
  "spec template tests must not preserve obsolete blank-placeholder blocking expectations"
);

console.log("rule closure audit passed");
