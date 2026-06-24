import type { Page } from "playwright";
import type { ProductCategoryContext, PublishModuleSnapshot, SubmitActionDeps } from "./types.js";

export async function runSubmitAction(
  deps: SubmitActionDeps,
  input: {
    page: Page;
    runtimeDir: string;
    stopBeforePublish: boolean;
    categoryContext: ProductCategoryContext;
    filledFields: string[];
    configuredFields: string[];
    filledPriceRows: number;
    freightTemplateName: string;
    uploadIssue: string;
    specIssue: string;
    priceIssue: string;
  }
): Promise<
  PublishModuleSnapshot & {
    pageUrl: string;
    pageTitle: string;
    checkPassed: boolean;
    checkMessage: string;
    checkHints: string[];
    blockingFields: string[];
    publishClicked: boolean;
    publishClickAttempted: boolean;
    publishIssue: string;
    sections: string[];
    topActions: string[];
    errorHints: string[];
  }
> {
  const screenshotFiles: string[] = [];
  const stages: PublishModuleSnapshot["stages"] = [];
  let checkPassed = false;
  let checkMessage = "";
  let checkHints: string[] = [];
  let blockingFields: string[] = [];
  let publishClicked = false;
  let publishClickAttempted = false;
  let publishIssue = "";

  if (input.categoryContext.productCategory === "保健食品") {
    checkPassed = true;
    checkMessage = "Health-food packaging label upload matched Feishu qualification image count; submit without fill-check gating.";
    checkHints = [];
    blockingFields = [];
  } else {
    const checkResult = await deps.runPublishCheckOnPage(input.page, input.runtimeDir, "publish-page-fill-check.png");
    screenshotFiles.push(checkResult.screenshotFile);
    checkPassed = checkResult.checkPassed;
    checkMessage = checkResult.checkMessage;
    checkHints = checkResult.checkHints;
    blockingFields = checkResult.blockingFields;
    blockingFields = deps.resolvePublishCheckBlockingFields({
      blockingFields,
      completedFields: [...input.filledFields, ...input.configuredFields],
      filledPriceRows: input.filledPriceRows,
      freightTemplateName: input.freightTemplateName
    });
    if (!blockingFields.length && !input.uploadIssue && !input.specIssue && !input.priceIssue) {
      checkPassed = true;
      checkMessage = "Publish check indicates the page is ready to submit.";
    }
    let specIssue = input.specIssue;
    if (checkPassed && !blockingFields.length && specIssue) {
      specIssue = "";
    }
    const publishCheckRule = deps.evaluatePublishCheckResult({
      checkPassed,
      blockingFields,
      uploadIssue: input.uploadIssue,
      specIssue,
      priceIssue: input.priceIssue
    });
    if (!publishCheckRule.passed) {
      stages.push({ step: "run_publish_check", status: "failed" });
      throw new Error(`Sequential publish flow stopped: 模块校验未通过。${checkMessage} ${publishCheckRule.issue}`);
    }
    stages.push({ step: "run_publish_check", status: "completed" });
  }

  if (!input.stopBeforePublish) {
    const publishResult = await deps.clickPublishProductOnPage(input.page, input.runtimeDir, "publish-page-published.png");
    if (publishResult.screenshotFile) {
      screenshotFiles.push(publishResult.screenshotFile);
    }
    publishClicked = publishResult.publishClicked;
    publishClickAttempted = publishResult.publishClickAttempted;
    publishIssue = publishResult.publishIssue;
    if (!publishClicked || publishIssue) {
      if (!publishClickAttempted) {
        stages.push({ step: "click_publish_product", status: "failed" });
        throw new Error(`Sequential publish flow stopped: 最终发布动作未完成。${publishIssue}`);
      }
      stages.push({ step: "click_publish_product", status: "completed" });
      stages.push({ step: "verify_publish_result", status: "failed" });
    } else {
      stages.push({ step: "click_publish_product", status: "completed" });
    }
  } else {
    const stopScreenshot = await deps.savePageScreenshot(input.page, input.runtimeDir, "publish-page-ready-before-submit.png");
    screenshotFiles.push(stopScreenshot);
    stages.push({ step: "ready_before_publish", status: "completed" });
  }

  const inspectResult =
    publishClickAttempted && !publishClicked
      ? {
          pageUrl: input.page.url(),
          pageTitle: await input.page.title().catch(() => ""),
          screenshotFile: "",
          sections: [] as string[],
          topActions: [] as string[],
          errorHints: publishIssue ? [publishIssue] : []
        }
      : await deps.inspectPublishPageOnPage(input.page, input.runtimeDir, "publish-page-inspect.png");
  if (inspectResult.screenshotFile) {
    screenshotFiles.push(inspectResult.screenshotFile);
  }
  stages.push({
    step: "inspect_publish_page",
    status: publishClickAttempted && !publishClicked ? "failed" : "completed"
  });

  return {
    page: input.page,
    screenshotFiles,
    stages,
    pageUrl: inspectResult.pageUrl,
    pageTitle: inspectResult.pageTitle,
    checkPassed,
    checkMessage,
    checkHints,
    blockingFields,
    publishClicked,
    publishClickAttempted,
    publishIssue,
    sections: inspectResult.sections,
    topActions: inspectResult.topActions,
    errorHints: inspectResult.errorHints
  };
}
