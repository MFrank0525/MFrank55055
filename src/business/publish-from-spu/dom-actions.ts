import type { Page } from "playwright";

export async function clickVisibleText(page: Page, text: string): Promise<boolean> {
  const target = page.getByText(text, { exact: true }).first();
  if (!(await target.count())) {
    return false;
  }
  return target.click({ timeout: 3000 }).then(() => true).catch(() => false);
}

export async function clickRadioByLabel(page: Page, labelText: string): Promise<boolean> {
  const radio = page.getByRole("radio", { name: labelText }).first();
  if (await radio.count()) {
    await radio.click({ timeout: 3000 }).catch(() => {});
    return true;
  }

  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const label = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (!text || text !== targetLabel || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { el, rect };
      })
      .filter(Boolean)
      .sort((a, b) => (a?.rect.top || 0) - (b?.rect.top || 0))[0];
    if (!label) {
      return false;
    }

    const candidates = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.top < label.rect.top - 24 ||
          rect.top > label.rect.bottom + 24 ||
          rect.left < label.rect.left - 60 ||
          rect.left > label.rect.left + 10
        ) {
          return null;
        }
        const score =
          (marker.includes("radio") ? 200 : 0) +
          (el.getAttribute("aria-checked") ? 60 : 0) -
          Math.abs(rect.left - label.rect.left) -
          Math.abs(rect.top - label.rect.top);
        return score > 0 ? { el, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))[0];

    if (!candidates) {
      return false;
    }
    candidates.el.click();
    return true;
  }, labelText);
}

export async function isRadioSelectedByLabel(page: Page, labelText: string): Promise<boolean> {
  return page.evaluate((targetLabel) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const elements = Array.from(document.querySelectorAll("body *")).map((el) => el as HTMLElement);
    const labels = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || "");
        if (text !== targetLabel || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
          return null;
        }
        return { el, rect };
      })
      .filter(Boolean) as Array<{ el: HTMLElement; rect: DOMRect }>;

    for (const label of labels) {
      const candidates = elements
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            rect.top < label.rect.top - 24 ||
            rect.top > label.rect.bottom + 24 ||
            rect.left < label.rect.left - 80 ||
            rect.left > label.rect.left + 20
          ) {
            return null;
          }
          const input = el as HTMLInputElement;
          const marker = [String(el.className || ""), el.getAttribute("role") || "", el.tagName].join(" ").toLowerCase();
          const checked = input.checked === true || el.getAttribute("aria-checked") === "true" || marker.includes("checked");
          const score = (marker.includes("radio") ? 200 : 0) - Math.abs(rect.left - label.rect.left) - Math.abs(rect.top - label.rect.top);
          return score > 0 ? { checked, score } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (b?.score || 0) - (a?.score || 0));
      if (candidates[0]?.checked) {
        return true;
      }
    }
    return false;
  }, labelText);
}

export async function dismissTransientOverlays(page: Page): Promise<void> {
  if (page.isClosed()) {
    return;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.isClosed()) {
      return;
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
  }

  const cropDialogVisible = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return text.includes("\u667a\u80fd\u88c1\u526a\u4e3a3:4\u4e3b\u56fe") || text.includes("\u5f53\u524d\u8fd8\u67093\u5f20\u56fe\u7247\u4e0d\u662f3:4\u6bd4\u4f8b");
  });
  if (cropDialogVisible && (await clickVisibleText(page, "\u53d6\u6d88"))) {
    if (page.isClosed()) {
      return;
    }
    await page.waitForTimeout(1000);
  }

  const clicked = await page.evaluate(() => {
    const modalTitles = ["\u0041\u0049\u7d20\u6750\u5de5\u5177", "\u0041\u0049\u52a9\u624b"];
    const titleNode = Array.from(document.querySelectorAll("body *")).find((el) => {
      const text = (el.textContent || "").trim();
      if (!modalTitles.includes(text)) {
        return false;
      }
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) as HTMLElement | undefined;

    if (!titleNode) {
      return false;
    }

    const panel = (titleNode.closest("[role='dialog']") ||
      titleNode.closest(".semi-modal, .semi-portal, .semi-drawer, .auxo-modal")) as HTMLElement | null;
    const root = panel || (titleNode.parentElement?.parentElement as HTMLElement | null);
    if (!root) {
      return false;
    }

    const rootRect = root.getBoundingClientRect();
    const closeCandidates = Array.from(root.querySelectorAll("button, [role='button'], span, div"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || "").trim();
        const marker = [text, el.getAttribute("aria-label") || "", el.getAttribute("title") || "", String(el.className || "")]
          .join(" ")
          .toLowerCase();
        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        if (rect.x < rootRect.x + rootRect.width * 0.7 || rect.y > rootRect.y + rootRect.height * 0.2) {
          return null;
        }
        const isCloseControl =
          text === "\u00d7" || text === "×" || /close|icon-close|semi-icon-close|ai-content_tomini/.test(marker);
        if (!isCloseControl) {
          return null;
        }
        return {
          el,
          x: rect.x,
          y: rect.y,
          score: (text === "\u00d7" || text === "×" ? 500 : 0) + rect.x - rect.y
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    const target = closeCandidates[0]?.el || null;
    target?.click();
    return Boolean(target);
  });

  if (clicked) {
    if (page.isClosed()) {
      return;
    }
    await page.waitForTimeout(1200);
  }

  const closedAiAssistant = await page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    if (!bodyText.includes("\u0041\u0049\u52a9\u624b")) {
      return false;
    }

    const candidates = Array.from(document.querySelectorAll("button, [role='button'], span, div, svg"))
      .map((el) => el as HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || "").trim();
        const marker = [text, el.getAttribute("aria-label") || "", el.getAttribute("title") || "", String(el.className || "")]
          .join(" ")
          .toLowerCase();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.left < window.innerWidth * 0.55 ||
          rect.top > 220 ||
          rect.width > 90 ||
          rect.height > 90
        ) {
          return null;
        }
        const isCloseControl = text === "\u00d7" || text === "×" || /close|icon-close|semi-icon-close/.test(marker);
        if (!isCloseControl) {
          return null;
        }
        return {
          el,
          score: rect.right + (text === "\u00d7" || text === "×" ? 500 : 0) - Math.abs(rect.top - 110)
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    const target = candidates[0]?.el || null;
    if (!target) {
      return false;
    }
    target.click();
    return true;
  });

  if (closedAiAssistant) {
    await page.waitForTimeout(1200);
  }
}
