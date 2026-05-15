import { closeBrowser, launchPersistentBrowser, openSearchPage, waitForManualInterventionIfNeeded } from "../browser/launch.js";
import { requireArg } from "./shared.js";

async function main(): Promise<void> {
  const keyword = requireArg("keyword");
  const context = await launchPersistentBrowser();
  try {
    const page = await openSearchPage(context, keyword);
    await waitForManualInterventionIfNeeded(page);
    await page.waitForTimeout(3000);

    const snapshot = await page.evaluate(() => {
      const samples = Array.from(document.querySelectorAll("a[href]"))
        .map((anchor) => {
          const href = anchor.getAttribute("href") || "";
          const text = (anchor.textContent || "").trim().replace(/\s+/g, " ");
          return { href, text };
        })
        .filter((item) => item.href.includes("/product/") || item.href.includes("mall"))
        .slice(0, 30);

      const bodyText = (document.body.innerText || "").slice(0, 2000);
      return {
        title: document.title,
        url: location.href,
        samples,
        bodyPreview: bodyText
      };
    });

    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    await closeBrowser(context);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
