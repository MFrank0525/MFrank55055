import type { Locator, Page } from "playwright";
import { resolveHealthFoodFunctionOptionCandidateGroups } from "./health-food-rules.js";
import type { PublishFromSpuMetadata } from "./types.js";

export interface HealthFoodTextReadbackResult {
  action: "fill_text";
  label: string;
  expectedValue: string;
  readbackValue: string;
  changed: boolean;
  ok: boolean;
}

export interface HealthFoodSelectReadbackResult {
  action: "select_option";
  label: string;
  expectedOption: string;
  readbackValue: string;
  changed: boolean;
  ok: boolean;
}

export interface HealthFoodCheckboxReadbackResult {
  action: "check_health_function";
  label: "保健功能";
  expectedOption: string;
  readbackValue: string;
  checked: boolean;
  ok: boolean;
}

export interface HealthFoodFileUploadReadbackResult {
  action: "upload_file";
  label: string;
  fileCount: number;
  readbackValue: string;
  previewCount: number;
  recognitionDiffDismissed: boolean;
  ok: boolean;
}

export interface HealthFoodSafetyReadbackResult {
  action: "fill_health_food_safety";
  originPackaging: HealthFoodSelectReadbackResult;
  shelfLife: HealthFoodTextReadbackResult;
  storage: HealthFoodSelectReadbackResult;
  manufacturerName: HealthFoodTextReadbackResult;
  manufacturerAddress: HealthFoodTextReadbackResult;
  netContent: HealthFoodTextReadbackResult;
  productStandardCode: HealthFoodTextReadbackResult;
  ingredients: HealthFoodTextReadbackResult;
  ok: boolean;
}

export interface HealthFoodCategoryReadbackResult {
  action: "fill_health_food_category";
  healthFunction: HealthFoodCheckboxReadbackResult;
  ok: boolean;
}

export interface HealthFoodSpecificationReadbackResult {
  action: "apply_health_food_specification";
  groupName: "规格";
  previousValue: string;
  expectedValue: string;
  readbackValue: string;
  ok: boolean;
}

function normalizeDomText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function normalizeDomLabelText(value: string): string {
  return normalizeDomText(value).replace(/^[*＊:：]+/, "");
}

async function readLocatorText(locator: Locator): Promise<string> {
  return locator
    .evaluate((node) => {
      const input = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      return "value" in input ? input.value : (node.textContent || "");
    })
    .then((value) => String(value || "").trim())
    .catch(() => "");
}

async function firstVisible(locator: Locator): Promise<Locator | null> {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) {
      return item;
    }
  }
  return null;
}

async function markFieldRootByVisibleLabel(page: Page, label: string): Promise<string> {
  const marker = `health-food-field-root-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const found = await page.evaluate(
    ({ labelText, markerName }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const normalizeLabel = (value: string): string => normalize(value).replace(/^[*＊:：]+/, "");
      const target = normalize(labelText);
      const targetLabel = normalizeLabel(labelText);
      const isVisible = (element: HTMLElement): boolean => {
        const style = window.getComputedStyle(element);
        return Boolean(element.offsetParent || element === document.body) && style.display !== "none" && style.visibility !== "hidden";
      };
      const isCandidateLabel = (element: HTMLElement): boolean => {
        const text = normalize(element.textContent || "");
        const label = normalizeLabel(element.textContent || "");
        return text === target || label === targetLabel || (label.includes(targetLabel) && label.length <= targetLabel.length + 3);
      };

      const exactFieldRoots = Array.from(document.querySelectorAll("[attr-field-id]"))
        .map((node) => node as HTMLElement)
        .filter(
          (element) =>
            element.getAttribute("attr-field-id") === labelText &&
            isVisible(element) &&
            Boolean(element.querySelector("input, textarea, select, [role='combobox'], [role='checkbox'], input[type='file']"))
        );
      if (exactFieldRoots.length > 0) {
        exactFieldRoots[0].setAttribute(markerName, "true");
        return true;
      }

      const labels = Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .filter((element) => isVisible(element) && isCandidateLabel(element))
        .sort((a, b) => normalize(a.textContent || "").length - normalize(b.textContent || "").length);

      for (const labelNode of labels) {
        const explicitRoot = labelNode.closest("[data-field], [attr-field-id], .semi-form-field, .ant-form-item, .form-item, [class*='formItem'], [class*='FormItem'], [class*='field'], [class*='Field']") as HTMLElement | null;
        const candidates: HTMLElement[] = explicitRoot ? [explicitRoot] : [];
        let parent = labelNode.parentElement;
        while (parent && parent !== document.body && candidates.length < 8) {
          candidates.push(parent);
          parent = parent.parentElement;
        }
        const best = candidates.find(
          (candidate) =>
            isVisible(candidate) &&
            candidate.contains(labelNode) &&
            candidate.querySelector("input, textarea, select, [role='combobox'], [role='checkbox'], input[type='file']")
        );
        if (best) {
          best.setAttribute(markerName, "true");
          return true;
        }
      }
      return false;
    },
    { labelText: label, markerName: marker }
  );
  if (!found) {
    throw new Error(`Health-food field root not found for visible label: ${label}`);
  }
  return marker;
}

export async function findHealthFoodFieldRootByLabel(page: Page, label: string): Promise<Locator> {
  const marker = await markFieldRootByVisibleLabel(page, label);
  return page.locator(`[${marker}="true"]`).first();
}

export async function waitForHealthFoodFieldLabelOnPage(page: Page, label: string): Promise<void> {
  const normalizedLabel = normalizeDomLabelText(label);
  await page.waitForFunction(
    (target) => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const normalizeLabel = (value: string): string => normalize(value).replace(/^[*＊:：]+/, "");
      const isVisible = (element: HTMLElement): boolean => {
        const style = window.getComputedStyle(element);
        return Boolean(element.offsetParent || element === document.body) && style.display !== "none" && style.visibility !== "hidden";
      };
      return Array.from(document.querySelectorAll("body *"))
        .map((node) => node as HTMLElement)
        .some((element) => {
          const text = normalizeLabel(element.textContent || "");
          return isVisible(element) && (text === target || (text.includes(target) && text.length <= target.length + 3));
        });
    },
    normalizedLabel,
    { timeout: 8000 }
  );
}

export async function fillHealthFoodTextFieldOnPage(
  page: Page,
  label: string,
  value: string
): Promise<HealthFoodTextReadbackResult> {
  const fieldRoot = await findHealthFoodFieldRootByLabel(page, label);
  const input = fieldRoot.locator("textarea, input[type='text'], input[type='search'], input:not([type])").first();
  await input.scrollIntoViewIfNeeded().catch(() => {});
  const currentReadback = await input.inputValue({ timeout: 3000 }).catch(() => readLocatorText(input));
  if (normalizeDomText(currentReadback) === normalizeDomText(value)) {
    return {
      action: "fill_text",
      label,
      expectedValue: value,
      readbackValue: currentReadback,
      changed: false,
      ok: true
    };
  }
  await input.fill(value, { timeout: 5000 });
  await input.press("Tab");
  await page.waitForTimeout(3000);
  const readbackValue = await input.inputValue({ timeout: 3000 }).catch(() => readLocatorText(input));
  return {
    action: "fill_text",
    label,
    expectedValue: value,
    readbackValue,
    changed: true,
    ok: normalizeDomText(readbackValue) === normalizeDomText(value)
  };
}

async function exactVisibleOption(page: Page, optionText: string): Promise<Locator> {
  const dropdownOption = page
    .locator(
      [
        "[role='listbox'] [role='option']",
        "[role='option']",
        ".semi-select-option",
        ".semi-select-option-content",
        ".ant-select-item-option",
        ".ecom-g-select-item-option",
        "[class*='dropdown'] [class*='item']",
        "[class*='Dropdown'] [class*='Item']",
        "[class*='menu'] [class*='item']",
        "[class*='Menu'] [class*='Item']"
      ].join(", ")
    )
    .filter({ hasText: optionText });
  const count = await dropdownOption.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const option = dropdownOption.nth(index);
    if (!(await option.isVisible().catch(() => false))) {
      continue;
    }
    const text = normalizeDomText(await option.innerText({ timeout: 500 }).catch(() => ""));
    if (text === normalizeDomText(optionText)) {
      return option;
    }
  }
  throw new Error(`Health-food exact visible option not found: ${optionText}`);
}

async function readHealthFoodSelectedValue(fieldRoot: Locator): Promise<string> {
  const selectedItem = await firstVisible(
    fieldRoot.locator(
      ".ecom-g-select-selection-item, .ant-select-selection-item, .semi-select-selection-text, option:checked"
    )
  );
  if (selectedItem) {
    return readLocatorText(selectedItem);
  }
  const input = await firstVisible(
    fieldRoot.locator("select, input[role='combobox'], input[type='search'], input[type='text']")
  );
  return input ? input.inputValue({ timeout: 1000 }).catch(() => readLocatorText(input)) : "";
}

export async function selectHealthFoodExactOptionOnPage(
  page: Page,
  label: string,
  optionText: string
): Promise<HealthFoodSelectReadbackResult> {
  const fieldRoot = await findHealthFoodFieldRootByLabel(page, label);
  const currentReadback = await readHealthFoodSelectedValue(fieldRoot);
  if (normalizeDomText(currentReadback).includes(normalizeDomText(optionText))) {
    return {
      action: "select_option",
      label,
      expectedOption: optionText,
      readbackValue: currentReadback,
      changed: false,
      ok: true
    };
  }
  const trigger =
    (await firstVisible(fieldRoot.locator("[role='combobox'], .semi-select, .ant-select, [class*='select'], [class*='Select']"))) ||
    fieldRoot.locator("input[type='search'], input[type='text'], input:not([type])").first();
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await trigger.click({ timeout: 5000 });
  const editable = fieldRoot.locator("input[type='search'], input[type='text'], input:not([type])").first();
  if (await editable.isVisible().catch(() => false)) {
    await editable.fill(optionText, { timeout: 2000 }).catch(() => {});
  }
  const option = await exactVisibleOption(page, optionText);
  await option.click({ timeout: 5000 });
  await page.waitForTimeout(3000);
  const readback = await readHealthFoodSelectedValue(fieldRoot);
  return {
    action: "select_option",
    label,
    expectedOption: optionText,
    readbackValue: readback,
    changed: true,
    ok: normalizeDomText(readback).includes(normalizeDomText(optionText))
  };
}

async function selectHealthFoodOptionCandidateOnPage(
  page: Page,
  label: string,
  optionTexts: string[]
): Promise<HealthFoodSelectReadbackResult> {
  let lastError: unknown;
  for (const optionText of optionTexts) {
    try {
      return await selectHealthFoodExactOptionOnPage(page, label, optionText);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Health-food exact visible option not found: ${optionTexts.join(" / ")}`);
}

async function readHealthFoodFieldRootValue(fieldRoot: Locator): Promise<string> {
  const activeInputs = fieldRoot.locator("input:not([type='hidden']), textarea, select");
  const inputCount = await activeInputs.count().catch(() => 0);
  const values: string[] = [];
  for (let index = 0; index < inputCount; index += 1) {
    const input = activeInputs.nth(index);
    const value = await input.inputValue({ timeout: 500 }).catch(() => readLocatorText(input));
    if (value.trim()) {
      values.push(value.trim());
    }
  }
  const visibleText = await fieldRoot.innerText({ timeout: 1000 }).catch(() => "");
  return [...values, visibleText].join(" ").trim();
}

function assertHealthFoodSubModuleCompleted(
  label: string,
  result: { ok: boolean; readbackValue: string }
): void {
  if (!result.ok) {
    throw new Error(`Health-food sub-module failed stable readback: ${label}; readback=${result.readbackValue || "<empty>"}`);
  }
}

async function waitForHealthFoodOuterPackagingRecognitionEvidence(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const recognitionEvidence = await page.evaluate(() => {
      const text = (document.body.innerText || "").replace(/\s+/g, "");
      return text.includes("从商品外包装图识别") || text.includes("商品外包装图识别");
    }).catch(() => false);
    if (recognitionEvidence) {
      return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

export async function checkHealthFunctionOptionOnPage(
  page: Page,
  optionText: string
): Promise<HealthFoodCheckboxReadbackResult> {
  const fieldRoot = await findHealthFoodFieldRootByLabel(page, "保健功能");
  const optionGroups = resolveHealthFoodFunctionOptionCandidateGroups(optionText);
  if (!optionGroups.length) {
    throw new Error(`Health-food 保健功能 checkbox option not found: ${optionText}`);
  }
  const selectedBefore = await fieldRoot.locator(".ecom-g-select-selection-item").allInnerTexts().catch(() => []);
  if (
    optionGroups.every((expectedOptions) =>
      expectedOptions.some((expected) => selectedBefore.some((value) => normalizeDomText(value).includes(normalizeDomText(expected))))
    )
  ) {
    return {
      action: "check_health_function",
      label: "保健功能",
      expectedOption: optionText,
      readbackValue: selectedBefore.join(" "),
      checked: true,
      ok: true
    };
  }
  for (const expectedOptions of optionGroups) {
    const selectedNow = await fieldRoot.locator(".ecom-g-select-selection-item").allInnerTexts().catch(() => []);
    if (expectedOptions.some((expected) => selectedNow.some((value) => normalizeDomText(value).includes(normalizeDomText(expected))))) {
      continue;
    }
    let selectedCandidate = false;
    for (const expectedOption of expectedOptions) {
      const trigger = fieldRoot.locator(".ecom-g-select-selector").first();
      await trigger.scrollIntoViewIfNeeded().catch(() => {});
      await trigger.click({ timeout: 5000 }).catch(async () => {
        await trigger.click({ timeout: 5000, force: true });
      });
      const search = fieldRoot.locator("input[role='combobox']").first();
      await search.fill(expectedOption, { timeout: 5000 });
      const titles = page.locator(".ecom-g-select-tree-title").filter({ hasText: expectedOption });
      let exactTitle: Locator | null = null;
      const titleCount = await titles.count().catch(() => 0);
      for (let index = 0; index < titleCount; index += 1) {
        const title = titles.nth(index);
        if (
          (await title.isVisible().catch(() => false)) &&
          normalizeDomText(await title.innerText({ timeout: 500 }).catch(() => "")) === normalizeDomText(expectedOption)
        ) {
          exactTitle = title;
          break;
        }
      }
      if (!exactTitle) {
        continue;
      }
      const row = exactTitle.locator("xpath=ancestor::div[contains(@class,'ecom-g-select-tree-treenode')][1]");
      const checkbox = row.locator(".ecom-g-select-tree-checkbox").first();
      await checkbox.scrollIntoViewIfNeeded().catch(() => {});
      await checkbox.click({ timeout: 5000 });
      await page.waitForTimeout(3000);
      selectedCandidate = true;
      break;
    }
    if (!selectedCandidate) {
      throw new Error(`Health-food 保健功能 checkbox option not found: ${expectedOptions.join(" / ")}`);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  const selected = await fieldRoot.locator(".ecom-g-select-selection-item").allInnerTexts().catch(() => []);
  const readbackValue = selected.join(" ");
  const checked = optionGroups.every((expectedOptions) =>
    expectedOptions.some((expected) => selected.some((value) => normalizeDomText(value).includes(normalizeDomText(expected))))
  );
  return {
    action: "check_health_function",
    label: "保健功能",
    expectedOption: optionText,
    readbackValue,
    checked,
    ok: checked
  };
}

export async function uploadHealthFoodFileInFieldOnPage(
  page: Page,
  label: string,
  files: string | string[]
): Promise<HealthFoodFileUploadReadbackResult> {
  const selectedFiles = Array.isArray(files) ? files : [files];
  const fieldRoot = await findHealthFoodFieldRootByLabel(page, label);
  const input = fieldRoot.locator("input[type='file']").first();
  await input.setInputFiles(selectedFiles, { timeout: 10000 });

  let acceptedCount = 0;
  let previewCount = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const readback = await fieldRoot.evaluate((root) => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const fieldText = normalize((root as HTMLElement).innerText || root.textContent || "");
      const uploadedCount = Math.max(
        ...Array.from(fieldText.matchAll(/(\d+)\/(?:20|\d+)|已上传(\d+)|上传成功/g)).map((match) =>
          Number(match[1] || match[2] || 0)
        ),
        0
      );
      const fileInputCount = Array.from(root.querySelectorAll("input[type='file']"))
        .map((node) => node as HTMLInputElement)
        .reduce((sum, inputNode) => sum + (inputNode.files?.length || 0), 0);
      const imageEvidenceCount = Array.from(
        root.querySelectorAll("img, video, [class*='preview'], [class*='Preview'], [class*='upload-list'], [class*='UploadList'], [class*='file-list'], [class*='FileList']")
      )
        .map((node) => node as HTMLElement)
        .filter((node) => {
          const style = window.getComputedStyle(node);
          const text = normalize(node.textContent || "");
          return style.display !== "none" && style.visibility !== "hidden" && (node.tagName === "IMG" || node.tagName === "VIDEO" || text.includes("上传成功") || text.includes("预览") || text.includes("删除"));
        }).length;
      return { uploadedCount, fileInputCount, previewCount: imageEvidenceCount };
    });
    acceptedCount = Math.max(readback.uploadedCount, readback.fileInputCount, readback.previewCount);
    previewCount = readback.previewCount;
    if (acceptedCount >= selectedFiles.length) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (acceptedCount < selectedFiles.length && selectedFiles.length > 1) {
    for (const file of selectedFiles) {
      await input.setInputFiles(file, { timeout: 10000 });
      await page.waitForTimeout(500);
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const readback = await fieldRoot.evaluate((root) => {
        const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
        const fieldText = normalize((root as HTMLElement).innerText || root.textContent || "");
        const uploadedCount = Math.max(
          ...Array.from(fieldText.matchAll(/(\d+)\/(?:20|\d+)|已上传(\d+)|上传成功/g)).map((match) =>
            Number(match[1] || match[2] || 0)
          ),
          0
        );
        const fileInputCount = Array.from(root.querySelectorAll("input[type='file']"))
          .map((node) => node as HTMLInputElement)
          .reduce((sum, inputNode) => sum + (inputNode.files?.length || 0), 0);
        const imageEvidenceCount = Array.from(
          root.querySelectorAll("img, video, [class*='preview'], [class*='Preview'], [class*='upload-list'], [class*='UploadList'], [class*='file-list'], [class*='FileList']")
        )
          .map((node) => node as HTMLElement)
          .filter((node) => {
            const style = window.getComputedStyle(node);
            const text = normalize(node.textContent || "");
            return style.display !== "none" && style.visibility !== "hidden" && (node.tagName === "IMG" || node.tagName === "VIDEO" || text.includes("上传成功") || text.includes("预览") || text.includes("删除"));
          }).length;
        return { uploadedCount, fileInputCount, previewCount: imageEvidenceCount };
      });
      acceptedCount = Math.max(readback.uploadedCount, readback.fileInputCount, readback.previewCount);
      previewCount = readback.previewCount;
      if (acceptedCount >= selectedFiles.length) {
        break;
      }
      await page.waitForTimeout(1000);
    }
  }

  return {
    action: "upload_file",
    label,
    fileCount: selectedFiles.length,
    readbackValue: String(acceptedCount),
    previewCount,
    recognitionDiffDismissed: false,
    ok: acceptedCount >= selectedFiles.length
  };
}

export async function fillHealthFoodSafetyAttributesOnPage(
  page: Page,
  metadata: PublishFromSpuMetadata
): Promise<HealthFoodSafetyReadbackResult> {
  const originPackaging = await selectHealthFoodOptionCandidateOnPage(page, "产地与包装", [
    "国产-预包装食品",
    "国产预包装食品"
  ]);
  assertHealthFoodSubModuleCompleted("产地与包装", originPackaging);
  await waitForHealthFoodFieldLabelOnPage(page, "保质期");
  const shelfLife = await fillHealthFoodTextFieldOnPage(page, "保质期", "2");
  assertHealthFoodSubModuleCompleted("保质期", shelfLife);
  await waitForHealthFoodFieldLabelOnPage(page, "生产企业名称");
  const manufacturerName = await fillHealthFoodTextFieldOnPage(page, "生产企业名称", metadata.manufacturerName || "");
  assertHealthFoodSubModuleCompleted("生产企业名称", manufacturerName);
  await waitForHealthFoodFieldLabelOnPage(page, "贮存条件");
  const storage = await selectHealthFoodExactOptionOnPage(page, "贮存条件", "常温");
  assertHealthFoodSubModuleCompleted("贮存条件", storage);
  await waitForHealthFoodFieldLabelOnPage(page, "生产企业地址");
  const manufacturerAddress = await fillHealthFoodTextFieldOnPage(page, "生产企业地址", metadata.manufacturerAddress || "");
  assertHealthFoodSubModuleCompleted("生产企业地址", manufacturerAddress);
  await waitForHealthFoodFieldLabelOnPage(page, "净含量");
  const netContent = await fillHealthFoodTextFieldOnPage(page, "净含量", metadata.netContent || "");
  assertHealthFoodSubModuleCompleted("净含量", netContent);
  await waitForHealthFoodFieldLabelOnPage(page, "产品标准代码");
  const productStandardCode = await fillHealthFoodTextFieldOnPage(page, "产品标准代码", metadata.productStandardCode || "");
  assertHealthFoodSubModuleCompleted("产品标准代码", productStandardCode);
  await waitForHealthFoodFieldLabelOnPage(page, "配料表");
  const ingredients = await fillHealthFoodTextFieldOnPage(page, "配料表", metadata.ingredients || "");
  assertHealthFoodSubModuleCompleted("配料表", ingredients);
  return {
    action: "fill_health_food_safety",
    originPackaging,
    shelfLife,
    storage,
    manufacturerName,
    manufacturerAddress,
    netContent,
    productStandardCode,
    ingredients,
    ok:
      originPackaging.ok &&
      shelfLife.ok &&
      storage.ok &&
      manufacturerName.ok &&
      manufacturerAddress.ok &&
      netContent.ok &&
      productStandardCode.ok &&
      ingredients.ok
  };
}

export async function fillHealthFoodCategoryAttributesOnPage(
  page: Page,
  metadata: PublishFromSpuMetadata
): Promise<HealthFoodCategoryReadbackResult> {
  const healthFunction = await checkHealthFunctionOptionOnPage(page, metadata.healthFunction || "");
  return {
    action: "fill_health_food_category",
    healthFunction,
    ok: healthFunction.ok
  };
}

export async function uploadHealthFoodOuterPackagingOnPage(
  page: Page,
  files: string | string[]
): Promise<HealthFoodFileUploadReadbackResult> {
  try {
    const result = await uploadHealthFoodFileInFieldOnPage(page, "上传外包装图", files);
    if (result.ok) {
      return result;
    }
    const recognitionEvidence = await waitForHealthFoodOuterPackagingRecognitionEvidence(page);
    if (recognitionEvidence) {
      return {
        ...result,
        readbackValue: result.readbackValue || "从商品外包装图识别",
        ok: true
      };
    }
    return result;
  } catch {
    const result = await uploadHealthFoodFileInFieldOnPage(page, "商品外包装图", files);
    if (result.ok) {
      return result;
    }
    const recognitionEvidence = await waitForHealthFoodOuterPackagingRecognitionEvidence(page);
    return recognitionEvidence
      ? {
          ...result,
          readbackValue: result.readbackValue || "从商品外包装图识别",
          ok: true
        }
      : result;
  }
}

interface HealthFoodSpecificationParts {
  firstQuantity: string;
  firstUnit: string;
  secondQuantity: string;
  secondUnit: string;
}

function parseHealthFoodSpecificationParts(value: string): HealthFoodSpecificationParts {
  const normalized = value.replace(/\s+/g, "").trim();
  const match = /^(\d+(?:\.\d+)?)([^\d*×xX]+)[*×xX](\d+(?:\.\d+)?)([^\d*×xX]+)$/.exec(normalized);
  if (!match) {
    throw new Error(`Health-food specification must be a two-part quantity/unit value such as 30粒*1瓶: actual=${value || "<empty>"}`);
  }
  return {
    firstQuantity: match[1],
    firstUnit: match[2],
    secondQuantity: match[3],
    secondUnit: match[4]
  };
}

async function openHealthFoodSpecificationEditor(locator: Locator): Promise<void> {
  await locator.evaluate((node) => {
    const element = node as HTMLElement;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    element.focus();
    for (const eventName of ["mousedown", "mouseup", "click"]) {
      element.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
    }
  });
}

async function applyHealthFoodSpecificationEditorOnPage(
  page: Page,
  parts: HealthFoodSpecificationParts
): Promise<void> {
  const markerBase = `health-food-spec-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fillQuantityOnPage = async (index: number, value: string): Promise<void> => {
    await page.evaluate(({ quantityIndex, quantityValue }) => {
      const normalize = (text: string): string => text.replace(/\s+/g, "").trim();
      const visible = (element: HTMLElement): boolean => {
        const style = window.getComputedStyle(element);
        return Boolean(element.offsetParent) && style.display !== "none" && style.visibility !== "hidden";
      };
      const notHiddenByEcomContainer = (element: HTMLElement): boolean => {
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          const style = window.getComputedStyle(current);
          const className = String(current.className || "");
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            className.includes("ecom-g-popover-hidden") ||
            className.includes("ecom-g-select-dropdown-hidden")
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      const popup = Array.from(document.querySelectorAll(".ecom-g-popover-content"))
        .map((node) => node as HTMLElement)
        .find((element) => notHiddenByEcomContainer(element) && normalize(element.innerText || "").includes("选择规则"));
      if (!popup) {
        throw new Error("Health-food specification split editor popover not found after opening combined value input.");
      }
      const quantityInputs = Array.from(popup.querySelectorAll('input.ecom-g-input[placeholder="请输入"]'))
        .map((node) => node as HTMLInputElement)
        .filter((input) => visible(input) && !input.disabled && !input.readOnly);
      const input = quantityInputs[quantityIndex] || (quantityIndex === 0 ? quantityInputs[0] : undefined);
      if (!input) {
        throw new Error(`Health-food specification split editor missing quantity input index=${quantityIndex}; actual=${quantityInputs.length}`);
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      input.focus();
      setter?.call(input, "");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
      setter?.call(input, quantityValue);
      const tracker = (input as unknown as { _valueTracker?: { setValue: (nextValue: string) => void } })._valueTracker;
      tracker?.setValue("");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: quantityValue, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    }, { quantityIndex: index, quantityValue: value });
  };
  const waitForSecondPartControls = async (): Promise<void> => {
    await page.evaluate(async () => {
      const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const visible = (element: HTMLElement): boolean => {
        const style = window.getComputedStyle(element);
        return Boolean(element.offsetParent) && style.display !== "none" && style.visibility !== "hidden";
      };
      const notHiddenByEcomContainer = (element: HTMLElement): boolean => {
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          const style = window.getComputedStyle(current);
          const className = String(current.className || "");
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            className.includes("ecom-g-popover-hidden") ||
            className.includes("ecom-g-select-dropdown-hidden")
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      const findPopup = (): HTMLElement => {
        const popup = Array.from(document.querySelectorAll(".ecom-g-popover-content"))
          .map((node) => node as HTMLElement)
          .find((element) => notHiddenByEcomContainer(element) && normalize(element.innerText || "").includes("选择规则"));
        if (!popup) {
          throw new Error("Health-food specification split editor popover not found after opening combined value input.");
        }
        return popup;
      };
      const getQuantityInputs = (popup: HTMLElement): HTMLInputElement[] =>
        Array.from(popup.querySelectorAll('input.ecom-g-input[placeholder="请输入"]'))
          .map((node) => node as HTMLInputElement)
          .filter((input) => visible(input) && !input.disabled && !input.readOnly);
      const getUnitSelects = (popup: HTMLElement): HTMLElement[] =>
        Array.from(popup.querySelectorAll(".ecom-g-select"))
          .map((node) => node as HTMLElement)
          .filter((select) => notHiddenByEcomContainer(select))
          .slice(1);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const popup = findPopup();
        if (getQuantityInputs(popup).length >= 2 && getUnitSelects(popup).length >= 2) {
          return;
        }
        await sleep(300);
      }
      const popup = findPopup();
      throw new Error(
        `Health-food specification split editor did not expose second part controls: quantity=${getQuantityInputs(popup).length}; unit=${getUnitSelects(popup).length}`
      );
    });
  };
  const chooseUnit = async (index: number, unitText: string): Promise<void> => {
    const selectMarker = `${markerBase}-unit-select-${index}`;
    const optionMarker = `${markerBase}-unit-option-${index}`;
    const selected = await page.evaluate(({ markerName, unitIndex, expectedUnit }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const notHiddenByEcomContainer = (element: HTMLElement): boolean => {
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          const style = window.getComputedStyle(current);
          const className = String(current.className || "");
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            className.includes("ecom-g-popover-hidden") ||
            className.includes("ecom-g-select-dropdown-hidden")
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      document.querySelectorAll(`[${markerName}]`).forEach((node) => node.removeAttribute(markerName));
      const popup = Array.from(document.querySelectorAll(".ecom-g-popover-content"))
        .map((node) => node as HTMLElement)
        .find((element) => notHiddenByEcomContainer(element) && normalize(element.innerText || "").includes("选择规则"));
      if (!popup) {
        throw new Error("Health-food specification split editor popover not found after opening combined value input.");
      }
      const unitSelects = Array.from(popup.querySelectorAll(".ecom-g-select"))
        .map((node) => node as HTMLElement)
        .filter((select) => notHiddenByEcomContainer(select))
        .slice(1);
      const select = unitSelects[unitIndex] || (unitIndex === 0 ? unitSelects[0] : undefined);
      if (!select) {
        throw new Error(`Health-food specification split editor missing unit selector index=${unitIndex}; actual=${unitSelects.length}`);
      }
      select.setAttribute(markerName, "true");
      const selectedText = normalize(select.innerText || select.textContent || "");
      return selectedText.includes(normalize(expectedUnit));
    }, { markerName: selectMarker, unitIndex: index, expectedUnit: unitText });
    if (selected) {
      return;
    }

    await page.locator(`[${selectMarker}="true"] .ecom-g-select-selector`).first().click({ timeout: 1000 });
    await page.waitForTimeout(200);
    const optionInfo = await page.evaluate(({ markerName, expectedUnit }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const visible = (element: HTMLElement): boolean => {
        const style = window.getComputedStyle(element);
        return Boolean(element.offsetParent) && style.display !== "none" && style.visibility !== "hidden";
      };
      const notHiddenByEcomContainer = (element: HTMLElement): boolean => {
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          const style = window.getComputedStyle(current);
          const className = String(current.className || "");
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            className.includes("ecom-g-popover-hidden") ||
            className.includes("ecom-g-select-dropdown-hidden")
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      document.querySelectorAll(`[${markerName}]`).forEach((node) => node.removeAttribute(markerName));
      const optionSelector = [
        ".ecom-g-select-dropdown .ecom-g-select-item-option",
        ".ecom-g-select-item-option",
        "[role='listbox'] [role='option']",
        "[role='option']"
      ].join(", ");
      const options = Array.from(document.querySelectorAll(optionSelector))
        .map((node) => node as HTMLElement)
        .filter((item) => visible(item) && notHiddenByEcomContainer(item));
      const option = options.find((item) => normalize(item.innerText || item.textContent || "") === normalize(expectedUnit));
      if (!option) {
        return {
          found: false,
          visibleOptions: Array.from(new Set(options.map((item) => normalize(item.innerText || item.textContent || "")).filter(Boolean))).join("/")
        };
      }
      option.setAttribute(markerName, "true");
      return { found: true, visibleOptions: "" };
    }, { markerName: optionMarker, expectedUnit: unitText });
    if (!optionInfo.found) {
      throw new Error(`Health-food specification unit option not found: ${unitText}; visible=${optionInfo.visibleOptions || "<none>"}`);
    }
    await page.locator(`[${optionMarker}="true"]`).first().click({ timeout: 3000 }).catch(async () => {
      await page.locator(`[${optionMarker}="true"]`).first().click({ timeout: 3000, force: true });
    });
    await page.waitForTimeout(200);
    const selectedText = await page.evaluate(({ markerName, unitIndex }) => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const notHiddenByEcomContainer = (element: HTMLElement): boolean => {
        let current: HTMLElement | null = element;
        while (current && current !== document.body) {
          const style = window.getComputedStyle(current);
          const className = String(current.className || "");
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            className.includes("ecom-g-popover-hidden") ||
            className.includes("ecom-g-select-dropdown-hidden")
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      const markedSelect = document.querySelector(`[${markerName}="true"]`) as HTMLElement | null;
      const popup = Array.from(document.querySelectorAll(".ecom-g-popover-content"))
        .map((node) => node as HTMLElement)
        .find((element) => notHiddenByEcomContainer(element) && normalize(element.innerText || "").includes("选择规则"));
      const unitSelects = Array.from(popup?.querySelectorAll(".ecom-g-select") || [])
        .map((node) => node as HTMLElement)
        .filter((select) => notHiddenByEcomContainer(select))
        .slice(1);
      const select = markedSelect || unitSelects[unitIndex] || null;
      return normalize(select?.innerText || select?.textContent || "");
    }, { markerName: selectMarker, unitIndex: index });
    if (!selectedText.includes(unitText.replace(/\s+/g, "").trim())) {
      throw new Error(`Health-food specification unit option click did not stick: expected=${unitText}; actual=${selectedText || "<empty>"}`);
    }
  };

  await fillQuantityOnPage(0, parts.firstQuantity);
  await chooseUnit(0, parts.firstUnit);
  await waitForSecondPartControls();
  await fillQuantityOnPage(0, parts.firstQuantity);
  await fillQuantityOnPage(1, parts.secondQuantity);
  await chooseUnit(1, parts.secondUnit);
  await fillQuantityOnPage(0, parts.firstQuantity);
  await fillQuantityOnPage(1, parts.secondQuantity);
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur();
  });

}

export async function applyHealthFoodSpecificationOnPage(
  page: Page,
  metadata: Pick<PublishFromSpuMetadata, "specification">
): Promise<HealthFoodSpecificationReadbackResult> {
  const fieldRoot = await findHealthFoodFieldRootByLabel(page, "商品规格");
  const expectedSpecification = metadata.specification?.trim() || "";
  if (!expectedSpecification) {
    throw new Error("Missing required health-food metadata fields: specification");
  }
  const parts = parseHealthFoodSpecificationParts(expectedSpecification);

  const marker = `health-food-full-specification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const discovery = await fieldRoot.evaluate((root, markerName) => {
    const visible = (element: HTMLElement): boolean => {
      const style = window.getComputedStyle(element);
      return Boolean(element.offsetParent) && style.display !== "none" && style.visibility !== "hidden";
    };
    const specificationValues = root.querySelector("#skuValue-规格");
    if (!specificationValues) {
      return { groupName: "", editableValueInputs: 0, populatedValueInputs: 0, targetIndex: -1 };
    }
    const group = specificationValues.closest(".style_contentBox__o1y6B") as HTMLElement | null;
    const groupName = Array.from(group?.querySelectorAll("[class*='specName']") || [])
      .map((node) => (node.textContent || "").replace(/\s+/g, "").trim())
      .find(Boolean) || "";
    const editableValueInputs = Array.from(
      specificationValues.querySelectorAll('input[placeholder="填写并新增规格值"]')
    )
      .map((node) => node as HTMLInputElement)
      .filter(
        (input) =>
          visible(input) &&
          !input.disabled &&
          !input.readOnly &&
          input.type === "text"
      );
    const populatedValueInputs = editableValueInputs.filter((input) => (input.value || "").trim());
    const target = populatedValueInputs[0] || editableValueInputs[0] || null;
    const targetIndex = target ? editableValueInputs.indexOf(target) : -1;
    if (groupName === "规格" && target) {
      target.setAttribute(markerName, "true");
    }
    return {
      groupName,
      editableValueInputs: editableValueInputs.length,
      populatedValueInputs: populatedValueInputs.length,
      targetIndex
    };
  }, marker);
  if (discovery.groupName !== "规格") {
    throw new Error(
      `Health-food full specification input must belong to exact group 规格: actual=${discovery.groupName || "<empty>"}`
    );
  }
  if (discovery.targetIndex < 0) {
    throw new Error(
      `Health-food 商品规格 must expose a populated template value input or editable fallback in group 规格: editable=${discovery.editableValueInputs}; populated=${discovery.populatedValueInputs}`
    );
  }

  const specificationInput = fieldRoot.locator(`[${marker}="true"]`).first();
  await specificationInput.scrollIntoViewIfNeeded().catch(() => {});
  const previousValue = await specificationInput.inputValue({ timeout: 3000 });
  if (normalizeDomText(previousValue) === normalizeDomText(expectedSpecification)) {
    return {
      action: "apply_health_food_specification",
      groupName: "规格",
      previousValue,
      expectedValue: expectedSpecification,
      readbackValue: previousValue,
      ok: true
    };
  }
  await openHealthFoodSpecificationEditor(specificationInput);
  await applyHealthFoodSpecificationEditorOnPage(page, parts);
  await page.waitForTimeout(3000);
  const readbackValue = await specificationInput.inputValue({ timeout: 3000 });
  return {
    action: "apply_health_food_specification",
    groupName: "规格",
    previousValue,
    expectedValue: expectedSpecification,
    readbackValue,
    ok: normalizeDomText(readbackValue) === normalizeDomText(expectedSpecification)
  };
}

export async function uploadHealthFoodPackagingLabelOnPage(
  page: Page,
  files: string | string[]
): Promise<HealthFoodFileUploadReadbackResult> {
  const selectedFiles = Array.isArray(files) ? files : [files];
  const fieldRoot = await findHealthFoodFieldRootByLabel(page, "包装标签图");
  const input = fieldRoot.locator("input[type='file']").first();
  await input.setInputFiles(selectedFiles, { timeout: 10000 });

  let acceptedCount = 0;
  let previewCount = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const readback = await fieldRoot.evaluate((root) => {
      const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
      const fieldText = normalize((root as HTMLElement).innerText || root.textContent || "");
      const uploadedCount = Number(/(\d+)\/20/.exec(fieldText)?.[1] || 0);
      const fileInputCount = Array.from(root.querySelectorAll("input[type='file']"))
        .map((node) => node as HTMLInputElement)
        .reduce((sum, inputNode) => sum + (inputNode.files?.length || 0), 0);
      const imageEvidenceCount = Array.from(
        root.querySelectorAll("img, video, [class*='preview'], [class*='Preview'], [class*='upload-list'], [class*='UploadList'], [class*='file-list'], [class*='FileList']")
      )
        .map((node) => node as HTMLElement)
        .filter((node) => {
          const style = window.getComputedStyle(node);
          const text = normalize(node.textContent || "");
          return style.display !== "none" && style.visibility !== "hidden" && (node.tagName === "IMG" || node.tagName === "VIDEO" || text.includes("上传成功") || text.includes("预览") || text.includes("删除"));
        }).length;
      return {
        uploadedCount,
        fileInputCount,
        previewCount: imageEvidenceCount
      };
    });
    acceptedCount = Math.max(readback.uploadedCount, readback.fileInputCount, readback.previewCount);
    previewCount = readback.previewCount;
    if (acceptedCount >= selectedFiles.length) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  return {
    action: "upload_file",
    label: "包装标签图",
    fileCount: selectedFiles.length,
    readbackValue: String(acceptedCount),
    previewCount,
    recognitionDiffDismissed: false,
    ok: acceptedCount >= selectedFiles.length
  };
}
