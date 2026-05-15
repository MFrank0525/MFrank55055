import fs from "node:fs";
import path from "node:path";
import type { Download, Locator, Page } from "playwright";
import { launchPersistentBrowser } from "../browser/launch.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMeituPage(url: string): Promise<Page> {
  const context = await launchPersistentBrowser();
  const pages = context.pages().filter((item) => !item.isClosed());
  const page = pages.find((item) => item.url().includes("meitu")) || pages[0] || (await context.newPage());
  await page.bringToFront();
  if (!page.url().includes("meitu")) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } else if (page.url() !== url) {
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  await page.waitForLoadState("domcontentloaded");
  await sleep(3000);
  return page;
}

async function clearUploadedImages(page: Page): Promise<void> {
  const deleteButtons = [
    page.locator('button:has-text("删除")'),
    page.locator('button:has-text("移除")'),
    page.locator('button:has-text("清空")'),
    page.locator('[aria-label*="删除"]'),
    page.locator('[aria-label*="移除"]'),
    page.locator('[class*="delete"]'),
    page.locator('[class*="remove"]'),
    page.locator('[class*="close"]')
  ];

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    let clicked = false;
    for (const locator of deleteButtons) {
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const button = locator.nth(index);
        if (!(await button.isVisible().catch(() => false))) {
          continue;
        }
        await button.click({ delay: 50 }).catch(() => {});
        clicked = true;
        await sleep(200);
      }
    }

    const fileInputs = page.locator('input[type="file"]');
    const inputCount = await fileInputs.count().catch(() => 0);
    for (let index = 0; index < inputCount; index += 1) {
      await fileInputs.nth(index).setInputFiles([]).catch(() => {});
    }

    const previewCount = await page
      .locator("img")
      .evaluateAll((nodes) =>
        nodes.filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 60 && rect.height > 60;
        }).length
      )
      .catch(() => 0);

    if (previewCount === 0) {
      return;
    }

    if (!clicked) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await sleep(2500);
    }
  }

  throw new Error("Meitu old uploaded images were not cleared.");
}

async function uploadImage(page: Page, imagePath: string): Promise<void> {
  const input = page.locator('input[type="file"]').first();
  if ((await input.count()) === 0) {
    throw new Error("Meitu upload input not found.");
  }
  await input.setInputFiles(imagePath);
  await sleep(2500);
}

async function clickFirstVisible(locators: Locator[]): Promise<boolean> {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const target = locator.nth(index);
      if (!(await target.isVisible().catch(() => false))) {
        continue;
      }
      await target.click({ delay: 60 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function openWatermarkPanel(page: Page): Promise<void> {
  const ok = await clickFirstVisible([
    page.locator('button:has-text("水印")'),
    page.locator('div:has-text("水印")'),
    page.locator('[role="tab"]:has-text("水印")'),
    page.locator('[class*="watermark"]')
  ]);
  if (!ok) {
    throw new Error("Meitu watermark panel was not found.");
  }
  await sleep(1500);
}

async function chooseTemplate(page: Page, templateIndex: number): Promise<void> {
  const templateName = String(templateIndex).padStart(2, "0");
  const templateLocators = [
    page.locator(`text="${templateName}"`),
    page.locator(`[title*="${templateName}"]`),
    page.locator(`[aria-label*="${templateName}"]`),
    page.locator(`[data-name*="${templateName}"]`)
  ];
  const ok = await clickFirstVisible(templateLocators);
  if (!ok) {
    throw new Error(`Meitu watermark template ${templateName} was not found.`);
  }
  await sleep(1200);
}

async function softenWatermark(page: Page): Promise<void> {
  const sliderSelectors = [
    'input[type="range"]',
    '[role="slider"]',
    '[class*="slider"]'
  ];
  for (const selector of sliderSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) === 0) {
      continue;
    }

    const handled = await locator
      .evaluate((node) => {
        if (node instanceof HTMLInputElement && node.type === "range") {
          const min = Number(node.min || "0");
          const max = Number(node.max || "100");
          const target = min + (max - min) * 0.12;
          node.value = String(target);
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        return false;
      })
      .catch(() => false);

    if (handled) {
      await sleep(800);
      return;
    }

    await locator.focus().catch(() => {});
    await page.keyboard.press("Home").catch(() => {});
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("ArrowLeft").catch(() => {});
    }
    await sleep(800);
    return;
  }
}

async function triggerExport(page: Page): Promise<Download | null> {
  const buttons = [
    page.locator('button:has-text("保存")'),
    page.locator('button:has-text("下载")'),
    page.locator('button:has-text("导出")'),
    page.locator('[class*="save"]'),
    page.locator('[class*="download"]'),
    page.locator('[class*="export"]')
  ];

  for (const locator of buttons) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const button = locator.nth(index);
      if (!(await button.isVisible().catch(() => false))) {
        continue;
      }
      try {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 15000 }),
          button.click({ delay: 60 })
        ]);
        return download;
      } catch {
        // Continue to the next candidate.
      }
    }
  }

  return null;
}

function uniqueOutputPath(outputDir: string, preferredName: string): string {
  const extension = path.extname(preferredName) || ".png";
  const base = path.basename(preferredName, extension);
  let index = 0;
  while (true) {
    const candidate = path.join(outputDir, index === 0 ? `${base}${extension}` : `${base}-${index}${extension}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

async function saveDownload(download: Download, outputDir: string, imagePath: string): Promise<string> {
  const suggested = download.suggestedFilename() || path.basename(imagePath);
  const target = uniqueOutputPath(outputDir, suggested);
  await download.saveAs(target);
  return target;
}

export async function applyMeituWatermark(options: {
  meituWatermarkUrl: string;
  inputFiles: string[];
  templateIndex: number;
  outputDir: string;
  taskDir: string;
}): Promise<string[]> {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const page = await getMeituPage(options.meituWatermarkUrl);
  const results: string[] = [];

  for (const inputFile of options.inputFiles) {
    await clearUploadedImages(page);
    await uploadImage(page, inputFile);
    await openWatermarkPanel(page);
    await chooseTemplate(page, options.templateIndex);
    await softenWatermark(page);

    const download = await triggerExport(page);
    if (!download) {
      throw new Error(`Meitu did not start a download for ${path.basename(inputFile)}.`);
    }

    const savedFile = await saveDownload(download, options.outputDir, inputFile);
    if (!fs.existsSync(savedFile)) {
      throw new Error(`Meitu watermark output was not saved: ${savedFile}`);
    }
    results.push(savedFile);
    await page.screenshot({
      path: path.join(options.taskDir, `meitu-watermark-${String(options.templateIndex).padStart(2, "0")}-${path.basename(savedFile)}.png`),
      fullPage: true
    }).catch(() => {});
    await sleep(1200);
  }

  return results;
}
