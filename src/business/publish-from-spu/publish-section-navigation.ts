import type { Page } from "playwright";
import { clickVisibleText, dismissTransientOverlays } from "./dom-actions.js";

export async function readActivePublishSectionTab(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const labels = ["基础信息", "图文信息", "价格库存", "服务与履约", "其他信息"];
    const nodes = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = normalize(el.innerText || el.textContent || "");
        if (!labels.includes(text)) {
          return null;
        }
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width <= 0 || rect.height <= 0 || rect.top > 220 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        const marker = [String(el.className || ""), el.getAttribute("role") || ""].join(" ").toLowerCase();
        const color = style.color || "";
        const score =
          (marker.includes("active") ? 220 : 0) +
          (marker.includes("selected") ? 220 : 0) +
          (marker.includes("current") ? 220 : 0) +
          (el.getAttribute("aria-selected") === "true" ? 260 : 0) +
          (/rgb\(22,\s*119,\s*255\)/.test(color) ? 200 : 0) +
          (/rgb\(24,\s*144,\s*255\)/.test(color) ? 200 : 0) +
          (Number.parseInt(style.fontWeight || "400", 10) >= 500 ? 120 : 0);
        return { text, score, left: rect.left };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0) || (a?.left || 0) - (b?.left || 0));

    return nodes[0]?.text || "";
  });
}

export async function findPublishSectionTabCenter(page: Page, text: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((targetText) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const nodes = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const text = normalize(el.innerText || el.textContent || "");
        if (text !== targetText) {
          return null;
        }
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width <= 0 || rect.height <= 0 || rect.top > 220 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, left: rect.left };
      })
      .filter(Boolean)
      .sort((a, b) => (a?.left || 0) - (b?.left || 0));

    return nodes[0] || null;
  }, text);
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
    await page.mouse.wheel(0, 1200).catch(() => {});
    await page.waitForTimeout(500);
    if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
      return true;
    }
    await scrollPublishSectionContentIntoView(page, text).catch(() => false);
    await page.waitForTimeout(350);
    if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
      return true;
    }
  }

  return false;
}

export async function ensurePublishSectionTab(page: Page, text: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissTransientOverlays(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {});
    await page.waitForTimeout(400);
    if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
      return;
    }

    const tab = page.getByRole("tab", { name: text }).first();
    if (await tab.count()) {
      await tab.click({ timeout: 3000 }).catch(() => {});
    }

    if (!(await isPublishSectionContentVisible(page, text).catch(() => false))) {
      const topTabClicked = await page
        .evaluate((targetText) => {
          const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
          const candidates = Array.from(document.querySelectorAll("body *"))
            .map((node) => node as HTMLElement)
            .map((el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              const text = normalize(el.innerText || el.textContent || "");
              if (
                text !== targetText ||
                rect.width <= 0 ||
                rect.height <= 0 ||
                rect.top < 60 ||
                rect.top > 240 ||
                rect.left < window.innerWidth * 0.18 ||
                rect.left > window.innerWidth * 0.72 ||
                style.display === "none" ||
                style.visibility === "hidden"
              ) {
                return null;
              }
              return { el, score: (rect.top < 150 ? 40 : 0) - Math.abs(rect.top - 165) - text.length };
            })
            .filter(Boolean)
            .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];
          if (!candidates) {
            return false;
          }
          candidates.el.click();
          return true;
        }, text)
        .catch(() => false);
      if (topTabClicked) {
        await page.waitForTimeout(700);
      }
    }

    if (!(await isPublishSectionContentVisible(page, text).catch(() => false))) {
      await page.evaluate((targetText) => {
        const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
        const target = Array.from(document.querySelectorAll("[role='tab'], button, [role='button'], body *"))
          .map((el) => el as HTMLElement)
          .find((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              normalize(el.innerText || el.textContent || "") === targetText
            );
          });
        ((target?.closest("[role='tab'], button, [role='button']") as HTMLElement | null) || target)?.click();
      }, text).catch(() => false);
    }

    if (!(await isPublishSectionContentVisible(page, text).catch(() => false))) {
      await page.evaluate((targetText) => {
        const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
        const target = Array.from(document.querySelectorAll("body *"))
          .map((el) => el as HTMLElement)
          .find((el) => normalize(el.innerText || el.textContent || "") === targetText);
        target?.click();
      }, text).catch(() => {});
    }

    if (!(await isPublishSectionContentVisible(page, text).catch(() => false))) {
      await clickVisibleText(page, text);
    }

    await scrollPublishSectionContentIntoView(page, text).catch(() => false);
    await page.waitForTimeout(900);
    if (await isPublishSectionContentVisible(page, text).catch(() => false)) {
      return;
    }
  }

  const activeTab = await readActivePublishSectionTab(page).catch(() => "");
  if (activeTab === text) {
    return;
  }
  throw new Error(`Failed to activate publish section tab: expected=${text}; actual=${activeTab || "<unknown>"}`);
}

export async function ensureServiceSectionReady(page: Page): Promise<void> {
  await ensurePublishSectionTab(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6");
  const freightLabelTop = await findLabelAbsoluteTop(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => null);
  if (typeof freightLabelTop === "number") {
    await page.evaluate((top) => window.scrollTo({ top: Math.max(0, top - 180), behavior: "instant" }), freightLabelTop).catch(() => {});
    await page.waitForTimeout(500);
  }
  const freightLabelVisible = await scrollLabelIntoView(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => false);
  await scrollPublishSectionContentIntoView(page, "\u670d\u52a1\u4e0e\u5c65\u7ea6").catch(() => false);
  await page.waitForTimeout(500);
  const ready = freightLabelVisible || (await scrollLabelIntoView(page, "\u8fd0\u8d39\u6a21\u677f").catch(() => false)) || false;
  if (!ready) {
    throw new Error("Service section freight label is not visible after tab activation.");
  }
}
