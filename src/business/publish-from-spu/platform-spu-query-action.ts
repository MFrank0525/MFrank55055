import type { Page } from "playwright";
import { launchPersistentBrowser } from "../../browser/launch.js";
import { logInfo, logWarn } from "../../utils/logger.js";
import { PLATFORM_SPU_URL } from "./constants.js";
import type { QueryDiagnosticError, QueryMatchCandidate } from "./types.js";
import { clickVisibleText } from "./dom-actions.js";
import { ensureShopContext } from "./shop-switch-action.js";
import { recoverUsablePageFromContext } from "./publish-page-readiness.js";
import { evaluatePlatformSpuQueryPageReadiness } from "./publish-rules.js";
import {
  attachSafeDialogHandler,
  closeCreatePagesExcept,
  closeExtraPages,
  gotoWithTolerance,
  normalizeMatchText,
  normalizeSpuMatchText,
  savePageScreenshot
} from "./browser-session.js";

const maxPlatformSpuQueryRetries = 4;

export async function ensurePlatformSpuPage(runtimeDir: string, shopFolder?: string): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
}> {
  const context = await launchPersistentBrowser();
  try {
    const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage());
    attachSafeDialogHandler(page);
    await page.bringToFront();
    await ensurePlatformSpuQueryPageActive(page, runtimeDir, "platform-spu-entry", 30000);
    if (shopFolder) {
      await ensureShopContext(page, runtimeDir, shopFolder);
      await ensurePlatformSpuQueryPageActive(page, runtimeDir, "platform-spu-entry-after-shop-switch", 45000);
    }

    const screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-entry.png");

    return {
      pageUrl: page.url(),
      pageTitle: await page.title(),
      screenshotFile
    };
  } finally {
    // Keep the shared persistent browser alive. Sequential publish flow may call
    // this helper while another publish page is active in the same profile.
  }
}

export async function clickVisibleDropdownOption(
  page: Page,
  expected: string
): Promise<string> {
  const normalizedExpected = normalizeMatchText(expected);
  return page.evaluate((target) => {
    const elements = Array.from(document.querySelectorAll("body *"));
    const candidates = elements
      .map((el) => {
        const text = (el.textContent || "").trim();
        if (!text) {
          return null;
        }
        const normalizedText = text.replace(/\s+/g, "").trim().toLowerCase();
        if (!normalizedText.includes(target)) {
          return null;
        }
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        const style = window.getComputedStyle(htmlEl);
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.width > window.innerWidth * 0.9 ||
          rect.height > 120 ||
          style.visibility === "hidden" ||
          style.display === "none"
        ) {
          return null;
        }
        const marker = [htmlEl.className, htmlEl.getAttribute("role") || "", htmlEl.tagName].join(" ").toLowerCase();
        const score =
          (marker.includes("option") ? 5 : 0) +
          (marker.includes("select") ? 4 : 0) +
          (marker.includes("dropdown") ? 4 : 0) +
          (marker.includes("menu") ? 3 : 0) +
          (marker.includes("item") ? 2 : 0) +
          (normalizedText === target ? 3 : 0) -
          text.length / 200;
        return {
          el: htmlEl,
          text,
          score
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0));

    const option = candidates[0];
    if (!option) {
      return "";
    }
    const clickable = (option.el.closest("button, [role='button'], a, [role='option'], [role='menuitem']") as HTMLElement | null) || option.el;
    clickable.click();
    return option.text || "";
  }, normalizedExpected);
}

async function clickPlatformBrandDropdownOption(page: Page, expected: string): Promise<string> {
  const normalizedExpected = normalizeMatchText(expected);
  return page.evaluate((target) => {
    const visible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    function findPlatformBrandFieldInput(): HTMLInputElement | null {
      const targetLabel = "品牌";
      const labels = Array.from(document.querySelectorAll(".ecom-g-label-wrapper-label, [class*='label-wrapper-label'], label, div, span"))
        .map((el) => el as HTMLElement)
        .filter((el) => {
          const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          return text === targetLabel && visible(el);
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return ar.y - br.y || ar.x - br.x;
        });
      for (const label of labels) {
        let root: HTMLElement | null = label;
        for (let depth = 0; root && depth < 8; depth += 1) {
          const input = root.querySelector("input[type='search'], input[role='combobox']") as HTMLInputElement | null;
          if (input && visible(input)) {
            return input;
          }
          root = root.parentElement;
        }
      }
      return null;
    }
    const brandInput = findPlatformBrandFieldInput();
    if (!brandInput) {
      return "";
    }
    const brandRect = brandInput.getBoundingClientRect();
    const candidates = Array.from(document.querySelectorAll("body *"))
      .map((el) => {
        const htmlEl = el as HTMLElement;
        const text = (htmlEl.innerText || htmlEl.textContent || "").trim();
        if (!text) {
          return null;
        }
        const normalizedText = text.replace(/\s+/g, "").trim().toLowerCase();
        if (!normalizedText.includes(target)) {
          return null;
        }
        const rect = htmlEl.getBoundingClientRect();
        if (
          !visible(htmlEl) ||
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.height > 120 ||
          rect.top < brandRect.bottom - 20 ||
          rect.left < brandRect.left - 120 ||
          rect.left > brandRect.right + 480
        ) {
          return null;
        }
        const marker = [htmlEl.className, htmlEl.getAttribute("role") || "", htmlEl.tagName].join(" ").toLowerCase();
        const optionLike =
          marker.includes("option") ||
          marker.includes("select") ||
          marker.includes("dropdown") ||
          marker.includes("menu") ||
          marker.includes("item");
        if (!optionLike) {
          return null;
        }
        const exact = normalizedText === target;
        return {
          el: htmlEl,
          text,
          score:
            (exact ? 1000 : 0) +
            (marker.includes("option") ? 120 : 0) +
            (marker.includes("select") ? 80 : 0) +
            (marker.includes("dropdown") ? 80 : 0) +
            (marker.includes("item") ? 40 : 0) -
            Math.abs(rect.top - brandRect.bottom) -
            Math.abs(rect.left - brandRect.left) / 5 -
            text.length / 20
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b!.score || 0) - (a!.score || 0)) as Array<{ el: HTMLElement; text: string; score: number }>;

    const option = candidates[0];
    if (!option) {
      return "";
    }
    const clickable = (option.el.closest("button, [role='button'], a, [role='option'], [role='menuitem']") as HTMLElement | null) || option.el;
    clickable.click();
    return option.text || "";
  }, normalizedExpected);
}

async function isPlatformQueryInputAvailable(page: Page, kind: "brand" | "spu"): Promise<boolean> {
  return page.evaluate((targetKind) => {
    const visible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 80 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
    };
    function findPlatformBrandFieldInput(): HTMLInputElement | null {
      const targetLabel = "品牌";
      const labels = Array.from(document.querySelectorAll(".ecom-g-label-wrapper-label, [class*='label-wrapper-label'], label, div, span"))
        .map((el) => el as HTMLElement)
        .filter((el) => {
          const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          return text === targetLabel && visible(el);
        });
      for (const label of labels) {
        let root: HTMLElement | null = label;
        for (let depth = 0; root && depth < 8; depth += 1) {
          const input = root.querySelector("input[type='search'], input[role='combobox']") as HTMLInputElement | null;
          if (input && visible(input)) {
            return input;
          }
          root = root.parentElement;
        }
      }
      return null;
    }
    const inputs = Array.from(document.querySelectorAll("input, textarea"))
      .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
      .filter((input) => {
        return visible(input as HTMLElement);
      });
    if (targetKind === "brand") {
      return Boolean(findPlatformBrandFieldInput());
    }
    return inputs.some((input) => {
      const context = [
        input.getAttribute("placeholder") || "",
        input.getAttribute("aria-label") || "",
        input.parentElement?.textContent || "",
        input.parentElement?.parentElement?.textContent || ""
      ].join(" ");
      return /SPU/i.test(context);
    });
  }, kind);
}

async function setPlatformQueryInputValue(page: Page, kind: "brand" | "spu", value: string): Promise<void> {
  await page.evaluate(
    ({ targetKind, nextValue }) => {
      const visible = (el: HTMLElement): boolean => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 80 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
      };
      function findPlatformBrandFieldInput(): HTMLInputElement | null {
        const targetLabel = "品牌";
        const labels = Array.from(document.querySelectorAll(".ecom-g-label-wrapper-label, [class*='label-wrapper-label'], label, div, span"))
          .map((el) => el as HTMLElement)
          .filter((el) => {
            const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
            return text === targetLabel && visible(el);
          })
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return ar.y - br.y || ar.x - br.x;
          });
        for (const label of labels) {
          let root: HTMLElement | null = label;
          for (let depth = 0; root && depth < 8; depth += 1) {
            const input = root.querySelector("input[type='search'], input[role='combobox']") as HTMLInputElement | null;
            if (input && visible(input)) {
              return input;
            }
            root = root.parentElement;
          }
        }
        return null;
      }
      const inputs = Array.from(document.querySelectorAll("input, textarea"))
        .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
        .map((input) => {
          const rect = input.getBoundingClientRect();
          if (rect.width <= 80 || rect.height <= 20) {
            return null;
          }
          const context = [
            input.getAttribute("placeholder") || "",
            input.getAttribute("aria-label") || "",
            input.parentElement?.textContent || "",
            input.parentElement?.parentElement?.textContent || ""
          ]
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          return { input, context, y: rect.y, x: rect.x };
        })
        .filter(Boolean) as Array<{ input: HTMLInputElement | HTMLTextAreaElement; context: string; y: number; x: number }>;

      const target =
        targetKind === "brand"
          ? findPlatformBrandFieldInput()
          : inputs
              .map((item) => {
                const input = item.input as HTMLInputElement;
                const score =
                  (/SPU/i.test(item.context) ? 160 : 0) +
                  (/\u540d\u79f0|ID|\u6761\u7801/i.test(item.context) ? 20 : 0) +
                  ((input.getAttribute("type") || "") === "text" ? 10 : 0);
                return { ...item, score };
              })
              .filter((item) => item.score > 0)
              .sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x)[0]?.input;

      if (!target) {
        return;
      }

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (targetKind === "brand") {
        const selector = (target.closest(".ecom-g-select, .ant-select, .semi-select, [class*='select'], [class*='Select']") ||
          target.parentElement) as HTMLElement | null;
        const trigger = (selector?.querySelector(".ecom-g-select-selector, .ant-select-selector, [class*='selector'], [class*='selection']") ||
          selector ||
          target) as HTMLElement;
        trigger.click();
      }
      target.focus();
      setter?.call(target, "");
      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
      setter?.call(target, nextValue);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      if (targetKind === "brand") {
        return;
      }
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
      target.blur();
    },
    { targetKind: kind, nextValue: value }
  );
}

async function readPlatformQueryInputValue(page: Page, kind: "brand" | "spu"): Promise<string> {
  return page.evaluate((targetKind) => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const visible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 80 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
    };
    function findPlatformBrandFieldInput(): HTMLInputElement | null {
      const targetLabel = "品牌";
      const labels = Array.from(document.querySelectorAll(".ecom-g-label-wrapper-label, [class*='label-wrapper-label'], label, div, span"))
        .map((el) => el as HTMLElement)
        .filter((el) => {
          const text = normalize(el.innerText || el.textContent || "");
          return text === targetLabel && visible(el);
        });
      for (const label of labels) {
        let root: HTMLElement | null = label;
        for (let depth = 0; root && depth < 8; depth += 1) {
          const input = root.querySelector("input[type='search'], input[role='combobox']") as HTMLInputElement | null;
          if (input && visible(input)) {
            return input;
          }
          root = root.parentElement;
        }
      }
      return null;
    }
    const readSelectDisplay = (input: HTMLInputElement | HTMLTextAreaElement): string => {
      let container: HTMLElement | null = null;
      let node = input.parentElement;
      for (let depth = 0; node && depth < 8; depth += 1) {
        const marker = [String(node.className || ""), node.getAttribute("role") || "", node.tagName].join(" ").toLowerCase();
        if (
          marker.includes("ecom-g-select") ||
          marker.includes("ant-select") ||
          marker.includes("semi-select") ||
          marker.includes("combobox") ||
          marker.includes("dropdown")
        ) {
          container = node;
          break;
        }
        node = node.parentElement;
      }
      container = container || input.parentElement || null;
      if (!container) {
        return "";
      }

      const selectedNode = container.querySelector(
        ".ecom-g-select-selection-item, .ant-select-selection-item, .semi-select-selection-text, [class*='selection-item'], [class*='selectionItem']"
      ) as HTMLElement | null;
      const selectedText = normalize(selectedNode?.innerText || selectedNode?.textContent || "");
      if (selectedText) {
        return selectedText;
      }

      const ariaValueText = normalize(
        container.getAttribute("aria-valuetext") ||
          input.getAttribute("aria-valuetext") ||
          input.getAttribute("aria-label") ||
          ""
      );
      if (ariaValueText) {
        return ariaValueText;
      }

      const directValue = normalize((input as HTMLInputElement).value || "");
      return directValue;
    };

    const inputs = Array.from(document.querySelectorAll("input, textarea"))
      .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
      .map((input) => {
        const rect = input.getBoundingClientRect();
        if (rect.width <= 80 || rect.height <= 20) {
          return null;
        }
        const context = [
          input.getAttribute("placeholder") || "",
          input.getAttribute("aria-label") || "",
          input.parentElement?.textContent || "",
          input.parentElement?.parentElement?.textContent || ""
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        return { input, context, y: rect.y, x: rect.x };
      })
      .filter(Boolean) as Array<{ input: HTMLInputElement | HTMLTextAreaElement; context: string; y: number; x: number }>;

    const target =
      targetKind === "brand"
        ? findPlatformBrandFieldInput()
        : inputs
            .map((item) => {
              const input = item.input as HTMLInputElement;
              const score =
                (/SPU/i.test(item.context) ? 160 : 0) +
                (/\u540d\u79f0|ID|\u6761\u7801/i.test(item.context) ? 20 : 0) +
                ((input.getAttribute("type") || "") === "text" ? 10 : 0);
              return { ...item, score };
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x)[0]?.input;

    if (!target) {
      return "";
    }
    if (targetKind === "brand") {
      return readSelectDisplay(target);
    }
    return (target.value || "").trim();
  }, kind);
}

async function readPlatformSpuQueryPageSnapshot(page: Page): Promise<{
  url: string;
  bodyText: string;
  visibleInputCount: number;
  brandInputFound: boolean;
  spuInputFound: boolean;
  accountMenuOpen: boolean;
  loading: boolean;
}> {
  return page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const visibleInputs = Array.from(document.querySelectorAll("input, textarea"))
      .map((el) => el as HTMLInputElement | HTMLTextAreaElement)
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        return rect.width > 80 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((input) => {
        const context = [
          input.getAttribute("placeholder") || "",
          input.getAttribute("aria-label") || "",
          input.parentElement?.textContent || "",
          input.parentElement?.parentElement?.textContent || ""
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        return {
          type: input.getAttribute("type") || "",
          role: input.getAttribute("role") || "",
          context
        };
      });
    const brandInputFound = visibleInputs.some((input, index) => {
      if (/品牌|brand/i.test(input.context)) {
        return true;
      }
      return index <= 2 && (input.type === "search" || input.role === "combobox");
    });
    const spuInputFound = visibleInputs.some((input) => /SPU/i.test(input.context));
    const accountMenuOpen =
      bodyText.includes("切换组织/店铺") &&
      bodyText.includes("退出") &&
      bodyText.includes("店铺信息") &&
      bodyText.includes("登录账号");
    const loading = bodyText.includes("加载中") || bodyText.includes("Loading");
    return {
      url: window.location.href,
      bodyText,
      visibleInputCount: visibleInputs.length,
      brandInputFound,
      spuInputFound,
      accountMenuOpen,
      loading
    };
  });
}

async function waitForPlatformSpuQueryPageReady(page: Page, timeoutMs = 45000): Promise<{ ready: boolean; issue: string }> {
  const startedAt = Date.now();
  let lastIssue = "";
  while (Date.now() - startedAt < timeoutMs) {
    const decision = await readPlatformSpuQueryPageSnapshot(page)
      .then((snapshot) => evaluatePlatformSpuQueryPageReadiness(snapshot))
      .catch((error) => ({
        ready: false,
        issue: error instanceof Error ? error.message : String(error)
      }));
    lastIssue = decision.issue;
    if (decision.ready) {
      return decision;
    }
    await page.waitForTimeout(1000);
  }
  return { ready: false, issue: lastIssue || "Platform SPU query page did not become ready before timeout." };
}

async function clickNextPlatformSpuResultPageByDom(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const next = Array.from(document.querySelectorAll("li, button, a, [role='button']"))
      .map((el) => el as HTMLElement)
      .find((el) => {
        const marker = normalize([el.textContent || "", el.getAttribute("title") || "", el.getAttribute("aria-label") || ""].join(" "));
        const className = String(el.className || "");
        const disabled =
          el.getAttribute("aria-disabled") === "true" ||
          el.getAttribute("disabled") === "true" ||
          el.hasAttribute("disabled") ||
          /disabled/i.test(className);
        return !disabled && (marker === "\u4e0b\u4e00\u9875" || marker.includes("\u4e0b\u4e00\u9875"));
      });
    const clickable = (next?.closest("li, button, a, [role='button']") as HTMLElement | null) || next;
    if (!clickable) {
      return false;
    }
    clickable.scrollIntoView({ block: "center", inline: "nearest" });
    clickable.click();
    return true;
  });
}

async function ensurePlatformSpuQueryPageActive(
  page: Page,
  runtimeDir: string,
  label: string,
  timeoutMs = 45000
): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  await gotoWithTolerance(page, PLATFORM_SPU_URL, 3500).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  const decision = await waitForPlatformSpuQueryPageReady(page, timeoutMs);
  if (!decision.ready) {
    if (decision.issue === "Doudian login is required before publishing can continue.") {
      const error = new Error(
        `Doudian login required: open the automation browser and complete Doudian login before publishing can continue.`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, `${label}-doudian-login-required.png`);
      throw error;
    }
    const error = new Error(`Platform SPU query page was not ready after navigation: ${decision.issue}`) as QueryDiagnosticError;
    error.screenshotFile = await savePageScreenshot(page, runtimeDir, `${label}-platform-spu-query-page-not-ready.png`);
    throw error;
  }
}

export async function assertDoudianPublishSessionReady(options: {
  runtimeDir: string;
  timeoutMs?: number;
  label?: string;
}): Promise<void> {
  const context = await launchPersistentBrowser();
  const page =
    context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/spu-record")) ||
    context.pages().find((item) => !item.isClosed() && !item.url().includes("/ffa/g/create")) ||
    (await context.newPage());
  attachSafeDialogHandler(page);
  await closeCreatePagesExcept(context, [page]);
  await page.bringToFront();
  await ensurePlatformSpuQueryPageActive(
    page,
    options.runtimeDir,
    options.label || "doudian-publish-session-preflight",
    options.timeoutMs || 30000
  );
}

export async function queryPlatformSpu(runtimeDir: string, brand: string, spu: string, shopFolder?: string, retryNo = 0): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  createPageUrl: string;
  matchedRowText: string;
}> {
  const context = await launchPersistentBrowser();
  try {
    const normalizedBrand = normalizeMatchText(brand);
    const normalizedSpu = normalizeSpuMatchText(spu);
    const page =
      context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/spu-record")) ||
      context.pages().find((item) => !item.isClosed() && !item.url().includes("/ffa/g/create")) ||
      (await context.newPage());
    attachSafeDialogHandler(page);
    await closeCreatePagesExcept(context, [page]);
    await closeExtraPages(context, [page]);
    await page.bringToFront();
    await ensurePlatformSpuQueryPageActive(page, runtimeDir, "platform-spu-query", 30000);
    if (shopFolder) {
      await ensureShopContext(page, runtimeDir, shopFolder);
      await ensurePlatformSpuQueryPageActive(page, runtimeDir, "platform-spu-query-after-shop-switch", 45000);
    }

    const platformTab = page.getByText("\u5E73\u53F0\u6807\u54C1", { exact: true });
    if (await platformTab.count()) {
      await platformTab.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    const queryPageReady = await waitForPlatformSpuQueryPageReady(page);
    if (!queryPageReady.ready) {
      if (retryNo < maxPlatformSpuQueryRetries) {
        await savePageScreenshot(page, runtimeDir, `platform-spu-query-page-not-ready-retry-${retryNo + 1}.png`).catch(() => "");
        await page.keyboard.press("Escape").catch(() => {});
        let retryPage = page;
        if (retryNo >= 1) {
          const freshPage = await context.newPage();
          attachSafeDialogHandler(freshPage);
          await freshPage.bringToFront().catch(() => {});
          await gotoWithTolerance(freshPage, PLATFORM_SPU_URL, 6500 + retryNo * 1500).catch(() => {});
          await page.close().catch(() => {});
          await closeCreatePagesExcept(context, [freshPage]).catch(() => {});
          await closeExtraPages(context, [freshPage]).catch(() => {});
          retryPage = freshPage;
        } else {
          await gotoWithTolerance(page, PLATFORM_SPU_URL, 5500 + retryNo * 1500).catch(() => {});
        }
        await retryPage.waitForTimeout(2000 + retryNo * 1000);
        return queryPlatformSpu(runtimeDir, brand, spu, shopFolder, retryNo + 1);
      }
      const error = new Error(`Platform SPU query page was not ready after navigation: ${queryPageReady.issue}`) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-page-not-ready.png");
      throw error;
    }

    if (!(await isPlatformQueryInputAvailable(page, "brand").catch(() => false))) {
      const error = new Error("Visible brand input not found.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-brand-input-missing.png");
      throw error;
    }

    if (!(await isPlatformQueryInputAvailable(page, "spu").catch(() => false))) {
      const error = new Error("Visible SPU input not found.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-input-missing.png");
      throw error;
    }

    logInfo(`querying platform spu with brand=${brand}, spu=${spu}`);

    await setPlatformQueryInputValue(page, "brand", brand);
    await page.waitForTimeout(1200);
    let clickedBrandOptionText = await clickPlatformBrandDropdownOption(page, brand).catch(() => "");
    await page.waitForTimeout(800);
    let brandValueConfirmed = await readPlatformQueryInputValue(page, "brand");
    if (!normalizeMatchText(brandValueConfirmed).includes(normalizedBrand)) {
      await setPlatformQueryInputValue(page, "brand", brand);
      await page.waitForTimeout(600);
      clickedBrandOptionText = clickedBrandOptionText || (await clickPlatformBrandDropdownOption(page, brand).catch(() => ""));
      await page.waitForTimeout(800);
      brandValueConfirmed = await readPlatformQueryInputValue(page, "brand");
    }
    if (brandValueConfirmed && !normalizeMatchText(brandValueConfirmed).includes(normalizedBrand)) {
      const error = new Error(
        `Brand input value mismatch after typing. expected=${brand}; actual=${brandValueConfirmed || "<empty>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-brand-value-mismatch.png");
      throw error;
    }
    const brandOptionConfirmed = normalizeMatchText(clickedBrandOptionText).includes(normalizedBrand);
    if (!brandValueConfirmed && !brandOptionConfirmed) {
      const error = new Error(
        `Brand input value mismatch after typing. expected=${brand}; actual=<empty>; selectedOption=${clickedBrandOptionText || "<none>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-brand-value-missing.png");
      throw error;
    }

    await setPlatformQueryInputValue(page, "spu", spu);
    await page.waitForTimeout(300);
    let spuValueConfirmed = await readPlatformQueryInputValue(page, "spu");
    if (!normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu)) {
      await setPlatformQueryInputValue(page, "spu", spu);
      spuValueConfirmed = await readPlatformQueryInputValue(page, "spu");
    }
    if (!normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu)) {
      await setPlatformQueryInputValue(page, "spu", spu);
      await page.waitForTimeout(500);
      spuValueConfirmed = await readPlatformQueryInputValue(page, "spu");
    }
    await page.waitForTimeout(800);
    if (!normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu)) {
      spuValueConfirmed = await readPlatformQueryInputValue(page, "spu");
    }
    if (!normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu)) {
      const error = new Error(
        `SPU input value mismatch after typing. expected=${spu}; actual=${spuValueConfirmed || "<empty>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-input-value-mismatch.png");
      throw error;
    }

    const brandSelfCheckOk = normalizeMatchText(brandValueConfirmed).includes(normalizedBrand) || brandOptionConfirmed;
    const spuSelfCheckOk = normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu);
    if (!brandSelfCheckOk || !spuSelfCheckOk) {
      const error = new Error(
        `Platform query self-check failed before clicking query. expectedBrand=${brand}; actualBrand=${brandValueConfirmed || "<empty>"}; expectedSpu=${spu}; actualSpu=${spuValueConfirmed || "<empty>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-pre-query-self-check-failed.png");
      throw error;
    }

    const queryButton = page.getByRole("button", { name: "\u67E5\u8BE2" });
    let queryClicked = false;
    if (await queryButton.count()) {
      queryClicked = await queryButton.click({ timeout: 5000 }).then(() => true).catch(() => false);
    }
    if (!queryClicked) {
      queryClicked = await clickVisibleText(page, "\u67E5\u8BE2");
    }
    if (!queryClicked) {
      const error = new Error("Visible query button not found or not clickable.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-button-missing.png");
      throw error;
    }
    await page.waitForTimeout(2500);

    const readCandidates = () => page.evaluate(({ targetBrand, targetSpu }: { targetBrand: string; targetSpu: string }) => {
      const rows = Array.from(document.querySelectorAll("tr"));
      return rows
        .map((row) => {
          const rowEl = row as HTMLElement;
          const cells = Array.from(row.querySelectorAll("td"));
          const operationCell = cells[cells.length - 1] || row;
          const publishButton = Array.from(operationCell.querySelectorAll("button, a, [role='button']"))
            .find((el) => ((el.textContent || "").replace(/\s+/g, "").trim() === "\u53D1\u5E03\u5546\u54C1")) as HTMLElement | undefined;
          if (!publishButton) {
            return null;
          }
          const rowRect = rowEl.getBoundingClientRect();
          if (rowRect.width <= 0 || rowRect.height <= 0 || publishButton.getBoundingClientRect().width <= 0 || publishButton.getBoundingClientRect().height <= 0) {
            return null;
          }
          const cellTexts = Array.from(row.querySelectorAll("td"))
            .map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean);
          const normalizeSpu = (value: string): string =>
            value.replace(/\s+/g, "").toLowerCase().replace(/械[住注]准/g, "械注准");
          const normalizedRowText = normalizeSpu(rowEl.innerText || "");
          const exactSpuCell = cellTexts.some((cell) => normalizeSpu(cell) === targetSpu);
          const exactBrandCell = cellTexts.some((cell) => cell.replace(/\s+/g, "").toLowerCase() === targetBrand);
          const rowHasSpu = normalizedRowText.includes(targetSpu);
          const rowHasBrand = normalizedRowText.includes(targetBrand);
          const rowId = rowEl.innerText.match(/ID[:：]\s*(\d+)/)?.[1] || "";
          return {
            rowText: (rowEl.innerText || "").slice(0, 800),
            normalizedText: normalizedRowText,
            rowId,
            exactSpuCell,
            exactBrandCell,
            rowHasSpu,
            rowHasBrand
          };
        })
        .filter(Boolean);
    }, { targetBrand: normalizedBrand, targetSpu: normalizedSpu }) as Promise<QueryMatchCandidate[]>;

    const pickMatchedCandidate = (items: QueryMatchCandidate[]): QueryMatchCandidate | null => {
      const exactMatches = items.filter((item) => item.rowHasSpu && item.rowHasBrand);
      return (
        exactMatches.find((item) => item.exactSpuCell && item.exactBrandCell) ||
        exactMatches.find((item) => item.exactSpuCell) ||
        exactMatches[0] ||
        null
      );
    };

    let candidates = await readCandidates();
    const allCandidates: QueryMatchCandidate[] = [...candidates];
    let matched = pickMatchedCandidate(candidates);
    for (let resultPageNo = 1; !matched && resultPageNo < 8; resultPageNo += 1) {
      const hasSpuRows = candidates.some((item) => item.rowHasSpu);
      if (!hasSpuRows) {
        break;
      }
      const moved = await clickNextPlatformSpuResultPageByDom(page).catch(() => false);
      if (!moved) {
        break;
      }
      await page.waitForTimeout(2200);
      candidates = await readCandidates();
      allCandidates.push(...candidates);
      matched = pickMatchedCandidate(candidates);
    }

    if (!allCandidates.length) {
      const error = new Error("No visible publish rows found in result table.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-no-rows.png");
      throw error;
    }

    if (!matched) {
      const firstRowText = allCandidates[0]?.rowText || "";
      const candidateIds = allCandidates
        .map((item) => item.rowText.match(/ID:(\d+)/)?.[1] || "")
        .filter(Boolean)
        .slice(0, 5);
      const queryLooksUnfiltered = !allCandidates.some((item) => item.normalizedText.includes(normalizedSpu));
      if (queryLooksUnfiltered && retryNo < 2) {
        logWarn(
          `platform spu query returned rows unrelated to requested spu; retrying query ${retryNo + 1}/2. brand=${brand}; spu=${spu}`
        );
        await savePageScreenshot(page, runtimeDir, `platform-spu-query-unfiltered-retry-${retryNo + 1}.png`).catch(() => "");
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(1200);
        return queryPlatformSpu(runtimeDir, brand, spu, shopFolder, retryNo + 1);
      }
      const error = new Error(
        `No queried result row matched brand/spu exactly. brand=${brand}; spu=${spu}; firstRow=${firstRowText.slice(0, 200)}; use input.publishPageUrl to bypass query when you already have a known create page URL.`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-mismatch.png");
      error.candidateRows = allCandidates.slice(0, 20).map((item) => item.rowText.slice(0, 300));
      error.candidateIds = candidateIds;
      throw error;
    }

    const existingCreatePages = new Set(context.pages().filter((item) => item.url().includes("/ffa/g/create")));
    const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await page.evaluate((target) => {
      const normalizeSpu = (value: string): string =>
        value.replace(/\s+/g, "").toLowerCase().replace(/械[住注]准/g, "械注准");
      const rows = Array.from(document.querySelectorAll("tr"));
      const row = rows.find((item) => {
        const rowText = normalizeSpu((item as HTMLElement).innerText || "");
        if (!rowText.includes(target.targetBrand) || !rowText.includes(target.targetSpu)) {
          return false;
        }
        if (target.rowId && !rowText.includes(target.rowId)) {
          return false;
        }
        const cells = Array.from(item.querySelectorAll("td")).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim());
        return cells.some((cell) => normalizeSpu(cell).includes(target.targetSpu));
      }) as HTMLElement | undefined;
      if (!row) {
        return;
      }
      row.scrollIntoView({ block: "center", inline: "nearest" });
      const cells = Array.from(row.querySelectorAll("td"));
      const operationCell = (cells[cells.length - 1] as HTMLElement | undefined) || row;
      const button = Array.from(operationCell.querySelectorAll("button, a, [role='button']"))
        .find((el) => ((el.textContent || "").replace(/\s+/g, "").trim() === "\u53D1\u5E03\u5546\u54C1")) as HTMLElement | undefined;
      button?.click();
    }, { targetBrand: normalizedBrand, targetSpu: normalizedSpu, rowId: matched.rowId });

    const popup = await popupPromise;
    await page.waitForTimeout(6000).catch(() => {});
    let activeQueryPage = page;
    if (activeQueryPage.isClosed()) {
      activeQueryPage = await recoverUsablePageFromContext(context, "/ffa/g/spu-record").catch(() => page);
    }
    const newCreatePage =
      context
        .pages()
        .find((item) => item.url().includes("/ffa/g/create") && !existingCreatePages.has(item) && !item.isClosed()) || null;
    const targetPage =
      popup ||
      newCreatePage ||
      context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/create")) ||
      (!activeQueryPage.isClosed() && activeQueryPage.url().includes("/ffa/g/create") ? activeQueryPage : null);
    if (!targetPage) {
      throw new Error("Publish page did not open after query click. No new create page was detected.");
    }
    attachSafeDialogHandler(targetPage);
    await targetPage.waitForTimeout(4000).catch(() => {});
    await closeExtraPages(context, [targetPage]);
    const createPageUrl = targetPage.url();
    if (!createPageUrl.includes("/ffa/g/create")) {
      throw new Error(`Publish page did not open after query click. Current URL: ${createPageUrl}`);
    }

    const screenshotFile = await savePageScreenshot(targetPage, runtimeDir, "platform-spu-query-result.png");
    const resultPage = activeQueryPage.isClosed() ? targetPage : activeQueryPage;

    return {
      pageUrl: resultPage.url(),
      pageTitle: await resultPage.title().catch(() => targetPage.title()),
      screenshotFile,
      createPageUrl,
      matchedRowText: matched.rowText
    };
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}
