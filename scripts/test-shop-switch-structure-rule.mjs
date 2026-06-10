import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");

function functionBody(name) {
  const match = source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}\\n(?=\\nasync function|\\nfunction|\\ninterface|\\ntype|$)`));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

for (const name of [
  "clickTopRightShopMenu",
  "clickVisibleActionText",
  "clickShopSwitchEntry",
  "selectShopFromDialogExact",
  "selectShopFromDialogByVisibleText",
  "selectShopFromDialog",
  "ensureShopContext"
]) {
  const body = functionBody(name);
  assert.ok(!body.includes("page.mouse.click"), `${name} must not use coordinate mouse clicks for shop switching`);
  assert.ok(!body.includes("boundingBox("), `${name} must not derive coordinates from bounding boxes for shop switching`);
}

assert.match(
  functionBody("clickTopRightShopMenu"),
  /headerShopName/,
  "Top-right shop menu opening must target the Doudian header shop-name structure"
);
assert.match(
  functionBody("clickTopRightShopMenu"),
  /locator\(/,
  "Top-right shop menu opening must prefer a structural Playwright locator before DOM fallbacks"
);
assert.match(
  functionBody("clickShopSwitchEntry"),
  /getByText\("切换组织\/店铺", \{ exact: true \}\)/,
  "Shop switching must click the visible structural text entry for 切换组织/店铺"
);
assert.match(
  source,
  /isNavigationContextDestroyedError/,
  "Shop switching must treat navigation-destroyed evaluate contexts as a recoverable navigation signal"
);
assert.match(
  functionBody("waitForChooseShopDialog"),
  /isNavigationContextDestroyedError/,
  "Waiting for the shop dialog must not fail when selecting a shop destroys the old execution context"
);
assert.match(
  functionBody("selectShopFromDialogByVisibleText"),
  /isNavigationContextDestroyedError/,
  "Shop selection must not report target missing when a successful click immediately navigates"
);

console.log("shop switch structure rule passed");
