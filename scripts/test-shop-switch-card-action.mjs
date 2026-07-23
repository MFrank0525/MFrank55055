import assert from "node:assert/strict";
import { chromium } from "playwright";
import { selectShopFromDialog } from "../dist/src/business/publish-from-spu/shop-switch-action.js";

const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage();
  const shops = [
    "延草纲目防护用品专卖店",
    "延草纲目身体护理专卖店",
    "延草纲目营养膳食专卖店"
  ];
  await page.setContent(`
    <style>
      [role=dialog] { width: 640px; height: 680px; }
      .list { height: 520px; overflow-y: auto; }
      .card { width: 520px; height: 110px; margin: 16px; }
      svg { width: 24px; height: 24px; float: right; }
    </style>
    <div role="dialog">
      <h1>请选择店铺</h1>
      <div class="list">
        ${shops.map((shop) => `<div class="card" data-shop="${shop}"><span>${shop}</span><svg viewBox="0 0 10 10"><path d="M1 1 L9 5 L1 9"/></svg></div>`).join("")}
      </div>
    </div>
    <output id="selected"></output>
    <script>
      document.querySelectorAll('.card').forEach((card) => {
        card.addEventListener('click', () => {
          document.querySelector('#selected').textContent = card.dataset.shop;
          document.querySelector('[role=dialog]').remove();
        });
      });
      document.querySelectorAll('svg').forEach((svg) => {
        svg.addEventListener('click', (event) => event.stopPropagation());
      });
    </script>
  `);

  const selected = await selectShopFromDialog(page, "延草纲目身体护理专卖店");
  assert.equal(selected, true, "visible exact shop card must be selected");
  assert.equal(await page.locator("#selected").textContent(), "延草纲目身体护理专卖店");
} finally {
  await browser.close();
}

console.log("shop switch card action passed");
