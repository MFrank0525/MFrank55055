import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/cli/feishu-bitable.ts", "utf8");
const authSource = fs.readFileSync("src/feishu/local-auth.ts", "utf8");

assert.match(
  source,
  /function defaultConfigFile\(\): string/,
  "Feishu CLI must choose a default config through an explicit function"
);
assert.match(
  source,
  /fs\.existsSync\(path\.resolve\("input\/feishu-bitable\.config\.json"\)\)/,
  "Feishu CLI must prefer the local real config file when it exists"
);
assert.match(
  source,
  /getArg\(argv,\s*"config",\s*defaultConfigFile\(\)\)/,
  "Feishu CLI default --config must use the real local config before falling back to the example"
);
assert.match(
  authSource,
  /if \(parsed\.auth\?\.appId\?\.trim\(\)\) process\.env\.FEISHU_APP_ID = parsed\.auth\.appId\.trim\(\);/,
  "Feishu local auth loading must not clear an existing FEISHU_APP_ID when config auth is absent"
);
assert.match(
  authSource,
  /if \(parsed\.auth\?\.appSecret\?\.trim\(\)\) process\.env\.FEISHU_APP_SECRET = parsed\.auth\.appSecret\.trim\(\);/,
  "Feishu local auth loading must not clear an existing FEISHU_APP_SECRET when config auth is absent"
);
assert.match(source, /loadLocalFeishuAuthEnv\(args\.configFile\)/, "Feishu CLI must use the shared local auth loader");
assert.match(source, /args\.mode === "schema-audit"/, "Feishu CLI must expose the managed dual-table schema audit");
assert.match(source, /args\.mode === "schema-clean"/, "Feishu CLI must keep schema cleanup explicit");

console.log("feishu bitable local auth rule passed");
