import fs from "node:fs";
import path from "node:path";
import { launchPersistentBrowser } from "../dist/src/browser/launch.js";

const runtimeDir = path.resolve(process.cwd(), "data", "shop-switch-inspect");
fs.mkdirSync(runtimeDir, { recursive: true });

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function main() {
  const context = await launchPersistentBrowser();
  try {
    const page =
      context.pages().find((item) => !item.isClosed() && item.url().includes("fxg.jinritemai.com")) ||
      context.pages().find((item) => !item.isClosed()) ||
      (await context.newPage());
    await page.bringToFront();
    await page.goto(
      "https://fxg.jinritemai.com/ffa/g/spu-record?type=create&btm_ppre=a2427.b76571.c902327.d871297&btm_pre=a2427.b39372.c67909.d0",
      { waitUntil: "domcontentloaded" }
    ).catch(() => {});
    await page.waitForTimeout(2500);

    const shopEntry =
      page.getByText(/延草纲目/, { exact: false }).first();
    await shopEntry.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const switchEntry = page.getByText("切换组织/店铺", { exact: true }).first();
    await switchEntry.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1800);

    const info = await page.evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const dialogs = Array.from(document.querySelectorAll("div[role='dialog'], div[aria-modal='true'], .semi-modal, .ant-modal, .ecom-g-modal, [class*='modal']"))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          return {
            text,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            className: String(el.className || ""),
            role: el.getAttribute("role") || "",
            visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
          };
        })
        .filter((item) => item.visible && item.text.includes("请选择店铺"));

      const dialog = Array.from(document.querySelectorAll("body *")).find((el) => {
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

      if (!dialog) {
        return { dialogs, cards: [], html: "" };
      }

      const nodes = Array.from(dialog.querySelectorAll("*"));
      const cards = nodes
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const text = normalize(el.innerText || el.textContent || "");
          if (!text || rect.width < 200 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") {
            return null;
          }
          if (!/(旗舰店|专营店|专卖店)/.test(text)) {
            return null;
          }
          return {
            text,
            tag: el.tagName,
            className: String(el.className || ""),
            role: el.getAttribute("role") || "",
            dataset: { ...el.dataset },
            href: el.getAttribute("href") || "",
            ariaLabel: el.getAttribute("aria-label") || "",
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

      return {
        dialogs,
        cards,
        html: dialog.outerHTML.slice(0, 30000)
      };
    });

    const screenshotFile = path.join(runtimeDir, "shop-switch-dialog.png");
    await page.screenshot({ path: screenshotFile, fullPage: true });
    fs.writeFileSync(path.join(runtimeDir, "shop-switch-dialog.json"), JSON.stringify(info, null, 2), "utf8");
    console.log(JSON.stringify({ runtimeDir, screenshotFile, dialogs: info.dialogs.length, cards: info.cards.length }, null, 2));
  } finally {
    await context.browser()?.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
