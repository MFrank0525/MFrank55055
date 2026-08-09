import type { Locator, Page } from "playwright";

const LABELED_SELECT_CONTROL_SELECTOR = [
  "input[type='search']",
  "input[role='combobox']",
  "[role='combobox']",
  ".ecom-g-select-selector",
  ".ant-select-selector",
  ".semi-select"
].join(", ");

async function findLabeledSelectControl(page: Page, labelText: string): Promise<Locator> {
  const marker = `data-auto-listing-labeled-select-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const count = await page.evaluate(
    ({ targetLabel, controlSelector, markerName }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, " ").replace(/^\*\s*/, "").trim();
      const visible = (node: Element): boolean => {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      document.querySelectorAll(`[${markerName}]`).forEach((node) => node.removeAttribute(markerName));
      const labels = Array.from(document.querySelectorAll("label, span, div"))
        .map((node) => node as HTMLElement)
        .filter((node) => visible(node) && normalize(node.innerText || node.textContent || "") === targetLabel);
      const controls: HTMLElement[] = [];
      for (const label of labels) {
        let root = label.parentElement;
        for (let depth = 0; root && root !== document.body && depth < 6; depth += 1, root = root.parentElement) {
          const candidates = Array.from(root.querySelectorAll(controlSelector))
            .map((node) => node as HTMLElement)
            .filter((node) => visible(node));
          if (candidates.length) {
            const candidate = candidates[0].closest(
              ".ecom-g-select, .ant-select, .semi-select, [class*='select-container'], [class*='select-wrapper']"
            ) as HTMLElement | null;
            controls.push(candidate && visible(candidate) ? candidate : candidates[0]);
            break;
          }
        }
      }
      const unique = controls.filter((node, index, list) => list.indexOf(node) === index);
      if (unique.length === 1) {
        unique[0].setAttribute(markerName, "true");
      }
      return unique.length;
    },
    { targetLabel: labelText, controlSelector: LABELED_SELECT_CONTROL_SELECTOR, markerName: marker }
  );
  if (count !== 1) {
    throw new Error(`Labeled select control must resolve exactly once: label=${labelText}; actual=${count}`);
  }
  return page.locator(`[${marker}="true"]`);
}

export async function readStructuredLabeledSelectValue(page: Page, labelText: string): Promise<string> {
  const control = await findLabeledSelectControl(page, labelText);
  return control.evaluate((node) => {
    const root = node as HTMLElement;
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const input = root.querySelector("input[type='search'], input[role='combobox']") as HTMLInputElement | null;
    return normalize(
      input?.value ||
      (root.querySelector(".ecom-g-select-selection-item, .ant-select-selection-item, .semi-select-selection-text") as HTMLElement | null)
        ?.innerText ||
      root.innerText ||
      ""
    );
  });
}

async function markExactVisibleSelectOption(page: Page, optionText: string): Promise<Locator> {
  const marker = `data-auto-listing-labeled-select-option-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const count = await page.evaluate(
    ({ expectedText, markerName }) => {
      const compact = (value: string): string => value.replace(/\s+/g, "").trim();
      const visible = (node: Element): boolean => {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      document.querySelectorAll(`[${markerName}]`).forEach((node) => node.removeAttribute(markerName));
      const candidates = Array.from(document.querySelectorAll(
        "[role='option'], .ecom-g-select-item-option, .ant-select-item-option, .semi-select-option, [class*='select-option'], li"
      ))
        .map((node) => node as HTMLElement)
        .filter((node) => {
          if (!visible(node)) return false;
          const texts = [node, ...Array.from(node.querySelectorAll("span, div"))]
            .map((item) => compact((item as HTMLElement).innerText || item.textContent || ""))
            .filter(Boolean);
          return texts.includes(compact(expectedText));
        })
        .map((node) => (node.closest(
          "[role='option'], .ecom-g-select-item-option, .ant-select-item-option, .semi-select-option, [class*='select-option'], li"
        ) || node) as HTMLElement)
        .filter((node, index, list) => list.indexOf(node) === index);
      if (candidates.length === 1) {
        candidates[0].setAttribute(markerName, "true");
      }
      return candidates.length;
    },
    { expectedText: optionText, markerName: marker }
  );
  if (count !== 1) {
    throw new Error(`Visible select option must resolve exactly once: option=${optionText}; actual=${count}`);
  }
  return page.locator(`[${marker}="true"]`);
}

export async function chooseExactStructuredLabeledSelectOption(
  page: Page,
  labelText: string,
  optionText: string
): Promise<string> {
  const control = await findLabeledSelectControl(page, labelText);
  await control.scrollIntoViewIfNeeded();
  await control.click({ timeout: 3000 });
  const option = await markExactVisibleSelectOption(page, optionText);
  await option.click({ timeout: 3000 });
  const expected = optionText.replace(/\s+/g, "");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const readback = await readStructuredLabeledSelectValue(page, labelText);
    if (readback.replace(/\s+/g, "") === expected) return readback;
    await page.waitForTimeout(150);
  }
  throw new Error(`Labeled select readback mismatch: label=${labelText}; expected=${optionText}`);
}
