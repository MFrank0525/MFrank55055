import assert from "node:assert/strict";
import fs from "node:fs";

const criticalInputActions = [
  "src/business/publish-from-spu/basic-info-page-action.ts",
  "src/business/publish-from-spu/price-inventory-action.ts",
  "src/business/publish-from-spu/platform-spu-query-action.ts",
  "src/business/publish-from-spu/health-food-actions.ts"
];

for (const file of criticalInputActions) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(
    source,
    /Object\.getOwnPropertyDescriptor\([^\n]*["']value["']\)|new InputEvent\(|dispatchEvent\(new Event\(["']change["']/,
    `${file} must commit critical publish values through Playwright locator input semantics`
  );
  assert.match(source, /fillAndCommitLocator/, `${file} must use the shared native form-input action`);
}

const shared = fs.readFileSync("src/business/publish-from-spu/browser-session.ts", "utf8");
assert.match(shared, /locator\.click\(\)/);
assert.match(shared, /locator\.fill\(""\)/);
assert.match(shared, /locator\.fill\(value\)/);
assert.match(shared, /locator\.press\(commitKey\)/);
assert.match(shared, /locator\.inputValue\(\)/);

const { fillAndCommitLocator } = await import("../dist/src/business/publish-from-spu/browser-session.js");
const calls = [];
let currentValue = "";
const locator = {
  async scrollIntoViewIfNeeded() { calls.push("scroll"); },
  async click() { calls.push("click"); },
  async fill(value) { currentValue = value; calls.push(`fill:${value}`); },
  async press(key) { calls.push(`press:${key}`); },
  async inputValue() { calls.push("readback"); return currentValue; }
};
assert.equal(await fillAndCommitLocator(locator, "盒装", "Tab"), "盒装");
assert.deepEqual(calls, ["scroll", "click", "fill:", "fill:盒装", "press:Tab", "readback"]);
await assert.rejects(
  () => fillAndCommitLocator({ ...locator, inputValue: async () => "" }, "盒装", "Tab"),
  /readback mismatch/
);

console.log("publish native form input rule passed");
