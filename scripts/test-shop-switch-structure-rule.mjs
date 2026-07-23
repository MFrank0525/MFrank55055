import assert from "node:assert/strict";
import fs from "node:fs";

const source = [
  fs.readFileSync("src/business/publish-from-spu.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/shop-switch-action.ts", "utf8")
].join("\n");

function functionBody(name) {
  const match = source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}\\n(?=\\nasync function|\\nfunction|\\ninterface|\\ntype|$)`));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

for (const name of [
  "clickTopRightShopMenu",
  "clickVisibleActionText",
  "clickShopSwitchEntry",
  "recoverTransientShopSwitchError",
  "selectShopFromDialogExact",
  "selectShopFromDialogByVisibleText",
  "selectShopFromDialog",
  "ensureShopContextAttempt",
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
  functionBody("clickVisibleActionText"),
  /match\.click\(\)/,
  "Visible action text fallback must click the matched action instead of only reporting it found"
);
assert.match(
  functionBody("clickShopSwitchEntry"),
  /item\.click\(\)/,
  "Shop switch DOM fallback must click the matched entry instead of only reporting it found"
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
assert.match(
  functionBody("selectShopFromDialogByVisibleText"),
  /const clickTarget = nameNode;[\s\S]*clickTarget\.click\(\)/,
  "Visible-text shop selection must click the exact shop-name node instead of a decorative SVG"
);
assert.match(
  functionBody("selectShopFromDialogExact"),
  /getByText\(expectedShopName, \{ exact: true \}\)[\s\S]*nameNode as HTMLElement\)\.click\(\)/,
  "Exact shop selection fallback must use the exact visible shop text without obsolete hashed classes"
);
assert.match(
  functionBody("selectShopFromDialog"),
  /targetNode\.click\(\)/,
  "Generic shop selection fallback must actually click the matched target instead of only reporting it found"
);
for (const name of ["selectShopFromDialogExact", "selectShopFromDialogByVisibleText", "selectShopFromDialog"]) {
  assert.ok(
    !functionBody(name).includes('querySelectorAll("svg'),
    `${name} must not choose decorative SVG nodes as the shop-card click target`
  );
}
assert.match(
  functionBody("ensureShopContextAttempt"),
  /if \(!dialogVisible\) \{[\s\S]*isDoudianLoginRequired\(page\)[\s\S]*Doudian login required[\s\S]*shop-switch-dialog-missing/,
  "A missing shop switch dialog must be reclassified as login expiry when the page has landed on the Doudian login screen"
);
assert.match(
  functionBody("recoverTransientShopSwitchError"),
  /filter\(\{ hasText: "似乎出现了一些错误" \}\)[\s\S]*getByRole\("button", \{ name: "重试", exact: true \}\)/,
  "Shop switching must scope the exact retry button to the transient Doudian error modal"
);
assert.match(
  functionBody("recoverTransientShopSwitchError"),
  /waitForChooseShopDialog\(page\)[\s\S]*errorDialog\.isVisible/,
  "Transient shop-switch recovery must read back either the chooser dialog or dismissal of the error modal"
);
assert.match(
  functionBody("ensureShopContextAttempt"),
  /if \(!dialogVisible\) \{[\s\S]*recoverTransientShopSwitchError\(page\)/,
  "A missing shop chooser must attempt bounded recovery of the Doudian transient error modal"
);
assert.match(
  functionBody("ensureShopContextAttempt"),
  /if \(!selected\) \{[\s\S]*shop-switch-target-missing\.html[\s\S]*shop-switch-target-missing\.png/,
  "A target-selection failure must retain both DOM and screenshot evidence"
);

console.log("shop switch structure rule passed");
