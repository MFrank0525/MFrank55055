import type { Page } from "playwright";
import type { ProductAssets } from "../types.js";
import type { ProductCategoryContext, PublishModuleSnapshot, ServiceActionDeps } from "./types.js";

export async function runServiceAction(
  deps: ServiceActionDeps,
  input: {
    page: Page;
    runtimeDir: string;
    metadata: { spu: string };
    categoryContext: ProductCategoryContext;
    assets: ProductAssets;
    filledFields: string[];
  }
): Promise<
  PublishModuleSnapshot & {
    configuredFields: string[];
    freightTemplateName: string;
  }
> {
  const screenshotFiles: string[] = [];
  const stages: PublishModuleSnapshot["stages"] = [];
  const configuredFields: string[] = [];

  try {
    await deps.assertBasicPublishCompletionOnPage(input.page, input.runtimeDir, input.categoryContext.basicMetadata, "before_service_module");
  } catch {
    if (
      input.categoryContext.basicMetadata.title ||
      input.categoryContext.basicMetadata.shortTitle ||
      input.categoryContext.basicMetadata.modelSpec
    ) {
      const refillResult = await deps.fillBasicPublishPageOnPage(
        input.page,
        input.runtimeDir,
        input.categoryContext.basicMetadata,
        "publish-page-basic-refilled-before-service.png",
        undefined,
        input.categoryContext.basicInfoGuardUnexpectedFieldChanges
      );
      screenshotFiles.push(refillResult.screenshotFile);
      input.filledFields.length = 0;
      input.filledFields.push(...refillResult.filledFields);
    }
    await deps.assertBasicPublishCompletionOnPage(input.page, input.runtimeDir, input.categoryContext.basicMetadata, "before_service_module");
  }

  const settingsResult = await deps.applyFixedPublishSettingsOnPage(
    input.page,
    input.runtimeDir,
    "publish-page-fixed-settings.png",
    input.categoryContext.productCategory === "保健食品" ? undefined : input.metadata.spu
  );
  screenshotFiles.push(settingsResult.screenshotFile);
  configuredFields.push(...settingsResult.configuredFields);
  const freightTemplateName = settingsResult.freightTemplateName;
  const serviceRule = deps.evaluateServiceFulfillmentCompletion(settingsResult.serviceState);
  if (!serviceRule.passed) {
    stages.push({ step: "apply_fixed_publish_settings", status: "failed" });
    throw new Error(`Sequential publish flow stopped: 服务与履约模块未完成。${serviceRule.issue}`);
  }
  stages.push({ step: "apply_fixed_publish_settings", status: "completed" });

  if (input.categoryContext.productCategory === "保健食品") {
    const packagingLabelResult = await deps.uploadHealthFoodPackagingLabelOnPage(input.page, input.assets.detailImages);
    if (!packagingLabelResult.ok) {
      stages.push({ step: "upload_health_food_packaging_label", status: "failed" });
      throw new Error("Sequential publish flow stopped: 保健食品包装标签模块未完成。");
    }
    configuredFields.push("healthFoodPackagingLabel");
    stages.push({ step: "upload_health_food_packaging_label", status: "completed" });
  }

  if (input.categoryContext.productCategory === "医疗器械") {
    const medicalCertificateResult = await deps.ensureMedicalDeviceCertificateFromFirstQualification(
      input.page,
      input.runtimeDir,
      input.assets
    );
    if (medicalCertificateResult.screenshotFile) {
      screenshotFiles.push(medicalCertificateResult.screenshotFile);
    }
    if (!medicalCertificateResult.completed) {
      stages.push({ step: "apply_medical_device_certificate", status: "failed" });
      throw new Error(`Sequential publish flow stopped: 其他信息模块未完成。${medicalCertificateResult.issue}`);
    }
    if (medicalCertificateResult.configuredField) {
      configuredFields.push(medicalCertificateResult.configuredField);
    }
    stages.push({ step: "apply_medical_device_certificate", status: "completed" });
  }

  return { page: input.page, screenshotFiles, stages, configuredFields, freightTemplateName };
}
