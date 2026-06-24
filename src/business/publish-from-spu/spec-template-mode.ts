import type { Page } from "playwright";

export async function isSpecTemplateSmartFillUploadModeVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const visibleText = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map((el) => normalize(el.innerText || el.textContent || ""))
      .join(" ");

    return (
      visibleText.includes("智能填写助手") &&
      visibleText.includes("切换手动填写") &&
      visibleText.includes("点击 或 拖动 文件到虚线框内上传")
    );
  });
}

export async function clickSwitchManualSpecEntryMode(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const visible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const moduleRoot = Array.from(document.querySelectorAll("body *"))
      .map((el) => el as HTMLElement)
      .filter((el) => {
        if (!visible(el)) {
          return false;
        }
        const text = normalize(el.innerText || el.textContent || "");
        return (
          text.includes("智能填写助手") &&
          text.includes("切换手动填写") &&
          text.includes("点击 或 拖动 文件到虚线框内上传")
        );
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.width * aRect.height - bRect.width * bRect.height;
      })[0];
    const searchRoot = moduleRoot || document.body;
    const target = Array.from(searchRoot.querySelectorAll("button, [role='button'], a, body *"))
      .map((el) => el as HTMLElement)
      .filter((el) => {
        const text = normalize(el.innerText || el.textContent || "");
        return text.includes("切换手动填写") && visible(el);
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return bRect.left - aRect.left || aRect.top - bRect.top;
      })[0];
    if (!target) {
      return false;
    }
    ((target.closest("button, [role='button'], a") as HTMLElement | null) || target).click();
    return true;
  });
}
