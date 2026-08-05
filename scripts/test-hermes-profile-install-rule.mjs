import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  enableAutoListingPlugin,
  removeObsoleteAutoListingPlaintextCoercionFile,
  removeObsoleteAutoListingPlaintextCoercionSource,
} from "./hermes-profile-install-rules.mjs";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const runtimeBasePath =
  "/Users/mfrank/.local/share/uv/tools/hermes-agent/lib/python3.11/site-packages/gateway/platforms/base.py";
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "listing-profile-install-rule-"));
const couponProfile = path.join(temporaryRoot, "doudian-coupon");
fs.mkdirSync(couponProfile, { recursive: true });
const couponConfigPath = path.join(couponProfile, "config.yaml");
fs.writeFileSync(couponConfigPath, "coupon-profile-sentinel\n");

const digest = (filePath) =>
  crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const couponBefore = digest(couponConfigPath);
const runtimeBefore = digest(runtimeBasePath);
const rejected = childProcess.spawnSync(
  process.execPath,
  ["scripts/install-hermes-profile.mjs"],
  {
    cwd: projectRoot,
    env: { ...process.env, HERMES_HOME: couponProfile },
    encoding: "utf8",
  }
);
assert.notEqual(rejected.status, 0, "A coupon HERMES_HOME must fail closed");
assert.match(
  `${rejected.stdout}\n${rejected.stderr}`,
  /Refusing to install auto-listing integration outside the dedicated doudian-listing profile/
);
assert.equal(digest(couponConfigPath), couponBefore, "Rejected coupon config must not be modified");
assert.deepEqual(
  fs.readdirSync(couponProfile),
  ["config.yaml"],
  "Rejected coupon profile must receive no plugin, skill, SOUL, or other files"
);
assert.equal(digest(runtimeBasePath), runtimeBefore, "Rejected profile must not modify Hermes runtime");

const pluginConfigFixture = `model:\n  provider: local\nplugins:\n  enabled:\n    - existing-observer\n  existing-observer:\n    interval: 30\nagent:\n  max_turns: 8\n`;
const pluginConfigEnabled = enableAutoListingPlugin(pluginConfigFixture);
assert.match(pluginConfigEnabled, /- existing-observer/);
assert.match(pluginConfigEnabled, /- auto-listing-command-router/);
assert.match(pluginConfigEnabled, /existing-observer:\n    interval: 30/);
assert.match(pluginConfigEnabled, /agent:\n  max_turns: 8/);
assert.equal(
  enableAutoListingPlugin(pluginConfigEnabled),
  pluginConfigEnabled,
  "Plugin enablement must preserve other plugin configuration and be idempotent"
);

const legacyFixture = `before\n
_PLAINTEXT_AUTOLIST_COMMANDS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^开始上架$"), "/autolist-start"),
)

def coerce(event):
        # Auto-listing plaintext aliases are project-specific. Rewriting a
        # generic DM leaks auto-listing state across bots.
        from hermes_cli.profiles import get_active_profile_name
        if get_active_profile_name() == "doudian-listing":
            for pattern, command in _PLAINTEXT_AUTOLIST_COMMANDS:
                if pattern.match(text):
                    event.text = command
                    return
        keep_restart_logic()
`;
const cleaned = removeObsoleteAutoListingPlaintextCoercionSource(legacyFixture);
assert.doesNotMatch(cleaned, /_PLAINTEXT_AUTOLIST_COMMANDS|\/autolist-start/);
assert.match(cleaned, /keep_restart_logic\(\)/);
assert.equal(
  removeObsoleteAutoListingPlaintextCoercionSource(cleaned),
  cleaned,
  "Obsolete coercion cleanup must be idempotent"
);

const unknownLayoutPath = path.join(temporaryRoot, "unknown-base.py");
const unknownLayout = "alias = _PLAINTEXT_AUTOLIST_COMMANDS  # unknown layout\n";
fs.writeFileSync(unknownLayoutPath, unknownLayout);
assert.throws(
  () =>
    removeObsoleteAutoListingPlaintextCoercionFile(unknownLayoutPath, {
      verifyOnly: false,
      failures: [],
    }),
  /Unsupported obsolete auto-listing plaintext coercion layout/
);
assert.equal(
  fs.readFileSync(unknownLayoutPath, "utf8"),
  unknownLayout,
  "Unknown runtime layout must fail before writing any bytes"
);

const testSitePackages = path.join(temporaryRoot, "site-packages");
const testGatewayBase = path.join(testSitePackages, "gateway", "platforms", "base.py");
fs.mkdirSync(path.dirname(testGatewayBase), { recursive: true });
fs.writeFileSync(testGatewayBase, legacyFixture);
const testGatewayRun = path.join(testSitePackages, "gateway", "run.py");
fs.writeFileSync(testGatewayRun, "unknown gateway runtime layout\n");
const listingHome = "/Users/mfrank/.hermes/profiles/doudian-listing";
const installerTargets = [
  "config.yaml",
  "plugins/auto-listing-command-router/__init__.py",
  "plugins/auto-listing-command-router/plugin.yaml",
  "skills/ecommerce/douyin-auto-listing-project/SKILL.md",
  "SOUL.md",
];
const targetDigestsBefore = new Map(
  installerTargets.map((relative) => {
    const target = path.join(listingHome, relative);
    return [relative, fs.existsSync(target) ? digest(target) : null];
  })
);
const unknownInstall = childProcess.spawnSync(
  process.execPath,
  ["scripts/install-hermes-profile.mjs"],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HERMES_HOME: listingHome,
      HERMES_SITE_PACKAGES: testSitePackages,
    },
    encoding: "utf8",
  }
);
assert.notEqual(unknownInstall.status, 0, "Unknown runtime layout must reject the full install");
assert.equal(
  fs.readFileSync(testGatewayBase, "utf8"),
  legacyFixture,
  "A planned base.py cleanup must not be written when later run.py preflight fails"
);
assert.equal(fs.readFileSync(testGatewayRun, "utf8"), "unknown gateway runtime layout\n");
for (const [relative, before] of targetDigestsBefore) {
  const target = path.join(listingHome, relative);
  assert.equal(
    fs.existsSync(target) ? digest(target) : null,
    before,
    `Unknown runtime layout must leave ${relative} unchanged`
  );
}

console.log("Hermes profile installer isolation and cleanup rules passed.");
