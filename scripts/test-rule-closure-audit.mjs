import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

const docs = [
  read("docs/auto-listing/steps/10-publish.md"),
  read("docs/PUBLISH_FLOW_SOP.md"),
  read("docs/auto-listing/stability-checklist.md")
].join("\n");
const publishSource = read("src/business/publish-from-spu.ts");
const publishRulesSource = read("src/business/publish-from-spu/publish-rules.ts");
const progressTestSource = read("scripts/test-progress-state.mjs");
const specTestSource = read("scripts/test-spec-template-rule.mjs");
const moduleTestSource = read("scripts/test-publish-module-sequence-rule.mjs");

const closures = [
  {
    name: "3:4 and white-background slots are forbidden optional graphic sections",
    docs: ["3:4 主图", "白底图", "清空"],
    rules: ["evaluateForbiddenGraphicSections", "FORBIDDEN_GRAPHIC_SECTION_LABELS"],
    actions: ["enforceForbiddenGraphicSectionsEmpty", "repairForbiddenGraphicSectionsBeforePublish"],
    tests: ["clickSmartCropForMain34Section", "uploadMissingMain34ImagesToSection", "shanchu"]
  },
  {
    name: "spec template follows template and does not edit blank spec-value placeholders",
    docs: ["价格库存已生成 4 行", "空白 `请输入规格值`", "不得填写"],
    rules: ["evaluateSpecTemplateCompletion", "input.priceRows >= input.expectedSpecValues"],
    actions: ["applySpecTemplateWithVerificationOnPage", "removeBlankSpecValueInputsFromTemplate"],
    tests: ["template-generated price rows are the authoritative signal", "blank placeholder spec inputs must not block"]
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
  }
];

for (const closure of closures) {
  for (const marker of closure.docs) {
    assert.match(docs, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${closure.name}: missing doc marker ${marker}`);
  }
  for (const marker of closure.rules) {
    assert.match(
      publishRulesSource + publishSource,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${closure.name}: missing rule marker ${marker}`
    );
  }
  for (const marker of closure.actions) {
    assert.match(publishSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${closure.name}: missing action marker ${marker}`);
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

console.log("rule closure audit passed");
