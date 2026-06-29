import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
function listTypeScriptFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(filePath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [filePath] : [];
  });
}

const publishModuleFiles = listTypeScriptFiles("src/business/publish-from-spu");
const publishModuleSource = publishModuleFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

assert.ok(
  !/page\.mouse\.click|activePage\.mouse\.click/.test(source),
  "publish flow must use locator/DOM structure actions instead of coordinate mouse clicks"
);

assert.ok(
  !/boundingBox\([\s\S]{0,260}mouse\.click|mouse\.click[\s\S]{0,260}boundingBox\(/.test(source),
  "publish flow must not convert bounding boxes into click coordinates"
);

assert.ok(
  !/dispatchDomClickAtPoint|elementFromPoint\(|page\.mouse\.move|page\.mouse\.click|mouse\.click\(/.test(source),
  "publish flow must not dispatch actions by viewport coordinates; use DOM structure or locators"
);

assert.ok(
  !/page\.mouse\.wheel/.test(publishModuleSource),
  "Doudian publish modules must not use wheel scrolling; use DOM section/label anchors instead"
);

assert.ok(
  !/new MouseEvent\(/.test(publishModuleSource),
  "Doudian publish modules must not synthesize mouse events; use Playwright locators or DOM element click on structurally verified targets"
);

console.log("publish no coordinate clicks rule passed");
