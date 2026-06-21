import assert from "node:assert/strict";
import fs from "node:fs";

const launchSource = fs.readFileSync("src/browser/launch.ts", "utf8");
const workspaceSection = launchSource.match(/const WORKSPACE_PAGE_SPECS = \[[\s\S]*?\] as const;/)?.[0] || "";

assert.ok(workspaceSection.includes("shop"), "Browser workspace must keep the Doudian shop page.");
assert.equal((workspaceSection.match(/key:/g) || []).length, 1, "Browser workspace must contain only the Doudian shop page.");
assert.match(launchSource, /const DOUYIN_SHOP_URL = "https:\/\/fxg\.jinritemai\.com\/ffa\/g\/spu-record"/);
