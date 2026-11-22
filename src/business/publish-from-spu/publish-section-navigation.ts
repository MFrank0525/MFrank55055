import type { Page } from "playwright";
import { clickLocatorWithTransientUiRecovery } from "./browser-session.js";
import { dismissTransientOverlays } from "./dom-actions.js";

export async function readActivePublishSectionTab(page: Page): Promise<string> {
  const labels = new Set(["基础信息", "图文信息", "价格库存", "服务与履约", "其他信息"]);
  const selectedTabs = page.locator('[role="tab"][aria-selected="true"]');
  if ((await selectedTabs.count()) !== 1) {
    return "";
  }
  const text = (await selectedTabs.first().innerText()).replace(/\s+/g, " ").trim();
  return labels.has(text) ? text : "";
}

export async function isPublishSectionContentVisible(page: Page, text: string): Promise<boolean> {
  return page.evaluate((targetText) => {
    const markersBySection: Record<string, string[]> = {
      "\u57fa\u7840\u4fe1\u606f": [
        "\u5546\u54c1\u6807\u9898",
        "\u5bfc\u8d2d\u77ed\u6807\u9898",
        "\u5546\u54c1\u7c7b\u76ee",
        "\u7c7b\u76ee\u5c5e\u6027",
        "\u54c1\u724c",
        "\u533b\u7597\u5668\u68b0\u5907\u6848/\u6ce8\u518c\u53f7",
        "\u77ed\u6807\u9898",
        "\u578b\u53f7\u89c4\u683c"
      ],
      "\u56fe\u6587\u4fe1\u606f": ["\u4e3b\u56fe", "\u5546\u54c1\u8be6\u60c5"],
      "\u4ef7\u683c\u5e93\u5b58": ["\u53d1\u8d27\u6a21\u5f0f", "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4", "\u5546\u54c1\u89c4\u683c"],
      "\u670d\u52a1\u4e0e\u5c65\u7ea6": ["\u552e\u540e\u670d\u52a1", "\u552e\u540e\u653f\u7b56", "\u552e\u540e\u670d\u52a1\u627f\u8bfa"],
      "\u5176\u4ed6\u4fe1\u606f": ["\u5176\u4ed6\u4fe1\u606f"]
    };
    const markers = markersBySection[targetText] || [targetText];
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const visibleTexts = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 420 &&
          rect.top >= 240 &&
          rect.top <= window.innerHeight - 40 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .map((el) => normalize(el.innerText || el.textContent || ""))
      .filter(Boolean);

    return markers.some((marker) => visibleTexts.some((text) => text.includes(marker)));
  }, text);
}

export async function isPublishSectionContentPresent(page: Page, text: string): Promise<boolean> {
  return page.evaluate((targetText) => {
    const markersBySection: Record<string, string[]> = {
      "\u57fa\u7840\u4fe1\u606f": [
        "\u5546\u54c1\u6807\u9898",
        "\u5bfc\u8d2d\u77ed\u6807\u9898",
        "\u5546\u54c1\u7c7b\u76ee",
        "\u7c7b\u76ee\u5c5e\u6027",
        "\u54c1\u724c",
        "\u533b\u7597\u5668\u68b0\u5907\u6848/\u6ce8\u518c\u53f7",
        "\u77ed\u6807\u9898",
        "\u578b\u53f7\u89c4\u683c"
      ],
      "\u56fe\u6587\u4fe1\u606f": ["\u4e3b\u56fe", "\u767d\u5e95\u56fe", "\u5546\u54c1\u8be6\u60c5"],
      "\u4ef7\u683c\u5e93\u5b58": ["\u53d1\u8d27\u6a21\u5f0f", "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4", "\u5546\u54c1\u89c4\u683c"],
      "\u670d\u52a1\u4e0e\u5c65\u7ea6": ["\u8fd0\u8d39\u6a21\u677f", "\u552e\u540e\u670d\u52a1", "\u552e\u540e\u653f\u7b56"],
      "\u5176\u4ed6\u4fe1\u606f": ["\u533b\u7597\u5668\u68b0\u6ce8\u518c\u8bc1", "\u5176\u4ed6\u4fe1\u606f"]
    };
    const markers = markersBySection[targetText] || [targetText];
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const node = el as HTMLElement;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const text = normalize(node.innerText || node.textContent || "");
        if (
          !text ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.left < 420 ||
          rect.top < 240 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return false;
        }
        return markers.some((marker) => text.includes(marker));
      })
      .some(Boolean);
  }, text);
}

export async function scrollPublishSectionContentIntoView(page: Page, text: string): Promise<boolean> {
  return page.evaluate((targetText) => {
    const markersBySection: Record<string, string[]> = {
      "\u57fa\u7840\u4fe1\u606f": [
        "\u5546\u54c1\u6807\u9898",
        "\u5bfc\u8d2d\u77ed\u6807\u9898",
        "\u5546\u54c1\u7c7b\u76ee",
        "\u7c7b\u76ee\u5c5e\u6027",
        "\u54c1\u724c",
        "\u533b\u7597\u5668\u68b0\u5907\u6848/\u6ce8\u518c\u53f7",
        "\u77ed\u6807\u9898",
        "\u578b\u53f7\u89c4\u683c"
      ],
      "\u56fe\u6587\u4fe1\u606f": ["\u4e3b\u56fe", "\u5546\u54c1\u8be6\u60c5"],
      "\u4ef7\u683c\u5e93\u5b58": ["\u53d1\u8d27\u6a21\u5f0f", "\u73b0\u8d27\u53d1\u8d27\u65f6\u95f4", "\u5546\u54c1\u89c4\u683c"],
      "\u670d\u52a1\u4e0e\u5c65\u7ea6": ["\u552e\u540e\u670d\u52a1", "\u552e\u540e\u653f\u7b56", "\u552e\u540e\u670d\u52a1\u627f\u8bfa"],
      "\u5176\u4ed6\u4fe1\u606f": ["\u5176\u4ed6\u4fe1\u606f"]
    };
    const markers = markersBySection[targetText] || [targetText];
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const target = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = normalize(el.innerText || el.textContent || "");
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          !text ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.left < 420 ||
          rect.top < 240 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          !markers.some((marker) => text.includes(marker))
        ) {
          return null;
        }
        return { el, top: rect.top };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs((a?.top || 0) - 180) - Math.abs((b?.top || 0) - 180))[0];

    if (!target) {
      return false;
    }

    target.el.scrollIntoView({ block: "start", behavior: "instant" });
    return true;
  }, text);
}

export async function scrollLabelIntoView(page: Page, labelText: string): Promise<boolean> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const target = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          !text.includes(targetLabel) ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        return { el, text, score: (text === targetLabel ? 1000 : 0) - text.length };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    if (!target) {
      return false;
    }

    target.el.scrollIntoView({ block: "center", behavior: "instant" });
    return true;
  }, labelText);
}

export async function findLabelAbsoluteTop(page: Page, labelText: string): Promise<number | null> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const target = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (
          !text ||
          !text.includes(targetLabel) ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return null;
        }
        return { top: rect.top + window.scrollY, score: (text === targetLabel ? 1000 : 0) - text.length };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    return typeof target?.top === "number" ? target.top : null;
  }, labelText);
}

export async function scrollUntilPublishSectionVisible(page: Page, text: string): Promise<boolean> {
  if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
    return true;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await scrollPublishSectionContentIntoView(page, text).catch(() => false);
    await page.waitForTimeout(350);
    if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
      return true;
    }
  }

  return false;
}

export async function ensurePublishSectionTab(page: Page, text: string): Promise<void> {
  const tabs = page.getByRole("tab", { name: text, exact: true });
  const tabCount = await tabs.count();
  if (tabCount !== 1) {
    throw new Error(`Publish section tab target must be unique: expected=${text}; count=${tabCount}`);
  }
  const tab = tabs.first();
  const section = page.locator(`[id="goodsEditScrollContainer-${text}"]`);
  const sectionCount = await section.count();
  if (sectionCount !== 1) {
    throw new Error(`Publish section content target must be unique: expected=${text}; count=${sectionCount}`);
  }
  let lastClickError = "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const activeBefore = await readActivePublishSectionTab(page).catch(() => "");
    const selectedBefore = (await tab.getAttribute("aria-selected").catch(() => "")) === "true";
    if (activeBefore === text && selectedBefore) {
      await section.evaluate((node) => node.scrollIntoView({ block: "start", behavior: "instant" })).catch(() => {});
      if (await section.isVisible().catch(() => false)) {
        return;
      }
    }

    await dismissTransientOverlays(page);
    try {
      await clickLocatorWithTransientUiRecovery(tab, 5000);
      lastClickError = "";
    } catch (error) {
      lastClickError = error instanceof Error ? error.message : String(error);
    }

    for (let settle = 0; settle < 30; settle += 1) {
      const selected = (await tab.getAttribute("aria-selected").catch(() => "")) === "true";
      const active = await readActivePublishSectionTab(page).catch(() => "");
      if (selected && active === text) {
        await section.evaluate((node) => node.scrollIntoView({ block: "start", behavior: "instant" })).catch(() => {});
        if (await section.isVisible().catch(() => false)) {
          return;
        }
      }
      await page.waitForTimeout(100);
    }
  }

  const activeTab = await readActivePublishSectionTab(page).catch(() => "");
  const suffix = lastClickError ? `; clickError=${lastClickError}` : "";
  throw new Error(`Failed to activate publish section tab: expected=${text}; actual=${activeTab || "<unknown>"}${suffix}`);
}

export async function ensureServiceSectionReady(page: Page): Promise<void> {
  await ensurePublishSectionTab(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6");
  const ready =
    (await readActivePublishSectionTab(page).catch(() => "")) === "\u670d\u52a1\u4e0e\u5c65\u7ea6" ||
    (await isPublishSectionContentPresent(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6").catch(() => false));
  if (!ready) {
    throw new Error("Service section is not ready after tab activation.");
  }
}
