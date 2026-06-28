import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/cli/feishu-bitable.ts", "utf8");

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
  source,
  /if \(parsed\.auth\.appId\?\.trim\(\)\) \{\s*process\.env\.FEISHU_APP_ID = parsed\.auth\.appId\.trim\(\);\s*\}/s,
  "Feishu local auth loading must not clear an existing FEISHU_APP_ID when config auth is absent"
);
assert.match(
  source,
  /if \(parsed\.auth\.appSecret\?\.trim\(\)\) \{\s*process\.env\.FEISHU_APP_SECRET = parsed\.auth\.appSecret\.trim\(\);\s*\}/s,
  "Feishu local auth loading must not clear an existing FEISHU_APP_SECRET when config auth is absent"
);

console.log("feishu bitable local auth rule passed");
