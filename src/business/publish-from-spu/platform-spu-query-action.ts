import type { BrowserContext, Page } from "playwright";
import { disconnectAutomationBrowserConnections, launchPersistentBrowser } from "../../browser/launch.js";
import { logInfo, logWarn } from "../../utils/logger.js";
import { PLATFORM_SPU_URL } from "./constants.js";
import type { PlatformSpuQueryRequest, QueryDiagnosticError, QueryMatchCandidate } from "./types.js";
import { ensureShopContext } from "./shop-switch-action.js";
import { recoverUsablePageFromContext } from "./publish-page-readiness.js";
import {
  evaluatePlatformSpuQueryPageReadiness,
  isStablePlatformBrandSelection
} from "./publish-rules.js";
import {
  resolveExactPlatformBrandCandidateSequence,
  selectPlatformSpuPublishCandidate
} from "./platform-spu-query-rules.js";
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
const platformSpuPublishActionAttribute = "data-auto-listing-platform-spu-publish-action";
const platformSpuCreatePageNavigationTimeoutMs = 25000;

interface MarkedPlatformSpuPublishAction {
  selector: string;
  matchingRowCount: number;
  actionableControlCount: number;
}

async function markExactPlatformSpuPublishAction(
  page: Page,
  target: { targetBrand: string; targetSpu: string; rowId: string }
): Promise<MarkedPlatformSpuPublishAction> {
  const marker = `auto-listing-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const result = await page.evaluate(({ targetBrand, targetSpu, rowId, attributeName, markerValue }) => {
    const normalizeSpu = (value: string): string =>
      value.replace(/\s+/g, "").toLowerCase().replace(/械[住注]准/g, "械注准");
    document.querySelectorAll(`[${attributeName}]`).forEach((node) => node.removeAttribute(attributeName));
    const matchingRows = Array.from(document.querySelectorAll("tr")).filter((item) => {
      const rowText = normalizeSpu((item as HTMLElement).innerText || "");
      if (!rowText.includes(targetBrand) || !rowText.includes(targetSpu)) {
        return false;
      }
      if (rowId && !rowText.includes(rowId)) {
        return false;
      }
      const cells = Array.from(item.querySelectorAll("td")).map((cell) =>
        (cell.textContent || "").replace(/\s+/g, " ").trim()
      );
      return cells.some((cell) => normalizeSpu(cell).includes(targetSpu));
    });
    const actionableControls = matchingRows.flatMap((row) => {
      const rowElement = row as HTMLElement;
      const cells = Array.from(row.querySelectorAll("td"));
      const operationCell = (cells[cells.length - 1] as HTMLElement | undefined) || rowElement;
      rowElement.scrollIntoView({ block: "center", inline: "nearest" });
      const nativeControls = Array.from(operationCell.querySelectorAll("button, a"));
      const roleControls = Array.from(operationCell.querySelectorAll("[role='button']"));
      const canonicalControls = nativeControls.length ? nativeControls : roleControls;
      const matchingControls = canonicalControls
        .map((element) => element as HTMLElement)
        .filter((element) => {
          const text = (element.textContent || "").replace(/\s+/g, "").trim();
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const disabled =
            element.hasAttribute("disabled") ||
            element.getAttribute("aria-disabled") === "true" ||
            /disabled/i.test(String(element.className || ""));
          return (
            text === "\u53D1\u5E03\u5546\u54C1" &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            !disabled
          );
        });
      return matchingControls.filter((control) =>
        !matchingControls.some((descendant) => descendant !== control && control.contains(descendant))
      );
    });
    if (matchingRows.length === 1 && actionableControls.length === 1) {
      actionableControls[0].setAttribute(attributeName, markerValue);
    }
    return {
      matchingRowCount: matchingRows.length,
      actionableControlCount: actionableControls.length
    };
  }, {
    ...target,
    attributeName: platformSpuPublishActionAttribute,
    markerValue: marker
  });
  return {
    selector: `[${platformSpuPublishActionAttribute}="${marker}"]`,
    ...result
  };
}

async function waitForPlatformSpuCreatePage(
  context: BrowserContext,
  queryPage: Page,
  existingCreatePages: Set<Page>,
  timeoutMs = platformSpuCreatePageNavigationTimeoutMs
): Promise<Page | null> {
  let observationFinished = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const neverOnFailure = (promise: Promise<Page>): Promise<Page> =>
    promise.catch(() => new Promise<Page>(() => {}));
  const sameTabCreatePage = neverOnFailure(
    queryPage.waitForURL((url) => url.toString().includes("/ffa/g/create"), { timeout: timeoutMs }).then(() => queryPage)
  );
  const popupCreatePage = neverOnFailure(
    context.waitForEvent("page", { timeout: timeoutMs }).then(async (popup) => {
      await popup.waitForURL((url) => url.toString().includes("/ffa/g/create"), { timeout: timeoutMs });
      return popup;
    })
  );
  const contextCreatePage = neverOnFailure((async () => {
    const deadline = Date.now() + timeoutMs;
    while (!observationFinished && Date.now() < deadline) {
      const createPage = context.pages().find((candidate) =>
        !candidate.isClosed() &&
        candidate.url().includes("/ffa/g/create") &&
        !existingCreatePages.has(candidate)
      );
      if (createPage) {
        return createPage;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Platform SPU create page was not observed before navigation timeout.");
  })());
  const timeout = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([sameTabCreatePage, popupCreatePage, contextCreatePage, timeout]);
  } finally {
    observationFinished = true;
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

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

async function discoverExactPlatformBrandOptionIdentities(page: Page, expected: string): Promise<string[]> {
  const candidates = await page.locator(".ecom-g-select-item-option:visible").evaluateAll((options) =>
    options.map((option) => ({
      brandName:
        option.getAttribute("brand_name") ||
        option.getAttribute("label") ||
        option.getAttribute("title") ||
        option.textContent ||
        "",
      optionIdentity: option.getAttribute("standard_brand_id") || ""
    }))
  );
  return resolveExactPlatformBrandCandidateSequence(expected, candidates);
}

async function reacquireExactPlatformBrandOptionIdentities(
  page: Page,
  expectedBrand: string,
  expectedIdentity?: string
): Promise<string[]> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.keyboard.press("Escape").catch(() => {});
    await setPlatformQueryInputValue(page, "brand", expectedBrand);
    await page.waitForTimeout(800 + attempt * 500);
    const identities = await discoverExactPlatformBrandOptionIdentities(page, expectedBrand);
    if (identities.length && (!expectedIdentity || identities.includes(expectedIdentity))) {
      return identities;
    }
  }
  return [];
}

async function clickPlatformBrandDropdownOption(
  page: Page,
  expected: string,
  optionIdentity: string
): Promise<string> {
  const option = page
    .locator(`.ecom-g-select-item-option[standard_brand_id="${optionIdentity}"]:visible`)
    .filter({ hasText: new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
  if (await option.count() !== 1) {
    return "";
  }
  await option.click({ timeout: 5000 });
  return optionIdentity;
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
      const formItems = Array.from(document.querySelectorAll(".ecom-g-form-item"))
        .map((el) => el as HTMLElement)
        .filter((item) => visible(item) && Array.from(item.querySelectorAll(".ecom-g-label-wrapper-label, [class*='label-wrapper-label'], label"))
          .some((label) => (label.textContent || "").replace(/\s+/g, " ").trim() === targetLabel));
      for (const item of formItems) {
        const inputs = Array.from(item.querySelectorAll("input[type='search'], input[role='combobox']"))
          .filter((input) => visible(input as HTMLElement)) as HTMLInputElement[];
        if (inputs.length === 1) {
          return inputs[0];
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
  if (kind === "brand") {
    const focused = await page.evaluate(() => {
      const visible = (el: HTMLElement): boolean => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 80 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
      };
      function findPlatformBrandFieldInput(): HTMLInputElement | null {
        const targetLabel = "品牌";
        const formItems = Array.from(document.querySelectorAll(".ecom-g-form-item"))
          .map((el) => el as HTMLElement)
          .filter((item) => visible(item) && Array.from(item.querySelectorAll(".ecom-g-label-wrapper-label, [class*='label-wrapper-label'], label"))
            .some((label) => (label.textContent || "").replace(/\s+/g, " ").trim() === targetLabel))
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return ar.y - br.y || ar.x - br.x;
          });
        for (const item of formItems) {
          const inputs = Array.from(item.querySelectorAll("input[type='search'], input[role='combobox']"))
            .filter((input) => visible(input as HTMLElement)) as HTMLInputElement[];
          if (inputs.length === 1) {
            return inputs[0];
          }
        }
        return null;
      }
      const target = findPlatformBrandFieldInput();
      if (!target) {
        return false;
      }
      const selector = (target.closest(".ecom-g-select, .ant-select, .semi-select, [class*='select'], [class*='Select']") ||
        target.parentElement) as HTMLElement | null;
      const trigger = (selector?.querySelector(".ecom-g-select-selector, .ant-select-selector, [class*='selector'], [class*='selection']") ||
        selector ||
        target) as HTMLElement;
      trigger.click();
      target.focus();
      return document.activeElement === target;
    });
    if (!focused) {
      return;
    }
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(value, { delay: 60 });
    return;
  }

  await page.evaluate((nextValue) => {
      const visible = (el: HTMLElement): boolean => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 80 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
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

      const target = inputs
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
      target.focus();
      setter?.call(target, "");
      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
      setter?.call(target, nextValue);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
      target.blur();
    }, value);
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
      const formItems = Array.from(document.querySelectorAll(".ecom-g-form-item"))
        .map((el) => el as HTMLElement)
        .filter((item) => visible(item) && Array.from(item.querySelectorAll(".ecom-g-label-wrapper-label, [class*='label-wrapper-label'], label"))
          .some((label) => normalize(label.textContent || "") === targetLabel));
      for (const item of formItems) {
        const inputs = Array.from(item.querySelectorAll("input[type='search'], input[role='combobox']"))
          .filter((input) => visible(input as HTMLElement)) as HTMLInputElement[];
        if (inputs.length === 1) {
          return inputs[0];
        }
      }
      return null;
    }
    const readSelectDisplay = (input: HTMLInputElement | HTMLTextAreaElement): string => {
      let container: HTMLElement | null = null;
      let node = input.parentElement;
      for (let depth = 0; node && depth < 8; depth += 1) {
        if (
          node.classList.contains("ecom-g-select")
          || node.classList.contains("ant-select")
          || node.classList.contains("semi-select")
          || node.getAttribute("role") === "combobox"
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

      return "";
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

async function ensurePlatformSpuTabActive(page: Page, runtimeDir: string): Promise<void> {
  const platformTab = page.getByRole("tab", { name: "\u5E73\u53F0\u6807\u54C1", exact: true });
  const tabCount = await platformTab.count();
  if (tabCount !== 1) {
    const error = new Error(`Platform SPU tab lookup was ambiguous. expected=1; actual=${tabCount}`) as QueryDiagnosticError;
    error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-tab-ambiguous.png");
    throw error;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const selected = await platformTab.getAttribute("aria-selected").catch(() => null);
    if (selected === "true") {
      return;
    }
    await platformTab.click({ timeout: 5000 });
    await page.waitForTimeout(1000 + attempt * 500);
  }

  const selected = await platformTab.getAttribute("aria-selected").catch(() => null);
  if (selected !== "true") {
    const error = new Error(
      `Platform SPU tab did not become active after click. aria-selected=${selected || "<missing>"}`
    ) as QueryDiagnosticError;
    error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-tab-not-active.png");
    throw error;
  }
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
  try {
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
  } finally {
    await disconnectAutomationBrowserConnections();
  }
}

async function readPlatformSpuQueryCandidates(
  page: Page,
  normalizedBrand: string,
  normalizedSpu: string
): Promise<QueryMatchCandidate[]> {
  return page.evaluate(({ targetBrand, targetSpu }: { targetBrand: string; targetSpu: string }) => {
    return Array.from(document.querySelectorAll("tr"))
      .map((row) => {
        const rowEl = row as HTMLElement;
        const cells = Array.from(row.querySelectorAll("td"));
        const operationCell = cells[cells.length - 1] || row;
        const publishButton = Array.from(operationCell.querySelectorAll("button, a, [role='button']"))
          .find((element) => (element.textContent || "").replace(/\s+/g, "").trim() === "\u53D1\u5E03\u5546\u54C1") as HTMLElement | undefined;
        if (!publishButton) return null;
        const rowRect = rowEl.getBoundingClientRect();
        const buttonRect = publishButton.getBoundingClientRect();
        if (rowRect.width <= 0 || rowRect.height <= 0 || buttonRect.width <= 0 || buttonRect.height <= 0) return null;
        const cellTexts = cells.map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
        const normalizeSpu = (value: string): string =>
          value.replace(/\s+/g, "").toLowerCase().replace(/械[住注]准/g, "械注准");
        const rowText = (rowEl.innerText || "").slice(0, 1200);
        const normalizedRowText = normalizeSpu(rowText);
        return {
          rowText,
          normalizedText: normalizedRowText,
          rowId: rowText.match(/ID[:：]\s*(\d+)/)?.[1] || "",
          exactSpuCell: cellTexts.some((cell) => normalizeSpu(cell) === targetSpu),
          exactBrandCell: cellTexts.some((cell) => cell.replace(/\s+/g, "").toLowerCase() === targetBrand),
          rowHasSpu: normalizedRowText.includes(targetSpu),
          rowHasBrand: normalizedRowText.includes(targetBrand),
          publishControlActionable:
            !publishButton.hasAttribute("disabled") &&
            publishButton.getAttribute("aria-disabled") !== "true" &&
            !/disabled/i.test(String(publishButton.className || ""))
        };
      })
      .filter(Boolean);
  }, { targetBrand: normalizedBrand, targetSpu: normalizedSpu }) as Promise<QueryMatchCandidate[]>;
}

async function clickPlatformSpuQueryButton(page: Page, runtimeDir: string): Promise<void> {
  const queryButton = page.getByRole("button", { name: "\u67E5\u8BE2", exact: true });
  const queryClicked = await queryButton.count() === 1
    ? await queryButton.click({ timeout: 5000 }).then(() => true).catch(() => false)
    : false;
  if (!queryClicked) {
    const error = new Error("Visible query button was not unique or clickable.") as QueryDiagnosticError;
    error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-button-missing.png");
    throw error;
  }
  await page.waitForTimeout(2500);
}

export async function queryPlatformSpu(
  runtimeDir: string,
  request: PlatformSpuQueryRequest,
  shopFolder?: string,
  retryNo = 0,
  brandCandidateState?: { identities: string[]; index: number }
): Promise<{
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  createPageUrl: string;
  matchedRowText: string;
}> {
  const context = await launchPersistentBrowser();
  try {
    const { brand, spu } = request;
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

    await ensurePlatformSpuTabActive(page, runtimeDir);

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
        return queryPlatformSpu(runtimeDir, request, shopFolder, retryNo + 1, brandCandidateState);
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

    const discoveredBrandIdentities = await reacquireExactPlatformBrandOptionIdentities(
      page,
      brand,
      brandCandidateState?.identities[brandCandidateState.index]
    );
    const candidateState = brandCandidateState || { identities: discoveredBrandIdentities, index: 0 };
    if (!candidateState.identities.length || candidateState.index >= candidateState.identities.length) {
      const error = new Error(`No exact platform brand candidates found. brand=${brand}`) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-brand-candidates-missing.png");
      throw error;
    }
    const selectedBrandIdentity = candidateState.identities[candidateState.index];
    if (!discoveredBrandIdentities.includes(selectedBrandIdentity)) {
      const error = new Error(
        `Platform brand candidate sequence changed during query. brand=${brand}; expectedIdentity=${selectedBrandIdentity}; available=${discoveredBrandIdentities.join(" | ") || "<none>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-brand-candidate-sequence-changed.png");
      throw error;
    }
    const clickedBrandIdentity = await clickPlatformBrandDropdownOption(page, brand, selectedBrandIdentity).catch(() => "");
    await page.waitForTimeout(800);
    const firstBrandReadback = await readPlatformQueryInputValue(page, "brand");
    await page.waitForTimeout(400);
    const secondBrandReadback = await readPlatformQueryInputValue(page, "brand");
    const brandReadbacks = [firstBrandReadback, secondBrandReadback];
    if (
      clickedBrandIdentity !== selectedBrandIdentity ||
      !isStablePlatformBrandSelection(brand, brandReadbacks)
    ) {
      const error = new Error(
        `Brand candidate selection did not commit. expected=${brand}; expectedIdentity=${selectedBrandIdentity}; clickedIdentity=${clickedBrandIdentity || "<empty>"}; readbacks=${brandReadbacks.map((value) => value || "<empty>").join(" | ")}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-brand-candidate-not-committed.png");
      throw error;
    }
    const brandValueConfirmed = brandReadbacks[brandReadbacks.length - 1] || "";

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

    await page.waitForTimeout(400);
    const brandValueAfterSpu = await readPlatformQueryInputValue(page, "brand");
    if (!isStablePlatformBrandSelection(brand, [brandValueConfirmed, brandValueAfterSpu])) {
      const error = new Error(
        `Brand candidate selection was lost after SPU entry before clicking query. expected=${brand}; expectedIdentity=${selectedBrandIdentity}; beforeSpu=${brandValueConfirmed || "<empty>"}; afterSpu=${brandValueAfterSpu || "<empty>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-brand-lost-after-spu.png");
      throw error;
    }

    const brandSelfCheckOk = isStablePlatformBrandSelection(brand, [brandValueConfirmed, brandValueAfterSpu]);
    const spuSelfCheckOk = normalizeSpuMatchText(spuValueConfirmed).includes(normalizedSpu);
    if (!brandSelfCheckOk || !spuSelfCheckOk) {
      const error = new Error(
        `Platform query self-check failed before clicking query. expectedBrand=${brand}; actualBrand=${brandValueConfirmed || "<empty>"}; expectedSpu=${spu}; actualSpu=${spuValueConfirmed || "<empty>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-pre-query-self-check-failed.png");
      throw error;
    }

    await clickPlatformSpuQueryButton(page, runtimeDir);

    const readCandidates = () => readPlatformSpuQueryCandidates(page, normalizedBrand, normalizedSpu);

    const pickMatchedCandidate = (items: QueryMatchCandidate[]): QueryMatchCandidate | null => {
      const decision = selectPlatformSpuPublishCandidate(items, {
        specificationMatch: request.specificationMatch,
        expectedSpecification: request.expectedSpecification
      });
      return decision.candidateIndex >= 0 ? items[decision.candidateIndex] : null;
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
      matched = pickMatchedCandidate(allCandidates);
    }

    const hasNextBrandCandidate = candidateState.index + 1 < candidateState.identities.length;
    const nextBrandCandidateState = {
      identities: candidateState.identities,
      index: candidateState.index + 1
    };

    if (!allCandidates.length && hasNextBrandCandidate) {
      logWarn(
        `platform brand candidate returned no visible SPU rows; advancing candidate ${candidateState.index + 1}/${candidateState.identities.length}. brand=${brand}; optionIdentity=${selectedBrandIdentity}; spu=${spu}`
      );
      await savePageScreenshot(page, runtimeDir, `platform-spu-brand-candidate-${candidateState.index + 1}-no-rows.png`).catch(() => "");
      return queryPlatformSpu(runtimeDir, request, shopFolder, retryNo, nextBrandCandidateState);
    }

    if (!allCandidates.length) {
      const error = new Error("No visible publish rows found in result table.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-query-no-rows.png");
      throw error;
    }

    if (!matched) {
      const actionableDecision = selectPlatformSpuPublishCandidate(allCandidates, {
        specificationMatch: request.specificationMatch,
        expectedSpecification: request.expectedSpecification
      });
      if (
        actionableDecision.issue.includes("none matched Feishu specification exactly") &&
        hasNextBrandCandidate
      ) {
        logWarn(
          `platform brand candidate had no exact Feishu specification match; advancing candidate ${candidateState.index + 1}/${candidateState.identities.length}. brand=${brand}; optionIdentity=${selectedBrandIdentity}; expectedSpecification=${request.expectedSpecification || "<empty>"}`
        );
        await savePageScreenshot(page, runtimeDir, `platform-spu-brand-candidate-${candidateState.index + 1}-specification-mismatch.png`).catch(() => "");
        return queryPlatformSpu(runtimeDir, request, shopFolder, retryNo, nextBrandCandidateState);
      }
      if (actionableDecision.issue) {
        const error = new Error(actionableDecision.issue) as QueryDiagnosticError;
        error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-publish-row-not-actionable.png");
        error.candidateRows = allCandidates.slice(0, 20).map((item) => item.rowText.slice(0, 300));
        throw error;
      }
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
        return queryPlatformSpu(runtimeDir, request, shopFolder, retryNo + 1, candidateState);
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
    const markedAction = await markExactPlatformSpuPublishAction(page, {
      targetBrand: normalizedBrand,
      targetSpu: normalizedSpu,
      rowId: matched.rowId
    });
    if (markedAction.matchingRowCount !== 1 || markedAction.actionableControlCount !== 1) {
      const error = new Error(
        `Platform SPU publish navigation failed before click: expected one exact row and one actionable publish control; matchingRows=${markedAction.matchingRowCount}; actionableControls=${markedAction.actionableControlCount}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-publish-action-ambiguous.png");
      throw error;
    }
    const createPagePromise = waitForPlatformSpuCreatePage(context, page, existingCreatePages);
    const publishAction = page.locator(markedAction.selector);
    if (await publishAction.count() !== 1) {
      const error = new Error("Platform SPU publish navigation failed before click: marked publish control was not unique.") as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(page, runtimeDir, "platform-spu-publish-action-not-unique.png");
      throw error;
    }
    await publishAction.click({ timeout: 10000 });

    const observedCreatePage = await createPagePromise;
    let activeQueryPage = page;
    if (activeQueryPage.isClosed()) {
      activeQueryPage = await recoverUsablePageFromContext(context, "/ffa/g/spu-record").catch(() => page);
    }
    const newCreatePage =
      context
        .pages()
        .find((item) => item.url().includes("/ffa/g/create") && !existingCreatePages.has(item) && !item.isClosed()) || null;
    const targetPage =
      observedCreatePage ||
      newCreatePage ||
      context.pages().find((item) => !item.isClosed() && item.url().includes("/ffa/g/create")) ||
      (!activeQueryPage.isClosed() && activeQueryPage.url().includes("/ffa/g/create") ? activeQueryPage : null);
    if (!targetPage) {
      const openUrls = context.pages().filter((item) => !item.isClosed()).map((item) => item.url()).join(" | ");
      const error = new Error(
        `Publish page did not open after query click. No new create page was detected. openUrls=${openUrls || "<none>"}`
      ) as QueryDiagnosticError;
      error.screenshotFile = await savePageScreenshot(activeQueryPage, runtimeDir, "platform-spu-publish-navigation-failed.png");
      throw error;
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
