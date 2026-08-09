import type { Page } from "playwright";
import { dismissTransientOverlays } from "./dom-actions.js";
import {
  clearDetailImagePreviewsStrict,
  clearGraphicSectionPreviewsStrict,
  countDetailImagePreviews,
  countMainImagePreviews
} from "./graphic-section-preview-action.js";

export async function clearMainImagePrefillAndConfirmEmpty(page: Page): Promise<number> {
  const existingCount = await countMainImagePreviews(page);
  if (existingCount > 0) {
    await clearGraphicSectionPreviewsStrict(page, "主图", Math.max(10, existingCount + 3));
    await page.waitForTimeout(800);
    await dismissTransientOverlays(page);
  }
  const remainingCount = await countMainImagePreviews(page);
  if (remainingCount !== 0) {
    throw new Error(`Main image prefill clear was not confirmed by DOM readback. remaining=${remainingCount}`);
  }
  return existingCount;
}

export async function clearDetailPrefillAndConfirmEmpty(page: Page): Promise<number> {
  const existingCount = await countDetailImagePreviews(page);
  if (existingCount > 0) {
    await clearDetailImagePreviewsStrict(page, Math.max(12, existingCount + 3));
    await page.waitForTimeout(800);
    await dismissTransientOverlays(page);
  }
  const remainingCount = await countDetailImagePreviews(page);
  if (remainingCount !== 0) {
    throw new Error(`Detail image prefill clear was not confirmed by DOM readback. remaining=${remainingCount}`);
  }
  return existingCount;
}
