import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  dismissKnownShopSwitchInformationalOverlay,
  selectShopFromDialog,
  waitForChooseShopSurfaceReady
} from "../dist/src/business/publish-from-spu/shop-switch-action.js";

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

  await page.setContent(`
    <style>
      .login-shop-chooser { width: 640px; height: 680px; }
      .list { height: 520px; overflow-y: auto; }
      .card { width: 520px; height: 110px; margin: 16px; }
    </style>
    <main class="login-shop-chooser">
      <h1>请选择店铺</h1>
      <div class="list">
        ${shops.map((shop) => `<div class="card" data-shop="${shop}"><span>${shop}</span><span>子账号 专卖店 正常营业</span></div>`).join("")}
      </div>
    </main>
    <output id="selected"></output>
    <script>
      document.querySelectorAll('.card').forEach((card) => {
        card.addEventListener('click', () => {
          document.querySelector('#selected').textContent = card.dataset.shop;
          document.querySelector('.login-shop-chooser').remove();
        });
      });
    </script>
  `);
  assert.equal(
    await selectShopFromDialog(page, "延草纲目防护用品专卖店"),
    true,
    "the post-login full-page shop chooser must use the same exact-card selection contract"
  );
  assert.equal(await page.locator("#selected").textContent(), "延草纲目防护用品专卖店");

  await page.setContent(`
    <div class="known-overlay">
      <section>
        <h1>平台已为您开通 优质快递服务-平台智能透标模式</h1>
        <button>查看详情</button>
      </section>
      <button class="promotion-close" aria-label="Close">×</button>
    </div>
    <script>
      document.querySelector('.promotion-close').addEventListener('click', () => {
        document.querySelector('.known-overlay').remove();
      });
    </script>
  `);
  assert.equal(await dismissKnownShopSwitchInformationalOverlay(page), true);
  assert.equal(await page.locator(".known-overlay").count(), 0);

  await page.setContent(`
    <style>.shop-chooser-shell { width: 640px; height: 680px; }</style>
    <div role="dialog" class="shop-chooser-shell"><span>加载中</span></div>
    <script>
      setTimeout(() => {
        document.querySelector('.shop-chooser-shell').innerHTML = '<h1>请选择店铺</h1>';
      }, 250);
    </script>
  `);
  assert.equal(
    await waitForChooseShopSurfaceReady(page, 2_000),
    "ready",
    "a visible loading chooser shell must be awaited until its shop list becomes ready"
  );

  await page.setContent('<style>.shop-chooser-shell { width: 640px; height: 680px; }</style><div role="dialog" class="shop-chooser-shell"><span>加载中</span></div>');
  assert.equal(
    await waitForChooseShopSurfaceReady(page, 300),
    "loading",
    "a chooser shell that remains loading must be distinguished from a missing dialog"
  );

  await page.setContent('<main>标品管理</main>');
  assert.equal(
    await waitForChooseShopSurfaceReady(page, 300),
    "absent",
    "a genuinely absent chooser must remain distinct from a loading chooser shell"
  );
} finally {
  await browser.close();
}

console.log("shop switch card action passed");
