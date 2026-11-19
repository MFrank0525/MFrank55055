import type { Locator, Page } from "playwright";
import type { ProductCategory } from "../../autolist/product-category.js";
import { logInfo } from "../../utils/logger.js";
import { clickLocatorWithTransientUiRecovery } from "./browser-session.js";
import { isKnownCategoryModificationPublishPrompt } from "./publish-rules.js";

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export class CategoryAdviceRecoveredError extends Error {
  constructor(public readonly originalCategory: string) {
    super(`Category advice recovered to the original category; current form fields must be rebuilt: ${originalCategory}`);
    this.name = "CategoryAdviceRecoveredError";
  }
}

export class MedicalDeviceSpuReboundError extends Error {
  constructor(public readonly expectedSpu: string) {
    super(`Medical-device category advice recovered through the original category and registration SPU: ${expectedSpu}`);
    this.name = "MedicalDeviceSpuReboundError";
  }
}

export function isCategoryAdviceFormRebuildRequiredError(
  error: unknown
): error is CategoryAdviceRecoveredError | MedicalDeviceSpuReboundError {
  return error instanceof CategoryAdviceRecoveredError || error instanceof MedicalDeviceSpuReboundError;
}

type CategoryAdviceRecoveryContext = {
  productCategory: ProductCategory;
  spu: string;
  title: string;
};

const categoryAdviceRecoveryContexts = new WeakMap<Page, CategoryAdviceRecoveryContext>();

export function configureCategoryAdviceRecoveryForPage(
  page: Page,
  context: CategoryAdviceRecoveryContext
): void {
  categoryAdviceRecoveryContexts.set(page, context);
}

async function rebindMedicalDeviceRegistrationSpuOnTransitionPage(
  page: Page,
  expectedSpu: string,
  expectedTitle: string,
  originalCategory: string,
  expectedStandardProductId: string
): Promise<void> {
  const standardProductSearch = page
    .locator('input[placeholder*="请输入品牌、医疗器械备案/注册号等搜索标品"]')
    .filter({ visible: true });
  await standardProductSearch.first().waitFor({ state: "visible", timeout: 15000 });
  if ((await standardProductSearch.count()) !== 1) {
    throw new Error(`Medical-device standard-product search was not unique: count=${await standardProductSearch.count()}`);
  }
  await standardProductSearch.fill("");
  await standardProductSearch.pressSequentially(expectedSpu, { delay: 120, timeout: 10000 });

  const expectedCategoryCompact = originalCategory.replace(/[\s>]/g, "");
  const cards = page.locator("[class*='style_card__']").filter({ visible: true });
  let exactCard: Locator | null = null;
  for (let attempt = 0; attempt < 30 && !exactCard; attempt += 1) {
    const matches: Locator[] = [];
    for (let index = 0; index < await cards.count(); index += 1) {
      const card = cards.nth(index);
      const text = normalize(await card.innerText().catch(() => ""));
      if (
        text.includes(expectedSpu) &&
        text.includes(expectedStandardProductId) &&
        text.replace(/[\s>]/g, "").includes(expectedCategoryCompact)
      ) {
        matches.push(card);
      }
    }
    if (matches.length > 1) {
      throw new Error(
        `Original medical-device standard product was ambiguous: ` +
        `spu=${expectedSpu}; standardProductId=${expectedStandardProductId}; count=${matches.length}`
      );
    }
    exactCard = matches[0] || null;
    if (!exactCard) await page.waitForTimeout(500);
  }
  if (!exactCard) {
    throw new Error(
      `Original medical-device standard product was unavailable: ` +
      `spu=${expectedSpu}; standardProductId=${expectedStandardProductId}; category=${originalCategory}`
    );
  }
  await clickLocatorWithTransientUiRecovery(exactCard, 5000);

  // Doudian can require an explicit replacement confirmation when the selected
  // card differs from its current transient selection. The same-card path applies
  // immediately and renders no confirmation, so only skip this click when the
  // registration readback below proves the original product is already active.
  const replaceDialog = page
    .locator("[role='dialog'].ecom-g-modal-wrap")
    .filter({ visible: true })
    .filter({ hasText: "已存在标品提示" })
    .filter({ hasText: expectedSpu })
    .filter({ hasText: expectedStandardProductId });
  await replaceDialog.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const replaceButton = replaceDialog.getByRole("button", { name: "替换", exact: true }).filter({ visible: true });
  const replaceCount = await replaceButton.count();
  if (replaceCount > 1) {
    throw new Error(`Medical-device standard-product replacement confirmation was ambiguous: count=${replaceCount}`);
  }
  if (replaceCount === 1) {
    await clickLocatorWithTransientUiRecovery(replaceButton.first(), 5000);
  }
  await page.waitForTimeout(1000);

  const fieldRoot = page.locator("[attr-field-id='医疗器械备案/注册号']").filter({ visible: true });
  await fieldRoot.first().waitFor({ state: "visible", timeout: 15000 });
  if ((await fieldRoot.count()) !== 1) {
    throw new Error(`Medical-device registration field was not unique on the transition page: count=${await fieldRoot.count()}`);
  }
  const input = fieldRoot.locator("input:not([disabled]):not([readonly])").filter({ visible: true });
  if ((await input.count()) !== 1) {
    throw new Error(`Medical-device registration input was not uniquely editable on the transition page: count=${await input.count()}`);
  }
  const registrationReadback = await input.inputValue({ timeout: 3000 }).catch(() => "");
  if (normalize(registrationReadback) !== normalize(expectedSpu)) {
    throw new Error(`Medical-device registration SPU readback mismatch: expected=${expectedSpu}; actual=${registrationReadback || "<empty>"}`);
  }
  const titleInput = page
    .locator("[attr-field-id='商品标题']")
    .filter({ visible: true })
    .locator("input:not([type='checkbox']):not([disabled]), textarea:not([disabled])")
    .filter({ visible: true });
  if ((await titleInput.count()) === 1) {
    const titleReadback = await titleInput.inputValue({ timeout: 3000 }).catch(() => "");
    if (titleReadback !== expectedTitle) {
      throw new Error("Medical-device transition-page recovery changed the product title unexpectedly.");
    }
  }
}

async function selectOriginalMedicalDeviceCategoryOnTransitionPage(
  page: Page,
  originalCategory: string
): Promise<void> {
  const expected = normalize(originalCategory);
  const markerName = "data-hermes-original-medical-category";
  const markerValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const matchCount = await page.evaluate(
      ({ expectedCategory, expectedCategoryCompact, attributeName, attributeValue }) => {
        const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();
        const visible = (element: Element): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const bodyText = normalizeText(document.body?.innerText || "");
        if (!bodyText.includes("请选择以下类目") || !bodyText.includes("选择标品")) return 0;
        const selectedOriginal = Array.from(
          document.querySelectorAll("[class*='selectedNotInRecommend'] [class*='itemSelected']")
        ).filter(
          (element) =>
            visible(element) &&
            normalizeText((element as HTMLElement).innerText || "").replace(/[\s>]/g, "") ===
              expectedCategoryCompact
        );
        if (selectedOriginal.length === 1) return -1;
        if (selectedOriginal.length > 1) return -2;
        document.querySelectorAll(`[${attributeName}]`).forEach((element) => element.removeAttribute(attributeName));
        const exactVisible = Array.from(document.body.querySelectorAll("*")).filter(
          (element) => visible(element) && normalizeText((element as HTMLElement).innerText || "") === expectedCategory
        );
        const leafMatches = exactVisible.filter(
          (candidate) => !exactVisible.some((other) => other !== candidate && candidate.contains(other))
        );
        leafMatches.forEach((element) => element.setAttribute(attributeName, attributeValue));
        return leafMatches.length;
      },
      {
        expectedCategory: expected,
        expectedCategoryCompact: expected.replace(/[\s>]/g, ""),
        attributeName: markerName,
        attributeValue: markerValue,
      }
    );
    if (matchCount === -1) return;
    if (matchCount === -2) {
      throw new Error(`Selected original medical-device category was ambiguous: ${originalCategory}`);
    }
    if (matchCount === 1) {
      await clickLocatorWithTransientUiRecovery(page.locator(`[${markerName}="${markerValue}"]`), 5000);
      return;
    }
    if (matchCount > 1) {
      throw new Error(`Original medical-device category was ambiguous on the transition page: ${originalCategory}`);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Original medical-device category was unavailable on the transition page: ${originalCategory}`);
}

async function clickEnabledCategoryRecoveryNext(page: Page): Promise<void> {
  const nextButton = await uniqueVisibleButton(page, "下一步");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await nextButton.isEnabled().catch(() => false)) {
      await clickLocatorWithTransientUiRecovery(nextButton, 5000);
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Category recovery next-step button did not become enabled after restoring the original category.");
}

async function readUniqueVisibleCategoryField(page: Page): Promise<{ category: string }> {
  const fields = page.locator("[attr-field-id='商品类目']").filter({ visible: true });
  const count = await fields.count();
  if (count !== 1) {
    throw new Error(`Category field must be uniquely visible while recovering category advice: count=${count}`);
  }
  const locator = fields.first();
  const text = normalize(await locator.innerText());
  const match = text.match(/^商品类目\s+(.+?)\s+修改(?:\s|$)/);
  if (!match?.[1]) {
    throw new Error(`Current category could not be read while recovering category advice: text=${text}`);
  }
  return { category: match[1].trim() };
}

async function uniqueVisibleButton(container: Locator | Page, name: string | RegExp): Promise<Locator> {
  const buttons = container.getByRole("button", { name, exact: true }).filter({ visible: true });
  await buttons.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  const count = await buttons.count();
  if (count !== 1) {
    throw new Error(`Category recovery button was not unique: name=${String(name)}; count=${count}`);
  }
  return buttons.first();
}

async function settleRepeatedCategoryAdviceDialogs(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const dialogs = page.locator("[role='dialog'].ecom-g-modal-wrap").filter({ visible: true });
    const count = await dialogs.count();
    if (count === 0) return;

    let repeatedAdviceHandled = false;
    for (let index = 0; index < count; index += 1) {
      const dialog = dialogs.nth(index);
      const text = await dialog.innerText().catch(() => "");
      const visibleActions = await dialog
        .locator("button, [role='button']")
        .filter({ visible: true })
        .allInnerTexts()
        .catch(() => [] as string[]);
      if (!isKnownCategoryModificationPublishPrompt({ text, visibleActions })) continue;
      await clickLocatorWithTransientUiRecovery(await uniqueVisibleButton(dialog, "确认修改"), 5000);
      await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      repeatedAdviceHandled = true;
      break;
    }
    await page.waitForTimeout(repeatedAdviceHandled ? 500 : 400);
  }

  const remaining = page.locator("[role='dialog'].ecom-g-modal-wrap").filter({ visible: true });
  const summaries = await remaining.allInnerTexts().catch(() => [] as string[]);
  throw new Error(
    `Category-advice recovery remained blocked by a visible dialog: ` +
    summaries.map((value) => normalize(value).slice(0, 200)).join(" | ")
  );
}

async function selectOriginalCategoryInApplication(dialog: Locator, originalCategory: string): Promise<void> {
  const segments = originalCategory.split(/\s*>\s*/).map((item) => item.trim()).filter(Boolean);
  if (segments.length < 2) {
    throw new Error(`Original category path is incomplete: ${originalCategory}`);
  }
  const tree = dialog.locator("[class*='treeSelectContent']").first();
  await tree.waitFor({ state: "visible", timeout: 10000 });
  for (const segment of segments) {
    const labels = tree.getByText(segment, { exact: true }).filter({ visible: true });
    await labels.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const labelCount = await labels.count();
    if (labelCount !== 1) {
      throw new Error(
        `Original category segment was unavailable or ambiguous in category application: ` +
        `segment=${segment}; count=${labelCount}; category=${originalCategory}`
      );
    }
    const item = labels.first().locator("xpath=ancestor::div[contains(@class,'style_catItem')][1]");
    if ((await item.count()) !== 1) {
      throw new Error(`Original category item root was not unique: segment=${segment}; category=${originalCategory}`);
    }
    await clickLocatorWithTransientUiRecovery(item, 5000);
    await dialog.page().waitForTimeout(500);
    const itemClass = await item.getAttribute("class");
    if (!String(itemClass).includes("style_selected")) {
      throw new Error(`Original category segment did not reach selected state: segment=${segment}; category=${originalCategory}`);
    }
  }
}

async function cancelExistingStandardProductMismatchIfPresent(
  page: Page,
  expectedSpu: string,
  expectedStandardProductId: string,
  originalCategory: string
): Promise<void> {
  const dialog = page
    .locator("[role='dialog'].ecom-g-modal-wrap")
    .filter({ visible: true })
    .filter({ hasText: "已存在标品提示" });
  await dialog.first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  if ((await dialog.count()) === 0) return;
  if ((await dialog.count()) !== 1) {
    throw new Error(`Existing-standard-product prompt was ambiguous: count=${await dialog.count()}`);
  }
  const text = normalize(await dialog.innerText());
  if (
    !text.includes(expectedSpu) ||
    !text.includes(expectedStandardProductId) ||
    !text.replace(/[\s>]/g, "").includes(originalCategory.replace(/[\s>]/g, ""))
  ) {
    throw new Error(`Existing-standard-product prompt did not identify the exact original product: ${text}`);
  }
  await clickLocatorWithTransientUiRecovery(await uniqueVisibleButton(dialog, "取消"), 5000);
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
}

async function applyOriginalCategoryOnTransitionPage(page: Page, originalCategory: string): Promise<void> {
  await clickLocatorWithTransientUiRecovery(
    await uniqueVisibleButton(page, /^(?:发起申请|再次申请)$/),
    5000
  );
  const applicationDialog = page
    .locator("[role='dialog'].ecom-g-modal-wrap")
    .filter({ visible: true })
    .filter({ hasText: "类目申请" });
  await applicationDialog.waitFor({ state: "visible", timeout: 10000 });
  if ((await applicationDialog.count()) !== 1) {
    throw new Error(`Medical-device category application dialog was not unique: count=${await applicationDialog.count()}`);
  }
  await selectOriginalCategoryInApplication(applicationDialog, originalCategory);
  await clickLocatorWithTransientUiRecovery(await uniqueVisibleButton(applicationDialog, "申请"), 5000);

  const reviewConfirm = page
    .locator("[role='dialog'].ecom-g-modal-wrap")
    .filter({ visible: true })
    .filter({ hasText: "申请类目需经平台审核" });
  let settled = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await reviewConfirm.first().isVisible().catch(() => false)) {
      if ((await reviewConfirm.count()) !== 1) {
        throw new Error(`Medical-device category review confirmation was ambiguous: count=${await reviewConfirm.count()}`);
      }
      await clickLocatorWithTransientUiRecovery(await uniqueVisibleButton(reviewConfirm, "确认"), 5000);
      await reviewConfirm.waitFor({ state: "hidden", timeout: 10000 });
      await applicationDialog.waitFor({ state: "hidden", timeout: 10000 });
      settled = true;
      break;
    }
    if (!(await applicationDialog.first().isVisible().catch(() => false))) {
      settled = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!settled) {
    throw new Error("Medical-device original-category application did not settle.");
  }
}

export async function resolveCategoryAdviceOverlaySafely(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  const dialogs = page.locator("[role='dialog'].ecom-g-modal-wrap").filter({ visible: true });
  const matches: Locator[] = [];
  for (let index = 0; index < await dialogs.count(); index += 1) {
    const dialog = dialogs.nth(index);
    const text = await dialog.innerText().catch(() => "");
    const visibleActions = await dialog.locator("button, [role='button']").filter({ visible: true }).allInnerTexts().catch(() => [] as string[]);
    if (isKnownCategoryModificationPublishPrompt({ text, visibleActions })) {
      matches.push(dialog);
    }
  }
  if (!matches.length) return false;
  if (matches.length !== 1) {
    throw new Error(`Category-advice overlay was ambiguous: visible=${matches.length}`);
  }

  const adviceDialog = matches[0]!;
  const originalCategory = (await readUniqueVisibleCategoryField(page)).category;
  const recoveryContext = categoryAdviceRecoveryContexts.get(page);
  if (recoveryContext?.productCategory === "医疗器械") {
    const originalStandardProductId = new URL(page.url()).searchParams.get("spu_id") || "";
    if (!originalStandardProductId) {
      throw new Error("Original medical-device standard-product ID was unavailable in the create-page URL.");
    }
    await clickLocatorWithTransientUiRecovery(await uniqueVisibleButton(adviceDialog, "去查看其他类目选项"), 5000);
    await adviceDialog.waitFor({ state: "hidden", timeout: 10000 });
    await cancelExistingStandardProductMismatchIfPresent(
      page,
      recoveryContext.spu,
      originalStandardProductId,
      originalCategory
    );
    await applyOriginalCategoryOnTransitionPage(page, originalCategory);
    await rebindMedicalDeviceRegistrationSpuOnTransitionPage(
      page,
      recoveryContext.spu,
      recoveryContext.title,
      originalCategory,
      originalStandardProductId
    );
    await selectOriginalMedicalDeviceCategoryOnTransitionPage(page, originalCategory);
    await clickEnabledCategoryRecoveryNext(page);
    const restoredField = page.locator("[attr-field-id='商品类目']").filter({ visible: true });
    await restoredField.waitFor({ state: "visible", timeout: 15000 });
    const restoredCategory = (await readUniqueVisibleCategoryField(page)).category;
    if (normalize(restoredCategory) !== normalize(originalCategory)) {
      throw new Error(`Medical-device category recovery mismatch: expected=${originalCategory}; actual=${restoredCategory}`);
    }
    const restoredTitle = await page
      .locator("[attr-field-id='商品标题']")
      .filter({ visible: true })
      .locator("input:not([type='checkbox']):not([disabled]), textarea:not([disabled])")
      .filter({ visible: true })
      .inputValue({ timeout: 3000 });
    if (restoredTitle !== recoveryContext.title) {
      throw new Error("Medical-device category recovery changed the product title unexpectedly.");
    }
    logInfo(
      `medical-device category recommendation cancelled through other-category options; original category and SPU restored: ` +
      `${originalCategory}; spu=${recoveryContext.spu}`
    );
    throw new MedicalDeviceSpuReboundError(recoveryContext.spu);
  }

  await clickLocatorWithTransientUiRecovery(await uniqueVisibleButton(adviceDialog, "确认修改"), 5000);
  await adviceDialog.waitFor({ state: "hidden", timeout: 10000 });
  await settleRepeatedCategoryAdviceDialogs(page);

  const categoryField = page.locator("[attr-field-id='商品类目']").filter({ visible: true });
  if ((await categoryField.count()) !== 1) {
    throw new Error(`Category field was not unique after accepting the recommendation: count=${await categoryField.count()}`);
  }
  const modifyActions = categoryField.first().getByText("修改", { exact: true }).filter({ visible: true });
  if ((await modifyActions.count()) !== 1) {
    throw new Error(`Category field modify action was not unique: count=${await modifyActions.count()}`);
  }
  await clickLocatorWithTransientUiRecovery(modifyActions.first(), 5000);

  const modifyConfirm = page
    .locator("[role='dialog'].ecom-g-modal-wrap")
    .filter({ visible: true })
    .filter({ hasText: "修改类目可能会导致部分内容丢失" });
  await modifyConfirm.waitFor({ state: "visible", timeout: 10000 });
  if ((await modifyConfirm.count()) !== 1) {
    throw new Error(`Modify-category confirmation was not unique: count=${await modifyConfirm.count()}`);
  }
  await clickLocatorWithTransientUiRecovery(await uniqueVisibleButton(modifyConfirm, "修改类目"), 5000);
  await modifyConfirm.waitFor({ state: "hidden", timeout: 10000 });

  await clickLocatorWithTransientUiRecovery(
    await uniqueVisibleButton(page, /^(?:发起申请|再次申请)$/),
    5000
  );
  const applicationDialog = page
    .locator("[role='dialog'].ecom-g-modal-wrap")
    .filter({ visible: true })
    .filter({ hasText: "类目申请" });
  await applicationDialog.waitFor({ state: "visible", timeout: 10000 });
  if ((await applicationDialog.count()) !== 1) {
    throw new Error(`Category application dialog was not unique: count=${await applicationDialog.count()}`);
  }
  await selectOriginalCategoryInApplication(applicationDialog, originalCategory);
  await clickLocatorWithTransientUiRecovery(await uniqueVisibleButton(applicationDialog, "申请"), 5000);

  const reviewConfirm = page
    .locator("[role='dialog'].ecom-g-modal-wrap")
    .filter({ visible: true })
    .filter({ hasText: "申请类目需经平台审核" });
  let applicationSettled = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await reviewConfirm.first().isVisible().catch(() => false)) {
      if ((await reviewConfirm.count()) !== 1) {
        throw new Error(`Category application review confirmation was not unique: count=${await reviewConfirm.count()}`);
      }
      await clickLocatorWithTransientUiRecovery(await uniqueVisibleButton(reviewConfirm, "确认"), 5000);
      await reviewConfirm.waitFor({ state: "hidden", timeout: 10000 });
      await applicationDialog.waitFor({ state: "hidden", timeout: 10000 });
      applicationSettled = true;
      break;
    }
    if (!(await applicationDialog.first().isVisible().catch(() => false))) {
      applicationSettled = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!applicationSettled) {
    throw new Error("Category application neither requested review confirmation nor closed after submission.");
  }

  await clickEnabledCategoryRecoveryNext(page);
  const restoredField = page.locator("[attr-field-id='商品类目']").filter({ visible: true });
  await restoredField.waitFor({ state: "visible", timeout: 15000 });
  const restoredCategory = (await readUniqueVisibleCategoryField(page)).category;
  if (normalize(restoredCategory) !== normalize(originalCategory)) {
    throw new Error(`Category recovery readback mismatch: expected=${originalCategory}; actual=${restoredCategory}`);
  }
  logInfo(`category advice recovered through category application with the original category: ${originalCategory}`);
  throw new CategoryAdviceRecoveredError(originalCategory);
}
