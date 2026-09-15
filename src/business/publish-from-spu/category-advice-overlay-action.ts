import type { Locator, Page } from "playwright";
import { logInfo } from "../../utils/logger.js";
import { isKnownCategoryModificationPublishPrompt } from "./publish-rules.js";

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function readUniqueVisibleCategoryField(page: Page): Promise<{ category: string }> {
  const fields = page.locator("[attr-field-id='商品类目']").filter({ visible: true });
  const count = await fields.count();
  if (count !== 1) {
    throw new Error(`Category field must be uniquely visible while dismissing category advice: count=${count}`);
  }
  const locator = fields.first();
  const text = normalize(await locator.innerText());
  const match = text.match(/^商品类目\s+(.+?)\s+修改(?:\s|$)/);
  if (!match?.[1]) {
    throw new Error(`Current category could not be read before dismissing category advice: text=${text}`);
  }
  return { category: match[1].trim() };
}

export async function dismissCategoryAdviceOverlayWithoutMutation(page: Page): Promise<boolean> {
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

  const dialog = matches[0]!;
  const actions = (await dialog.locator("button, [role='button']").filter({ visible: true }).allInnerTexts())
    .map(normalize);
  if (!actions.includes("去查看其他类目选项") || !actions.includes("确认修改")) {
    return false;
  }
  const beforeCategory = await readUniqueVisibleCategoryField(page);
  const otherCategoryActions = dialog
    .getByRole("button", { name: "去查看其他类目选项", exact: true })
    .filter({ visible: true });
  if ((await otherCategoryActions.count()) !== 1) {
    throw new Error(`Safe category-advice review action was not unique: count=${await otherCategoryActions.count()}`);
  }
  await otherCategoryActions.first().click({ timeout: 3000 });
  await dialog.waitFor({ state: "hidden", timeout: 3000 });

  const originalOptions = page.getByText(beforeCategory.category, { exact: true }).filter({ visible: true });
  await originalOptions.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if ((await originalOptions.count()) !== 1) {
    throw new Error(`Original category option was not unique after opening category choices: count=${await originalOptions.count()}; category=${beforeCategory.category}`);
  }
  const originalOption = originalOptions.first();
  await originalOption.click({ timeout: 3000 });
  const optionRoot = originalOption.locator("xpath=ancestor::div[contains(@class,'styles_normal')][1]");
  const optionClass = await optionRoot.getAttribute("class");
  if ((await optionRoot.count()) !== 1 || !String(optionClass).includes("itemSelected")) {
    throw new Error(`Original category was not selected after category advice: category=${beforeCategory.category}`);
  }
  logInfo(`early category advice acknowledged by reselecting the unchanged category: ${beforeCategory.category}`);
  throw new Error("Early category advice acknowledged with the original category; fresh SPU page restart required.");
}
