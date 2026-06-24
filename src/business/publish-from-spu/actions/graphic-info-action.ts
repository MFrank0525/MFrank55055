import type { Page } from "playwright";
import type { ProductAssets } from "../types.js";
import type { BasicPublishMetadata, GraphicInfoActionDeps, PublishModuleSnapshot } from "./types.js";

export async function runGraphicInfoAction(
  deps: GraphicInfoActionDeps,
  input: {
    page: Page;
    runtimeDir: string;
    createPageUrl: string;
    basicMetadata: BasicPublishMetadata;
    assets: ProductAssets;
    graphicResetAttempt: number;
    specAttempt: number;
    logWarn: (message: string) => void;
    failurePrefix?: string;
  }
): Promise<
  PublishModuleSnapshot & {
    uploadedGroups: string[];
    uploadIssue: string;
  }
> {
  const screenshotFiles: string[] = [];
  const stages: PublishModuleSnapshot["stages"] = [];
  const failurePrefix = input.failurePrefix || "Sequential publish flow stopped";

  await deps.waitForPublishCreatePageReady(input.page, input.runtimeDir, input.createPageUrl, `publish-before-images-${input.specAttempt + 1}`);
  await deps.assertBasicPublishCompletionOnPage(input.page, input.runtimeDir, input.basicMetadata, "before_graphic_module");

  let imageResult = await deps.uploadProductImagesOnPage(input.page, input.runtimeDir, input.assets, "publish-page-images-uploaded.png");
  screenshotFiles.push(imageResult.screenshotFile);
  let uploadedGroups = imageResult.uploadedGroups;
  let uploadIssue = imageResult.uploadIssue;

  if (uploadIssue || !deps.graphicUploadGroupsComplete(uploadedGroups)) {
    if (input.graphicResetAttempt < 1) {
      input.logWarn(
        `Graphic module did not reach a clean completed state; resetting the current graphic module before retry. issue=${uploadIssue || "Main/white-background/detail image groups were not uploaded successfully."}`
      );
      await deps.waitForPublishCreatePageReady(input.page, input.runtimeDir, input.createPageUrl, "publish-before-graphic-reset");
      screenshotFiles.push(
        await deps.resetGraphicModuleOnPage(input.page, input.runtimeDir, "publish-page-graphic-module-reset-before-retry.png")
      );
      stages.push({ step: "reset_graphic_module_after_upload_failure", status: "completed" });
      imageResult = await deps.uploadProductImagesOnPage(
        input.page,
        input.runtimeDir,
        input.assets,
        "publish-page-images-uploaded-after-reset.png"
      );
      screenshotFiles.push(imageResult.screenshotFile);
      uploadedGroups = imageResult.uploadedGroups;
      uploadIssue = imageResult.uploadIssue;
    }
  }

  if (uploadIssue || !deps.graphicUploadGroupsComplete(uploadedGroups)) {
    stages.push({ step: "upload_product_images", status: "failed" });
    throw new Error(
      `${failurePrefix}: 图文信息模块未完成。${uploadIssue || "Main/white-background/detail image groups were not uploaded successfully."}`
    );
  }
  if (input.specAttempt === 0) {
    stages.push({ step: "upload_product_images", status: "completed" });
  }

  return {
    page: input.page,
    screenshotFiles,
    stages,
    uploadedGroups,
    uploadIssue
  };
}
