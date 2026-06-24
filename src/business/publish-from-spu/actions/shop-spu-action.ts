import type { BrowserContext, Page } from "playwright";
import {
  closeCreatePagesExcept,
  reuseOrOpenCreatePage
} from "../browser-session.js";
import { queryPlatformSpu } from "../platform-spu-query-action.js";
import { waitForPublishCreatePageReady } from "../publish-page-readiness.js";
import { ensureShopContext } from "../shop-switch-action.js";
import type { ResolvedPublishFromSpuMetadata } from "../types.js";
import type { PublishFlowCommonState, ShopSpuActionDeps } from "./types.js";

export function createDefaultShopSpuActionDeps(): ShopSpuActionDeps {
  return {
    queryPlatformSpu,
    reuseOrOpenCreatePage: (context, createPageUrl, currentPage) =>
      reuseOrOpenCreatePage(context as BrowserContext, createPageUrl, currentPage),
    waitForPublishCreatePageReady,
    ensureShopContext,
    closeCreatePagesExcept: (context, keepPages) =>
      closeCreatePagesExcept(context as BrowserContext, keepPages)
  };
}

export async function runShopSpuAction(
  deps: ShopSpuActionDeps,
  input: {
    context: unknown;
    runtimeDir: string;
    metadata: ResolvedPublishFromSpuMetadata;
    shopFolder: string;
    publishPageUrl?: string;
  }
): Promise<PublishFlowCommonState> {
  const screenshotFiles: string[] = [];
  const stages: PublishFlowCommonState["stages"] = [];
  let createPageUrl = input.publishPageUrl || "";
  let matchedRowText = "";
  let shopVerifiedBeforeCreatePage = false;

  if (!createPageUrl) {
    const queryResult = await deps.queryPlatformSpu(input.runtimeDir, input.metadata.brand, input.metadata.spu, input.shopFolder);
    screenshotFiles.push(queryResult.screenshotFile);
    createPageUrl = queryResult.createPageUrl;
    matchedRowText = queryResult.matchedRowText;
    shopVerifiedBeforeCreatePage = Boolean(input.shopFolder);
    stages.push({ step: "query_platform_spu", status: "completed" });
  }

  const page: Page = await deps.reuseOrOpenCreatePage(input.context, createPageUrl);
  await deps.waitForPublishCreatePageReady(page, input.runtimeDir, createPageUrl, "publish-initial");
  if (!shopVerifiedBeforeCreatePage) {
    await deps.ensureShopContext(page, input.runtimeDir, input.shopFolder);
  }

  return {
    page,
    createPageUrl,
    matchedRowText,
    shopVerifiedBeforeCreatePage,
    screenshotFiles,
    stages
  };
}
