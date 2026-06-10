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

console.log("shop switch structure rule passed");
