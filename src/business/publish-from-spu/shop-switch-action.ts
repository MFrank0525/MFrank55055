import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { logInfo, logWarn } from "../../utils/logger.js";
import { PLATFORM_SPU_URL } from "./constants.js";
import {
  gotoWithTolerance,
  isNavigationContextDestroyedError,
  savePageScreenshot
} from "./browser-session.js";
import { normalizeShopName, resolveExpectedShopName } from "./shop-name.js";
import {
  evaluateShopSwitchMenuState,
  evaluateShopTargetSelectionState,
  isDoudianLoginPageText,
  isExpectedShopContext
} from "./publish-rules.js";

async function evaluateAfterNavigationSettles<T>(
  page: Page,
  operation: () => Promise<T>,
  attempts = 5
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isNavigationContextDestroyedError(error) || attempt === attempts - 1) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(450 + attempt * 250);
    }
  }
  throw lastError;
}

async function detectCurrentShopName(page: Page): Promise<string> {
  return evaluateAfterNavigationSettles(page, () => page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
    const candidates = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.top > 180 ||
          rect.left < window.innerWidth * 0.68 ||
          !/(旗舰店|专营店|专卖店|店铺)/.test(text)
        ) {
          return null;
        }
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        const score =
          (marker.includes("header") ? 30 : 0) +
          (marker.includes("dropdown") ? 25 : 0) +
          (marker.includes("avatar") ? 20 : 0) +
          (marker.includes("user") ? 20 : 0) +
          (rect.top < 100 ? 15 : 0) -
          text.length / 4;
        return { text, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return candidates[0]?.text || "";
  }));
}

async function readCurrentShopNameFromMenu(page: Page): Promise<string> {
  return evaluateAfterNavigationSettles(page, () => page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
    const menus = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        return (
          text.includes("切换组织/店铺") &&
          text.includes("退出") &&
          rect.width > 180 &&
          rect.height > 200 &&
          rect.top < 180 &&
          rect.left > window.innerWidth * 0.72 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.left - bRect.left || aRect.top - bRect.top;
      });

    const menu = menus[0];
    if (!menu) {
      return "";
    }

    const candidates = Array.from(menu.querySelectorAll("*"))
      .map((node) => node as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          !/(旗舰店|专营店|专卖店|店铺)/.test(text) ||
          (!text.includes("延草纲目") && text.length < 8) ||
          text.includes("切换组织/店铺") ||
          text.includes("店铺信息") ||
          text.includes("登录账号") ||
          text.includes("子账号") ||
          text.includes("退出") ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        const score = (rect.top < menu.getBoundingClientRect().top + 80 ? 60 : 0) - text.length / 4 - rect.top / 100;
        return { text, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    return candidates[0]?.text || "";
  }));
}

async function isDoudianLoginRequired(page: Page): Promise<boolean> {
  return evaluateAfterNavigationSettles(page, () => page.evaluate(() => {
    return document.body.innerText || "";
  })).then((text) => isDoudianLoginPageText(text));
}

async function confirmDoudianLoginRequired(page: Page): Promise<boolean> {
  if (!(await isDoudianLoginRequired(page))) {
    return false;
  }
  await gotoWithTolerance(page, PLATFORM_SPU_URL, 5000).catch(() => {});
  await page.waitForTimeout(1500);
  return isDoudianLoginRequired(page);
}

async function dismissKnownShopSwitchInformationalOverlay(page: Page): Promise<boolean> {
  const overlayMarkers = ["平台已为您开通", "优质快递服务", "平台智能透标模式"];
  const visibleRoots = page
    .locator("body div")
    .filter({ hasText: overlayMarkers[0] })
    .filter({ hasText: overlayMarkers[1] })
    .filter({ hasText: overlayMarkers[2] })
    .filter({ visible: true });
  const rootCount = await visibleRoots.count().catch(() => 0);
  if (rootCount === 0) {
    return false;
  }

  const matchingRoots: Array<{ root: Locator; textLength: number }> = [];
  for (let index = 0; index < rootCount; index += 1) {
    const candidate = visibleRoots.nth(index);
    const text = await candidate.innerText().catch(() => "");
    const normalized = text.replace(/\s+/g, "").trim();
    if (overlayMarkers.every((marker) => normalized.includes(marker))) {
      matchingRoots.push({ root: candidate, textLength: normalized.length });
    }
  }
  matchingRoots.sort((left, right) => left.textLength - right.textLength);
  let closeControl: Locator | undefined;
  for (const { root } of matchingRoots) {
    const controls = root
      .locator("button, [role='button'], [aria-label], [title], [class*='close' i]")
      .filter({ visible: true });
    const matchingControls: Locator[] = [];
    for (let index = 0; index < (await controls.count().catch(() => 0)); index += 1) {
      const control = controls.nth(index);
      const signature = await control.evaluate((element) => [
        (element as HTMLElement).innerText || element.textContent || "",
        element.getAttribute("aria-label") || "",
        element.getAttribute("title") || "",
        String((element as HTMLElement).className || "")
      ].join(" ").replace(/\s+/g, "").toLowerCase()).catch(() => "");
      if (/关闭|close|(^|[^a-z])x([^a-z]|$)|×/.test(signature) && !signature.includes("查看详情")) {
        matchingControls.push(control);
      }
    }
    if (matchingControls.length === 1) {
      closeControl = matchingControls[0];
      break;
    }
  }
  if (!closeControl) {
    throw new Error("Known Doudian shop-switch informational overlay has no controlled close action.");
  }
  await closeControl.click({ timeout: 3000 });
  await page.waitForTimeout(300);
  const remainedVisible = await visibleRoots.count().then((count) => count > 0).catch(() => false);
  if (remainedVisible) {
    throw new Error("Known Doudian shop-switch informational overlay remained visible after close.");
  }
  logInfo("Dismissed known Doudian shop-switch informational overlay.");
  return true;
}

async function clickTopRightShopMenu(page: Page): Promise<boolean> {
  const menuVisible = async (): Promise<boolean> =>
    page.evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      return Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .some((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          return (
            Boolean(text) &&
            (text.includes("切换组织/店铺") || text.includes("退出")) &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top < 180 &&
            rect.left > window.innerWidth * 0.68 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
    });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const headerShopMenu = page
      .locator(".headerShopName, [class*='headerShopName'], [class*='userName']")
      .filter({ hasText: /店/ })
      .first();
    const locatorClicked = await headerShopMenu.click({ timeout: 3000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(700 + attempt * 250);
    if (locatorClicked && await menuVisible()) {
      return true;
    }

    const clicked = await page.evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const candidates = Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          if (
            !text ||
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            rect.top > 180 ||
            rect.left < window.innerWidth * 0.68 ||
            !/(旗舰店|专营店|专卖店|店铺)/.test(text)
          ) {
            return null;
          }
          const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
          const score =
            (marker.includes("header") ? 30 : 0) +
            (marker.includes("dropdown") ? 25 : 0) +
            (marker.includes("avatar") ? 20 : 0) +
            (marker.includes("user") ? 20 : 0) +
            (rect.top < 100 ? 15 : 0) -
            text.length / 4;
          return { el, score };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0));
      const target = candidates[0]?.el;
      if (!target) {
        return false;
      }
      target.click();
      return true;
    });

    await page.waitForTimeout(700 + attempt * 250);
    if (clicked && await menuVisible()) {
      return true;
    }
  }
  return false;
}

async function waitForTopRightShopMenuAnchor(page: Page, timeoutMs = 12000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = await page
      .evaluate(() => {
        const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
        return Array.from(document.querySelectorAll("body *"))
          .map((node) => node as HTMLElement)
          .some((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const text = normalize(el.innerText || el.textContent || "");
            return (
              Boolean(text) &&
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.top <= 180 &&
              rect.left >= window.innerWidth * 0.68 &&
              /(旗舰店|专营店|专卖店|店铺)/.test(text)
            );
          });
      })
      .catch(() => false);
    if (found) {
      return true;
    }
    await page.waitForTimeout(600);
  }
  return false;
}

async function isTopRightShopMenuLoading(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("[aria-busy='true']"))
      .map((node) => node as HTMLElement)
      .some((busy) => {
        const tooltip = busy.closest("[role='tooltip']") as HTMLElement | null;
        if (!tooltip) return false;
        const rect = tooltip.getBoundingClientRect();
        const style = window.getComputedStyle(tooltip);
        return (
          rect.width > 180 &&
          rect.height > 200 &&
          rect.top < 180 &&
          rect.left > window.innerWidth * 0.68 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      });
  }).catch(() => false);
}

async function waitForTopRightShopMenuLoadingToSettle(page: Page, timeoutMs = 8000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isTopRightShopMenuLoading(page))) {
      return false;
    }
    await page.waitForTimeout(500);
  }
  return isTopRightShopMenuLoading(page);
}

async function clickVisibleActionText(page: Page, text: string): Promise<boolean> {
  const clicked = await page.evaluate((targetText) => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const target = normalize(targetText);
    const matches = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const textValue = normalize(el.innerText || el.textContent || "");
        if (
          !textValue ||
          textValue !== target ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        return el;
      })
      .filter(Boolean);
    const match = matches[0];
    if (!match) {
      return false;
    }
    match.click();
    return true;
  }, text);

  if (!clicked) {
    return false;
  }
  await page.waitForTimeout(800);
  return true;
}

async function isShopSwitchEntryVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const target = normalize("切换组织/店铺");
    return Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .some((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        return (
          Boolean(text) &&
          text.includes(target) &&
          rect.width >= 120 &&
          rect.height >= 20 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.left >= window.innerWidth * 0.68
        );
      });
  }).catch(() => false);
}

async function clickShopSwitchEntry(page: Page): Promise<boolean> {
  const switchEntries = page.getByText("切换组织/店铺", { exact: true });
  const switchEntryCount = await switchEntries.count().catch(() => 0);
  for (let index = switchEntryCount - 1; index >= 0; index -= 1) {
    const entry = switchEntries.nth(index);
    if (!(await entry.isVisible().catch(() => false))) {
      continue;
    }
    const clicked = await entry.click({ timeout: 3000 }).then(() => true).catch(() => false);
    if (clicked) {
      await page.waitForTimeout(900);
      return true;
    }
  }

  const clicked = await page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const target = normalize("切换组织/店铺");
    const items = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          !text.includes(target) ||
          rect.width < 160 ||
          rect.height < 28 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.left < window.innerWidth * 0.72
        ) {
          return null;
        }
        const score =
          (text === target ? 120 : 0) +
          (rect.width > 220 ? 30 : 0) +
          (rect.top < 520 ? 10 : 0) -
          Math.abs(rect.height - 44);
        return { el, score };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));
    const item = items[0]?.el;
    if (!item) {
      return false;
    }
    item.click();
    return true;
  });

  if (!clicked) {
    return false;
  }
  await page.waitForTimeout(900);
  return true;
}

async function recoverTransientShopSwitchError(page: Page): Promise<boolean> {
  const errorDialogs = page
    .locator("div[role='dialog'], div[aria-modal='true'], .semi-modal, .ant-modal, .ecom-g-modal, [class*='modal']")
    .filter({ hasText: "似乎出现了一些错误" });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const dialogCount = await errorDialogs.count().catch(() => 0);
    let errorDialog: Locator | null = null;
    for (let index = 0; index < dialogCount; index += 1) {
      const candidate = errorDialogs.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      const normalizedText = await candidate
        .innerText()
        .then((value) => value.replace(/\s+/g, "").trim())
        .catch(() => "");
      if (!normalizedText.includes("似乎出现了一些错误")) {
        continue;
      }
      const retryButtons = candidate.getByRole("button", { name: "重试", exact: true });
      const visibleRetryCount = await retryButtons.count().catch(() => 0);
      if (visibleRetryCount !== 1 || !(await retryButtons.first().isVisible().catch(() => false))) {
        continue;
      }
      errorDialog = candidate;
      break;
    }

    if (!errorDialog) {
      return false;
    }

    logWarn(`Doudian shop switch returned a transient platform error; clicking scoped retry (${attempt + 1}/2)`);
    const retryClicked = await errorDialog
      .getByRole("button", { name: "重试", exact: true })
      .click({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!retryClicked) {
      return false;
    }

    for (let readbackAttempt = 0; readbackAttempt < 8; readbackAttempt += 1) {
      await page.waitForTimeout(500);
      if (await waitForChooseShopDialog(page)) {
        return true;
      }
      if (!(await errorDialog.isVisible().catch(() => false))) {
        return true;
      }
    }
  }
  return false;
}

async function isChooseShopSurfaceVisible(page: Page): Promise<boolean> {
  const dialogByLocator = page
    .locator("div[role='dialog'], div[aria-modal='true'], .semi-modal, .ant-modal, .ecom-g-modal, [class*='modal']")
    .filter({ hasText: "请选择店铺" })
    .first();
  const dialogVisibleByLocator = await dialogByLocator.isVisible().catch((error) => {
    if (isNavigationContextDestroyedError(error)) {
      return false;
    }
    return false;
  });
  if (dialogVisibleByLocator) {
    return true;
  }
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, "");
    return text.includes("请选择店铺");
  }).catch((error) => {
    if (isNavigationContextDestroyedError(error)) {
      return false;
    }
    throw error;
  });
}

async function isChooseShopLoadingSurfaceVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalize = (value: string): string => String(value || "").replace(/\s+/g, "").trim();
    return Array.from(document.querySelectorAll(
      "div[role='dialog'], div[aria-modal='true'], .semi-modal, .ant-modal, .ecom-g-modal, [class*='modal']"
    ))
      .map((node) => node as HTMLElement)
      .some((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        return (
          text.includes("加载中") &&
          !text.includes("请选择店铺") &&
          rect.width >= 300 &&
          rect.height >= 240 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      });
  }).catch((error) => {
    if (isNavigationContextDestroyedError(error)) {
      return false;
    }
    throw error;
  });
}

export async function waitForChooseShopSurfaceReady(
  page: Page,
  timeoutMs = 25_000
): Promise<"ready" | "loading" | "absent"> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let sawLoading = false;
  do {
    if (await isChooseShopSurfaceVisible(page)) {
      return "ready";
    }
    if (await isChooseShopLoadingSurfaceVisible(page)) {
      sawLoading = true;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await page.waitForTimeout(Math.min(500, remaining));
    }
  } while (Date.now() < deadline);
  return sawLoading ? "loading" : "absent";
}

async function waitForChooseShopDialog(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await isChooseShopSurfaceVisible(page)) {
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

async function saveShopSwitchDomSnapshot(page: Page, runtimeDir: string, fileName: string): Promise<string> {
  const html = await page.evaluate(() => {
    const normalize = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();
    const menuCandidates = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        return (
          text &&
          (text.includes("切换组织/店铺") || text.includes("退出") || text.includes("请选择店铺")) &&
          rect.width > 100 &&
          rect.height > 24 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .slice(0, 10)
      .map((el) => el.outerHTML);
    const topRightCandidates = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0
          && rect.height > 0
          && rect.top < 200
          && rect.left > window.innerWidth * 0.65
          && style.display !== "none"
          && style.visibility !== "hidden"
        );
      })
      .slice(0, 20)
      .map((el) => el.outerHTML);
    return menuCandidates.join("\n\n<!-- split -->\n\n")
      || topRightCandidates.join("\n\n<!-- top-right split -->\n\n")
      || document.documentElement.outerHTML;
  });
  const targetFile = path.join(runtimeDir, fileName);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  if (!html.trim()) {
    throw new Error("Shop-switch DOM snapshot was empty.");
  }
  fs.writeFileSync(targetFile, html, "utf8");
  return targetFile;
}

async function getChooseShopDialog(page: Page): Promise<Locator | null> {
  const dialog = page
    .locator("div[role='dialog'], div[aria-modal='true'], .semi-modal, .ant-modal, .ecom-g-modal, [class*='modal']")
    .filter({ hasText: "请选择店铺" })
    .first();
  if (await dialog.isVisible().catch(() => false)) {
    return dialog;
  }
  const fullPageHeading = page.getByText("请选择店铺", { exact: true }).first();
  if (await fullPageHeading.isVisible().catch(() => false)) {
    const fullPageChooser = fullPageHeading.locator("xpath=..");
    if (await fullPageChooser.isVisible().catch(() => false)) {
      return fullPageChooser;
    }
  }
  return null;
}

async function selectShopFromDialogExact(page: Page, expectedShopName: string): Promise<boolean> {
  const dialog = await getChooseShopDialog(page);
  if (!dialog) {
    return false;
  }

  const cards = dialog.getByText(expectedShopName, { exact: true });
  const normalizeText = (value: string): string => value.replace(/\s+/g, "").trim();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const visibleCardCount = await cards.count().catch(() => 0);
    for (let index = 0; index < visibleCardCount; index += 1) {
      const card = cards.nth(index);
      if (!(await card.isVisible().catch(() => false))) {
        continue;
      }
      const nameText = await card
        .textContent()
        .then((value) => normalizeText(value || ""))
        .catch(() => "");
      if (nameText !== normalizeText(expectedShopName)) {
        continue;
      }

      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card
        .evaluate((cardNode) => {
          const list = cardNode.closest(".index_roleList__2YMEN") as HTMLElement | null;
          if (list) {
            list.scrollTop = Math.max(0, (cardNode as HTMLElement).offsetTop - list.offsetTop - 24);
          }
          (cardNode as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" });
        })
        .catch(() => {});
      await page.waitForTimeout(350);
      const domClicked = await card
        .evaluate((nameNode) => {
          (nameNode as HTMLElement).click();
          return true;
        })
        .catch((error) => {
          if (isNavigationContextDestroyedError(error)) {
            return true;
          }
          return false;
        });
      if (domClicked) {
        await page.waitForTimeout(1800);
        const dialogStillVisible = await waitForChooseShopDialog(page);
        if (!dialogStillVisible) {
          return true;
        }
      }
      const textClicked = await card
        .click({ timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (!textClicked) {
        continue;
      }
      await page.waitForTimeout(1800);
      const dialogStillVisible = await waitForChooseShopDialog(page);
      if (!dialogStillVisible) {
        return true;
      }
    }

    const scrolled = await dialog
      .locator("div, ul")
      .evaluateAll((nodes) => {
        const candidates = nodes
          .map((node) => node as HTMLElement)
          .filter((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 180)
          .sort((a, b) => b.clientHeight - a.clientHeight);
        const target = candidates[0];
        if (!target) {
          return false;
        }
        target.scrollTop = Math.min(target.scrollTop + Math.max(260, Math.floor(target.clientHeight * 0.75)), target.scrollHeight);
        return true;
      })
      .catch(() => false);
    if (!scrolled) {
      break;
    }
    await page.waitForTimeout(450);
  }

  return false;
}

async function selectShopFromDialogByVisibleText(page: Page, expectedShopName: string): Promise<boolean> {
  const clicked = await page.evaluate((targetName) => {
    const normalize = (value: string): string => String(value || "").replace(/^\d+/, "").replace(/\s+/g, "").trim();
    const target = normalize(targetName);
    const isVisible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const modals = Array.from(document.querySelectorAll("body *"))
      .map((node) => node as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const text = normalize(el.innerText || el.textContent || "");
        return isVisible(el) && text.includes("请选择店铺") && rect.width > 300 && rect.height > 240;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return Math.abs(ar.width - 640) - Math.abs(br.width - 640) || ar.height - br.height;
      });
    const modal = modals[0];
    if (!modal) {
      return null;
    }
    const modalRect = modal.getBoundingClientRect();
    const textNodes = Array.from(modal.querySelectorAll("*"))
      .map((node) => node as HTMLElement)
      .filter((el) => {
        if (!isVisible(el)) {
          return false;
        }
        const text = normalize(el.innerText || el.textContent || "");
        return text === target || (text.includes(target) && text.length <= target.length + 20);
      })
      .sort((a, b) => {
        const aText = normalize(a.innerText || a.textContent || "");
        const bText = normalize(b.innerText || b.textContent || "");
        const exactDelta = (aText === target ? 0 : 1) - (bText === target ? 0 : 1);
        if (exactDelta !== 0) {
          return exactDelta;
        }
        return aText.length - bText.length;
      });
    const nameNode = textNodes[0];
    if (!nameNode) {
      return null;
    }

    const scrollContainer =
      (Array.from(modal.querySelectorAll("*"))
        .map((node) => node as HTMLElement)
        .filter((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 160)
        .sort((a, b) => b.clientHeight - a.clientHeight)[0] as HTMLElement | undefined) || modal;
    let card: HTMLElement = nameNode;
    for (let depth = 0; depth < 8; depth += 1) {
      const parent = card.parentElement as HTMLElement | null;
      if (!parent || parent === modal || parent === scrollContainer) {
        break;
      }
      const rect = parent.getBoundingClientRect();
      const text = normalize(parent.innerText || parent.textContent || "");
      if (text.includes(target) && rect.width >= 220 && rect.height >= 50 && rect.width <= modalRect.width + 8) {
        card = parent;
      }
    }

    // If the target card is near the bottom fade/edge, move it to the middle before clicking.
    const containerRect = scrollContainer.getBoundingClientRect();
    const cardOffsetTop = card.offsetTop;
    scrollContainer.scrollTop = Math.max(0, cardOffsetTop - scrollContainer.clientHeight / 2 + card.clientHeight / 2);
    card.scrollIntoView({ block: "center", inline: "nearest" });

    const cardRect = card.getBoundingClientRect();
    const clickTarget = nameNode;
    const targetRect = clickTarget.getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0 || cardRect.bottom < containerRect.top || cardRect.top > containerRect.bottom) {
      return false;
    }
    clickTarget.click();
    return true;
  }, expectedShopName).catch((error) => {
    if (isNavigationContextDestroyedError(error)) {
      return true;
    }
    return null;
  });
  if (!clicked) {
    return false;
  }
  await page.waitForTimeout(1800);
  return !(await waitForChooseShopDialog(page));
}

export async function selectShopFromDialog(page: Page, expectedShopName: string): Promise<boolean> {
  const visibleTextMatched = await selectShopFromDialogByVisibleText(page, expectedShopName);
  if (visibleTextMatched) {
    return true;
  }
  const exactMatched = await selectShopFromDialogExact(page, expectedShopName);
  if (exactMatched) {
    return true;
  }
  await page
    .evaluate(() => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const modal = Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .find((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          return (
            text.includes("\u8bf7\u9009\u62e9\u5e97\u94fa") &&
            rect.width > 300 &&
            rect.height > 240 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
      if (!modal) {
        return false;
      }
      const scrollContainer =
        (Array.from(modal.querySelectorAll("*"))
          .map((node) => node as HTMLElement)
          .find((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 180) as HTMLElement | undefined) ||
        modal;
      scrollContainer.scrollTop = 0;
      return true;
    })
    .catch(() => false);
  await page.waitForTimeout(500);
  const normalizedExpected = normalizeShopName(expectedShopName);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (await selectShopFromDialogByVisibleText(page, expectedShopName)) {
      return true;
    }
    const candidate = await page.evaluate((target) => {
      const normalize = (value: string): string => value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
      const modal = Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .find((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          return (
            text.includes("请选择店铺") &&
            rect.width > 300 &&
            rect.height > 240 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
      if (!modal) {
        return { found: false, scrollable: false };
      }

      const scrollContainer =
        (Array.from(modal.querySelectorAll("*"))
          .map((node) => node as HTMLElement)
          .find((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 180) as HTMLElement | undefined) ||
        modal;

      const modalRect = modal.getBoundingClientRect();
      const nodes = Array.from(modal.querySelectorAll("*")).map((node) => node as HTMLElement);
      const cards = nodes
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          if (
            !text ||
            rect.width <= 30 ||
            rect.height <= 16 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            !text.includes(target) ||
            rect.width > modalRect.width * 0.92
          ) {
            return null;
          }

          let card = el;
          for (let depth = 0; depth < 6; depth += 1) {
            const parent = card.parentElement as HTMLElement | null;
            if (!parent) {
              break;
            }
            const parentRect = parent.getBoundingClientRect();
            const parentText = normalize(parent.innerText || parent.textContent || "");
            const parentStyle = window.getComputedStyle(parent);
            if (
              parentText.includes(target) &&
              parentRect.width >= 220 &&
              parentRect.height >= 56 &&
              parentRect.width < modalRect.width * 0.92 &&
              parentStyle.display !== "none" &&
              parentStyle.visibility !== "hidden"
            ) {
              card = parent;
              continue;
            }
            break;
          }

          const cardRect = card.getBoundingClientRect();
          const cardText = normalize(card.innerText || card.textContent || "");
          if (
            !cardText.includes(target) ||
            cardRect.width < 220 ||
            cardRect.height < 56 ||
            cardRect.width > modalRect.width * 0.92
          ) {
            return null;
          }

          const exactText = text === target;
          const exactCard = cardText === target;
          const exactScore =
            (exactText ? 400 : 0) +
            (exactCard ? 260 : 0) +
            (cardText.includes(target) ? 80 : 0) -
            Math.abs(cardRect.height - 88) -
            cardText.length / 5;
          return {
            card,
            text: cardText,
            score: exactScore
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0));

      if (cards[0]) {
        const card = cards[0].card as HTMLElement;
        const targetNode = card;
        targetNode.click();
        return {
          found: true,
          scrollable: scrollContainer.scrollHeight > scrollContainer.clientHeight + 40
        };
      }

      if (scrollContainer.scrollHeight > scrollContainer.clientHeight + 40) {
        scrollContainer.scrollTop = Math.min(
          scrollContainer.scrollTop + Math.max(260, Math.floor(scrollContainer.clientHeight * 0.75)),
          scrollContainer.scrollHeight
        );
        return { found: false, scrollable: true };
      }

      return { found: false, scrollable: false };
    }, normalizedExpected);

    if (candidate.found) {
      await page.waitForTimeout(1800);
      const dialogStillVisible = await waitForChooseShopDialog(page);
      if (!dialogStillVisible) {
        return true;
      }
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(1200);
      if (!(await waitForChooseShopDialog(page))) {
        return true;
      }
    }
    if (!candidate.scrollable) {
      return false;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function ensureShopContextAttempt(page: Page, runtimeDir: string, shopFolder: string): Promise<string> {
  const expectedShopName = resolveExpectedShopName(shopFolder);
  if (!expectedShopName) {
    return "";
  }

  const currentBefore = normalizeShopName(await detectCurrentShopName(page));
  if (await confirmDoudianLoginRequired(page)) {
    const screenshotFile = await savePageScreenshot(page, runtimeDir, "doudian-login-required.png").catch(() => "");
    throw new Error(
      `Doudian login required: open the automation browser and scan the QR code with the Doudian app before publishing ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`
    );
  }
  if (currentBefore && currentBefore.includes(expectedShopName)) {
    return currentBefore;
  }
  let lastActual = currentBefore || "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissKnownShopSwitchInformationalOverlay(page);
    const currentFromHeader = normalizeShopName(await detectCurrentShopName(page));
    if (isExpectedShopContext(currentFromHeader, expectedShopName)) {
      return currentFromHeader;
    }
    if (await isChooseShopSurfaceVisible(page)) {
      const selectedFromLoginChooser = await selectShopFromDialog(page, expectedShopName);
      if (!selectedFromLoginChooser) {
        await saveShopSwitchDomSnapshot(page, runtimeDir, "login-shop-chooser-target-missing.html").catch(() => "");
        const screenshotFile = await savePageScreenshot(page, runtimeDir, "login-shop-chooser-target-missing.png").catch(() => "");
        throw new Error(
          `Shop switch failed: target shop not found in post-login chooser for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`
        );
      }
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await gotoWithTolerance(page, PLATFORM_SPU_URL, 7000 + attempt * 1500).catch(() => {});
      await waitForTopRightShopMenuAnchor(page, 10000 + attempt * 2000).catch(() => false);
      const verificationMenuOpened = await clickTopRightShopMenu(page).catch(() => false);
      const selectedShopName = normalizeShopName(
        verificationMenuOpened
          ? await readCurrentShopNameFromMenu(page)
          : await detectCurrentShopName(page)
      );
      await page.keyboard.press("Escape").catch(() => {});
      if (selectedShopName && selectedShopName.includes(expectedShopName)) {
        return selectedShopName;
      }
      lastActual = selectedShopName;
      if (attempt < 2) {
        await page.waitForTimeout(1000 + attempt * 500);
        continue;
      }
      break;
    }
    const anchorReady = await waitForTopRightShopMenuAnchor(page, 10000 + attempt * 3000);
    if (!anchorReady) {
      await gotoWithTolerance(page, PLATFORM_SPU_URL, 5000 + attempt * 1500).catch(() => {});
      await waitForTopRightShopMenuAnchor(page, 8000 + attempt * 2000).catch(() => false);
    }
    const menuOpened = await clickTopRightShopMenu(page);
    if (!menuOpened) {
      if (await confirmDoudianLoginRequired(page)) {
        const screenshotFile = await savePageScreenshot(page, runtimeDir, "doudian-login-required.png").catch(() => "");
        throw new Error(
          `Doudian login required: open the automation browser and scan the QR code with the Doudian app before publishing ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`
        );
      }
      if (attempt < 2) {
        await gotoWithTolerance(page, PLATFORM_SPU_URL, 5500 + attempt * 1500).catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(1000);
        continue;
      }
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-menu-missing.png").catch(() => "");
      throw new Error(`Shop switch failed: could not open top-right shop menu for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
    }

    const menuLoading = await waitForTopRightShopMenuLoadingToSettle(page);
    const currentFromHeaderAfterMenuOpen = normalizeShopName(await detectCurrentShopName(page));
    const currentFromMenuBeforeSwitch = normalizeShopName(await readCurrentShopNameFromMenu(page));
    const initialSwitchDecision = evaluateShopSwitchMenuState({
      expectedShopName,
      currentShopName: currentFromMenuBeforeSwitch || currentFromHeaderAfterMenuOpen || currentFromHeader || lastActual || currentBefore,
      menuOpened,
      menuLoading,
      switchEntryVisible: await isShopSwitchEntryVisible(page)
    });
    if (initialSwitchDecision.action === "already_in_target_shop") {
      await page.keyboard.press("Escape").catch(() => {});
      return currentFromMenuBeforeSwitch || expectedShopName;
    }
    if (initialSwitchDecision.action === "retry_menu" && attempt < 2) {
      await page.keyboard.press("Escape").catch(() => {});
      await gotoWithTolerance(page, PLATFORM_SPU_URL, 5500 + attempt * 1500).catch(() => {});
      await page.waitForTimeout(1000);
      continue;
    }

    let switcherClicked = false;
    if (initialSwitchDecision.action === "click_switch_entry") {
      switcherClicked = await clickShopSwitchEntry(page);
      if (!switcherClicked) {
        switcherClicked = await clickVisibleActionText(page, "切换组织/店铺");
      }
    }
    if (!switcherClicked) {
      const currentFromMenu = normalizeShopName(await readCurrentShopNameFromMenu(page));
      const currentFromHeaderAfterMenu = normalizeShopName(await detectCurrentShopName(page));
      const finalSwitchDecision = evaluateShopSwitchMenuState({
        expectedShopName,
        currentShopName: currentFromMenu || currentFromHeaderAfterMenu || currentFromHeader || lastActual || currentBefore,
        menuOpened: true,
        menuLoading,
        switchEntryVisible: false
      });
      if (finalSwitchDecision.action === "already_in_target_shop") {
        await page.keyboard.press("Escape").catch(() => {});
        return currentFromMenu || currentFromHeaderAfterMenu || currentFromHeader || expectedShopName;
      }
      await saveShopSwitchDomSnapshot(page, runtimeDir, "shop-switch-entry-missing.html").catch(() => "");
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-entry-missing.png").catch(() => "");
      throw new Error(`Shop switch failed: could not find 切换组织/店铺 for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
    }

    let dialogState = await waitForChooseShopSurfaceReady(page);
    if (dialogState === "absent" && await recoverTransientShopSwitchError(page)) {
      dialogState = await waitForChooseShopSurfaceReady(page);
    }
    if (dialogState === "absent") {
      await clickShopSwitchEntry(page).catch(() => false);
      dialogState = await waitForChooseShopSurfaceReady(page);
    }
    if (dialogState === "absent" && await recoverTransientShopSwitchError(page)) {
      dialogState = await waitForChooseShopSurfaceReady(page);
    }
    if (dialogState === "loading") {
      await saveShopSwitchDomSnapshot(page, runtimeDir, `shop-switch-dialog-loading-${attempt + 1}.html`).catch(() => "");
      await savePageScreenshot(page, runtimeDir, `shop-switch-dialog-loading-${attempt + 1}.png`).catch(() => "");
      if (attempt < 2) {
        logWarn(`shop chooser remained loading; retrying from canonical page (${attempt + 1}/3)`);
        await gotoWithTolerance(page, PLATFORM_SPU_URL, 7000 + attempt * 1500).catch(() => {});
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(1000 + attempt * 500);
        continue;
      }
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-dialog-loading-exhausted.png").catch(() => "");
      throw new Error(
        `Shop switch failed: shop chooser remained loading after bounded recovery for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`
      );
    }
    if (dialogState !== "ready") {
      if (await confirmDoudianLoginRequired(page)) {
        const screenshotFile = await savePageScreenshot(page, runtimeDir, "doudian-login-required.png").catch(() => "");
        throw new Error(
          `Doudian login required: open the automation browser and scan the QR code with the Doudian app before publishing ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`
        );
      }
      await saveShopSwitchDomSnapshot(page, runtimeDir, "shop-switch-dialog-missing.html").catch(() => "");
      const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-dialog-missing.png").catch(() => "");
      throw new Error(`Shop switch failed: 请选择店铺 dialog did not appear for ${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
    }

    const selected = await selectShopFromDialog(page, expectedShopName);
    const chooserVisibleAfterSelection = selected
      ? false
      : await waitForChooseShopDialog(page);
    let currentShopAfterSelection = "";
    if (!chooserVisibleAfterSelection) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      for (let readbackAttempt = 0; readbackAttempt < 5; readbackAttempt += 1) {
        await page.waitForTimeout(700 + readbackAttempt * 350);
        currentShopAfterSelection = normalizeShopName(
          await detectCurrentShopName(page).catch(() => "")
        );
        if (currentShopAfterSelection) break;
      }
    }
    const currentShopMatchedAfterSelection = Boolean(
      currentShopAfterSelection && currentShopAfterSelection.includes(expectedShopName)
    );
    const selectionDecision = evaluateShopTargetSelectionState({
      selectionReported: selected,
      chooserVisibleAfterSelection,
      currentShopMatchedAfterSelection
    });
    if (selectionDecision.action === "retry_transient_page" && attempt < 2) {
      logWarn(
        `shop chooser vanished before target verification; retrying from canonical page (${attempt + 1}/3)`
      );
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await gotoWithTolerance(page, PLATFORM_SPU_URL, 5500 + attempt * 1500).catch(() => {});
      await page.waitForTimeout(1000 + attempt * 500);
      await page.keyboard.press("Escape").catch(() => {});
      continue;
    }
    if (selectionDecision.action !== "selected") {
      const evidenceName = selectionDecision.action === "fail_target_missing"
        ? "shop-switch-target-missing"
        : "shop-switch-selection-unstable";
      await saveShopSwitchDomSnapshot(page, runtimeDir, `${evidenceName}.html`).catch(() => "");
      const screenshotFile = await savePageScreenshot(page, runtimeDir, `${evidenceName}.png`).catch(() => "");
      throw new Error(
        `Shop switch failed: ${selectionDecision.issue} target=${expectedShopName}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`
      );
    }

    if (currentShopMatchedAfterSelection) {
      return currentShopAfterSelection;
    }

    await page.waitForLoadState("domcontentloaded").catch(() => {});
    let currentAfter = "";
    for (let verifyAttempt = 0; verifyAttempt < 5; verifyAttempt += 1) {
      await page.waitForTimeout(1800 + attempt * 500);
      await clickTopRightShopMenu(page).catch(() => false);
      await page.waitForTimeout(600);
      const currentFromMenu = normalizeShopName(await readCurrentShopNameFromMenu(page));
      currentAfter = currentFromMenu || normalizeShopName(await detectCurrentShopName(page));
      if (currentAfter && currentAfter.includes(expectedShopName)) {
        await page.keyboard.press("Escape").catch(() => {});
        return currentAfter || expectedShopName;
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
    lastActual = currentAfter || "";
    await gotoWithTolerance(page, PLATFORM_SPU_URL, 3000).catch(() => {});
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }

  await saveShopSwitchDomSnapshot(page, runtimeDir, "shop-switch-verify-failed.html").catch(() => "");
  const screenshotFile = await savePageScreenshot(page, runtimeDir, "shop-switch-verify-failed.png").catch(() => "");
  throw new Error(`Shop switch failed: expected=${expectedShopName}; actual=${lastActual || "<empty>"}${screenshotFile ? `; screenshot=${screenshotFile}` : ""}`);
}

export async function ensureShopContext(page: Page, runtimeDir: string, shopFolder: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await ensureShopContextAttempt(page, runtimeDir, shopFolder);
    } catch (error) {
      lastError = error;
      if (!isNavigationContextDestroyedError(error) || attempt === 3) {
        throw error;
      }
      logWarn(`shop context read crossed a navigation; retrying from stable page state (${attempt + 1}/4)`);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(700 + attempt * 400);
    }
  }
  throw lastError;
}

export { dismissKnownShopSwitchInformationalOverlay };
