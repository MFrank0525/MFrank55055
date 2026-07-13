import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/business/shop-access-audit.ts", "utf8");

for (const forbidden of [
  "publish-flow",
  "submit-action",
  "publish-submit-page-action",
  "runPublish",
  "/ffa/g/create",
  ".fill(",
  "auto-listing-controller"
]) {
  assert.ok(!source.includes(forbidden), `read-only shop access audit must not depend on ${forbidden}`);
}

assert.match(source, /shop-switch-action\.js/, "shop access audit may reuse only the existing shop-context switching action");
assert.match(source, /publishAttempted:\s*false/, "shop access audit must declare that publishing is never attempted");
assert.match(source, /formMutationAttempted:\s*false/, "shop access audit must declare that form mutation is never attempted");
assert.doesNotMatch(source, /page\.mouse\.click|elementFromPoint|touchscreen|new MouseEvent/);

console.log("shop access module boundaries passed");
