import assert from "node:assert/strict";
import fs from "node:fs";

const launchSource = fs.readFileSync("src/browser/launch.ts", "utf8");
const workspaceSection = launchSource.match(/const WORKSPACE_PAGE_SPECS = \[[\s\S]*?\] as const;/)?.[0] || "";

assert.ok(workspaceSection.includes("shop"), "Browser workspace must keep the Doudian shop page.");
assert.ok(!workspaceSection.includes("doubao"), "Browser workspace must not auto-open Doubao after title generation moved to Feishu.");
assert.ok(!workspaceSection.includes("deepseek"), "Browser workspace must not auto-open DeepSeek after poster prompts moved to Feishu.");
assert.ok(!workspaceSection.includes("www.doubao.com"), "Browser workspace must not contain Doubao URL.");
assert.ok(!workspaceSection.includes("chat.deepseek.com"), "Browser workspace must not contain DeepSeek URL.");
