import assert from "node:assert/strict";
import fs from "node:fs";

const resetSource = fs.readFileSync("src/business/publish-from-spu/graphic-prefill-clear-action.ts", "utf8");
const uploadSource = fs.readFileSync("src/business/publish-from-spu/graphic-upload-page-action.ts", "utf8");
const previewActionSource = fs.readFileSync("src/business/publish-from-spu/graphic-section-preview-action.ts", "utf8");
const publishRulesSource = fs.readFileSync("src/business/publish-from-spu/publish-rules.ts", "utf8");
const categoryAdviceOverlaySource = fs.readFileSync(
  "src/business/publish-from-spu/category-advice-overlay-action.ts",
  "utf8"
);
const publishFlowSource = fs.readFileSync(
  "src/business/publish-from-spu/publish-flow.ts",
  "utf8"
);

assert.match(
  resetSource,
  /clearMainImagePrefillAndConfirmEmpty[\s\S]*clearMainImagePreviewsStrict[\s\S]*countMainImagePreviews[\s\S]*remainingCount !== 0[\s\S]*throw new Error/,
  "main-image prefill clear must fail closed unless DOM readback reaches zero"
);
assert.match(
  previewActionSource,
  /clearMainImagePreviewsStrict[\s\S]*beforeCount = await countMainImagePreviews[\s\S]*clickLastGraphicSectionPreviewDeleteByDom\(page, "主图"\)[\s\S]*waitForMainImagePreviewCountDecrease/,
  "main-image clearing must use the same exact field-root counter before and after every deletion"
);
assert.match(
  resetSource,
  /clearDetailPrefillAndConfirmEmpty[\s\S]*clearDetailImagePreviewsStrict[\s\S]*countDetailImagePreviews[\s\S]*remainingCount !== 0[\s\S]*throw new Error/,
  "detail prefill clear must fail closed unless DOM readback reaches zero"
);
assert.match(
  uploadSource,
  /clearMainImagePrefillAndConfirmEmpty\(page\)[\s\S]*uploadMainImagesToSection/,
  "main images must be uploaded only after strict prefill clearing"
);
assert.match(
  previewActionSource,
  /clearMainImagePreviewsStrict[\s\S]*clickLastGraphicSectionPreviewDeleteByDom\(page, "主图"\)[\s\S]*resolveCategoryAdviceOverlaySafely\(page\)[\s\S]*waitForMainImagePreviewCountDecrease/,
  "category advice triggered by deleting a prefilled main image must be handled at the exact post-delete boundary"
);
assert.match(
  uploadSource,
  /clearDetailPrefillAndConfirmEmpty\(page\)[\s\S]*clickFillFromMainForDetailSection[\s\S]*uploadDetailImagesByInputCapability/,
  "detail sequence must be clear, confirm empty, fill from main, then upload Feishu qualifications"
);
assert.doesNotMatch(
  uploadSource,
  /clear(?:GraphicSection|DetailImage)PreviewsStrict\([^;]+\)\.catch\(\(\) => 0\)/,
  "required main/detail prefill clearing must not swallow failures"
);
assert.match(
  previewActionSource,
  /clickLastMainImagePreviewDeleteControl[\s\S]*resolveExactMainImageFieldRoot[\s\S]*\.material-preview-button[\s\S]*\.last\(\)[\s\S]*\.hover\([\s\S]*use\[href='#icon-shanchu'\][\s\S]*actionAfter[\s\S]*clickLocatorWithTransientUiRecovery\(deleteIcon/,
  "main-image prefill clearing must hover the exact last preview and click the unique SVG delete target"
);
assert.match(
  resetSource,
  /clearMainImagePrefillAndConfirmEmpty[\s\S]*resolveExactMainImageFieldRoot[\s\S]*throw new Error/,
  "main-image clearing must not treat a missing field root as an already-empty section"
);
assert.match(
  previewActionSource,
  /sectionName === "主图"[\s\S]*clickLastMainImagePreviewDeleteControl/,
  "generic graphic clearing must route main images through the exact field action"
);
assert.match(
  previewActionSource,
  /clickLastDetailImagePreviewDeleteControl[\s\S]*attr-field-id='商品详情'[\s\S]*detailDeleteControlSelector[\s\S]*aria-roledescription='sortable'[\s\S]*\.hover\([\s\S]*clickLocatorWithTransientUiRecovery\(deleteControl/,
  "detail prefill clearing must scope to the exact detail field and click its current delete control"
);
assert.doesNotMatch(
  previewActionSource.slice(
    previewActionSource.indexOf("async function clickLastDetailImagePreviewDeleteControl"),
    previewActionSource.indexOf("export async function clickLastGraphicSectionPreviewDeleteByDom")
  ),
  /deleteControls[\s\S]*\.isVisible\(/,
  "the unique detail delete control must not be discarded before hover merely because Doudian initially hides it"
);
assert.match(
  previewActionSource,
  /clickLastDetailImagePreviewDeleteControl[\s\S]*sortableItem\.hover\(\{ timeout: 3000 \}\)\.catch\(\(\) => \{\}\)[\s\S]*clickLocatorWithTransientUiRecovery\(deleteControl/,
  "detail deletion must continue to the unique DOM control even when Doudian never stabilizes the hover animation"
);
assert.match(
  previewActionSource,
  /detailDeleteControlSelector[\s\S]*aria-label\*='删除'[\s\S]*title\*='删除'[\s\S]*clickLastDetailImagePreviewDeleteControl/,
  "detail clearing must recognize semantic delete controls instead of depending on one platform icon class"
);
assert.doesNotMatch(
  previewActionSource,
  /clearDetailImagePreviewsStrict[\s\S]*getGraphicSectionPreviewRectsStrict[\s\S]*if \(!previews\.length\) \{\s*break;/,
  "exact detail-field deletion must not be blocked by heuristic preview rectangles"
);
assert.match(
  previewActionSource,
  /clearDetailImagePreviewsStrict[\s\S]*waitForDetailPreviewCountDecrease\(page, beforeCount/,
  "detail deletion must wait for a bounded DOM count decrease instead of relying on a fixed delay"
);
assert.match(
  previewActionSource,
  /sectionName === "商品详情" \|\| sectionName === "详情页"[\s\S]*clickLastDetailImagePreviewDeleteControl/,
  "generic graphic clearing must route both detail section labels through the exact field action"
);
assert.match(
  publishRulesSource,
  /DetailimageprefillclearwasnotconfirmedbyDOMreadback[\s\S]*transient_overlay_blocked/,
  "A failed detail-prefill clear before final submit must enter bounded safe recovery instead of unknown-submit failure"
);
assert.match(
  resetSource,
  /resolveCategoryAdviceOverlaySafely\(page\)[\s\S]*clearDetailImagePreviewsStrict/,
  "Detail-prefill clearing must dismiss an early category-advice overlay before it can block the delete control"
);
assert.match(
  categoryAdviceOverlaySource,
  /readUniqueVisibleCategoryField[\s\S]*"确认修改"[\s\S]*"修改"[\s\S]*修改类目可能会导致部分内容丢失[\s\S]*"修改类目"[\s\S]*发起申请\|再次申请/,
  "category recovery must follow the observed confirm-modify and category-application entry sequence"
);
assert.match(
  categoryAdviceOverlaySource,
  /uniqueVisibleButton[\s\S]*waitFor\(\{ state: "visible", timeout: 10000 \}\)[\s\S]*buttons\.count\(\)/,
  "each category-recovery control must wait for asynchronous rendering before enforcing uniqueness"
);
assert.match(
  categoryAdviceOverlaySource,
  /originalCategory\.split[\s\S]*treeSelectContent[\s\S]*getByText\(segment, \{ exact: true \}\)[\s\S]*waitFor\(\{ state: "visible", timeout: 10000 \}\)[\s\S]*style_catItem[\s\S]*style_selected/,
  "category application must wait for and select every exact segment of the original category path, then verify selected state"
);
assert.match(
  categoryAdviceOverlaySource,
  /uniqueVisibleButton\(applicationDialog, "申请"\)[\s\S]*申请类目需经平台审核[\s\S]*if \(await reviewConfirm\.first\(\)\.isVisible[\s\S]*uniqueVisibleButton\(reviewConfirm, "确认"\)[\s\S]*if \(!\(await applicationDialog\.first\(\)\.isVisible[\s\S]*applicationSettled[\s\S]*clickEnabledCategoryRecoveryNext\(page\)[\s\S]*Category recovery readback mismatch[\s\S]*CategoryAdviceRecoveredError/,
  "category application must support both first-time review confirmation and direct repeat-application settlement, then verify the original category and signal a form rebuild"
);
assert.doesNotMatch(categoryAdviceOverlaySource, /same-family|isSameProductFamilyCategory/);
assert.match(
  publishFlowSource,
  /resolveCategoryAdviceOverlaySafely\(page\)[\s\S]*isCategoryAdviceFormRebuildRequiredError\(error\)[\s\S]*basicResult = await runCurrentBasicInfoAction\(\)[\s\S]*graphicResult = await runCurrentGraphicAction\(\)/,
  "restoring the original category must rebuild cleared category-dependent fields before retrying graphic upload"
);
assert.match(
  publishFlowSource,
  /isCategoryAdviceFormRebuildRequiredError\(error\) && !finalSubmitStarted[\s\S]*samePageCategoryRebuildAttempt >= 2[\s\S]*Same-page category form rebuild exhausted[\s\S]*runPublishFlow\([\s\S]*shopFolder,[\s\S]*createPageUrl,[\s\S]*nextAttempt/,
  "late category recovery must rebuild on the same create-page URL with a bounded retry budget"
);
assert.doesNotMatch(
  publishFlowSource.slice(
    publishFlowSource.indexOf("isCategoryAdviceFormRebuildRequiredError(error) && !finalSubmitStarted"),
    publishFlowSource.indexOf("} finally", publishFlowSource.indexOf("isCategoryAdviceFormRebuildRequiredError(error) && !finalSubmitStarted"))
  ),
  /shopFolder,[\s\S]*undefined,[\s\S]*stopBeforePublish/,
  "late category recovery must never return to SPU query by dropping the current create-page URL"
);
assert.match(
  categoryAdviceOverlaySource,
  /settleRepeatedCategoryAdviceDialogs[\s\S]*isKnownCategoryModificationPublishPrompt[\s\S]*确认修改[\s\S]*await settleRepeatedCategoryAdviceDialogs\(page\)/,
  "health-food category recovery must settle a repeated copy of the known prompt"
);
assert.match(
  categoryAdviceOverlaySource,
  /recoveryContext\?\.productCategory === "医疗器械"[\s\S]*uniqueVisibleButton\(adviceDialog, "去查看其他类目选项"\)[\s\S]*cancelExistingStandardProductMismatchIfPresent[\s\S]*applyOriginalCategoryOnTransitionPage\(page, originalCategory\)[\s\S]*rebindMedicalDeviceRegistrationSpuOnTransitionPage\([\s\S]*recoveryContext\.spu,[\s\S]*recoveryContext\.title,[\s\S]*originalCategory,[\s\S]*originalStandardProductId[\s\S]*selectOriginalMedicalDeviceCategoryOnTransitionPage\(page, originalCategory\)[\s\S]*clickEnabledCategoryRecoveryNext\(page\)[\s\S]*Medical-device category recovery mismatch[\s\S]*restoredTitle !== recoveryContext\.title[\s\S]*MedicalDeviceSpuReboundError/,
  "medical-device category advice must cancel the recommendation, restore the original category and SPU, and preserve title"
);
const medicalRecoveryBranch = categoryAdviceOverlaySource.slice(
  categoryAdviceOverlaySource.indexOf('recoveryContext?.productCategory === "医疗器械"'),
  categoryAdviceOverlaySource.indexOf('uniqueVisibleButton(adviceDialog, "确认修改")', categoryAdviceOverlaySource.indexOf('recoveryContext?.productCategory === "医疗器械"'))
);
assert.doesNotMatch(
  medicalRecoveryBranch,
  /确认修改/,
  "medical-device recommendation cancellation must never accept the recommended category"
);
assert.match(
  medicalRecoveryBranch,
  /applyOriginalCategoryOnTransitionPage[\s\S]*rebindMedicalDeviceRegistrationSpuOnTransitionPage/,
  "medical-device recovery must reapply the original category before matching and replacing the original standard product"
);
assert.match(
  categoryAdviceOverlaySource,
  /rebindMedicalDeviceRegistrationSpuOnTransitionPage[\s\S]*请输入品牌、医疗器械备案\/注册号等搜索标品[\s\S]*pressSequentially\(expectedSpu[\s\S]*expectedStandardProductId[\s\S]*originalCategory[\s\S]*name: "替换"[\s\S]*registrationReadback/,
  "medical-device SPU must be restored through the exact original standard-product card and replacement confirmation"
);
assert.match(
  categoryAdviceOverlaySource,
  /selectedNotInRecommend[\s\S]*itemSelected[\s\S]*expectedCategoryCompact[\s\S]*if \(matchCount === -1\) return/,
  "an already-selected original category on the transition page must be accepted without choosing a recommendation"
);
assert.match(
  publishFlowSource,
  /configureCategoryAdviceRecoveryForPage\(page,[\s\S]*productCategory,[\s\S]*spu: metadata\.spu,[\s\S]*title: metadata\.title/,
  "publish flow must provide the exact SPU and title for transition-page recovery"
);
assert.match(
  uploadSource,
  /preserveExistingMainImages[\s\S]*existingMainPreviewCount === assets\.mainImages\.length[\s\S]*uploadedGroups\.push\("mainImages"\)/,
  "Category-advice recovery must preserve main images only after exact DOM-count readback"
);
console.log("graphic prefill clear rule passed");
