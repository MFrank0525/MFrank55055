import fs from "node:fs";
import path from "node:path";
import {
  assertDedicatedListingProfilePath,
  enableAutoListingPlugin,
  removeObsoleteAutoListingPlaintextCoercionSource,
} from "./hermes-profile-install-rules.mjs";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const hermesHome = assertDedicatedListingProfilePath(
  process.env.HERMES_HOME || "/Users/mfrank/.hermes/profiles/doudian-listing"
);
const verifyOnly = process.argv.includes("--verify");
if (process.env.HERMES_SITE_PACKAGES && process.env.NODE_ENV !== "test") {
  throw new Error("HERMES_SITE_PACKAGES override is allowed only in test mode");
}
const hermesSitePackages = path.resolve(
  process.env.HERMES_SITE_PACKAGES ||
    "/Users/mfrank/.local/share/uv/tools/hermes-agent/lib/python3.11/site-packages"
);
const files = [
  ["integrations/hermes/auto-listing-command-router/__init__.py", "plugins/auto-listing-command-router/__init__.py"],
  ["integrations/hermes/auto-listing-command-router/plugin.yaml", "plugins/auto-listing-command-router/plugin.yaml"],
  ["integrations/hermes/SKILL.md", "skills/ecommerce/douyin-auto-listing-project/SKILL.md"],
  ["integrations/hermes/SOUL.md", "SOUL.md"]
];

const expected = (relative) => fs.readFileSync(path.join(projectRoot, relative), "utf8");

function planHermesRuntimeRepair(filePath, rules, failures, writes) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Hermes runtime file missing: ${filePath}`);
  }
  const source = fs.readFileSync(filePath, "utf8");
  let next = source;
  for (const rule of rules) {
    if (next.includes(rule.expected)) continue;
    failures.push(`drift:runtime.${rule.name}`);
    if (!next.includes(rule.legacy)) {
      throw new Error(`Unsupported Hermes runtime layout for ${rule.name}: ${filePath}`);
    }
    next = next.replace(rule.legacy, rule.replacement);
  }
  if (next !== source) writes.push({ filePath, content: next });
}

const failures = [];
const writes = [];
const baseRuntimePath = path.join(hermesSitePackages, "gateway/platforms/base.py");
if (!fs.existsSync(baseRuntimePath)) throw new Error(`Hermes runtime file missing: ${baseRuntimePath}`);
const baseRuntimeSource = fs.readFileSync(baseRuntimePath, "utf8");
const nextBaseRuntimeSource = removeObsoleteAutoListingPlaintextCoercionSource(baseRuntimeSource);
if (nextBaseRuntimeSource !== baseRuntimeSource) {
  failures.push("drift:runtime.obsolete-autolist-plaintext-coercion");
  writes.push({ filePath: baseRuntimePath, content: nextBaseRuntimeSource });
}
planHermesRuntimeRepair(
  path.join(hermesSitePackages, "gateway/run.py"),
  [
    {
      name: "profile-scoped-autolist-watchdog",
      expected: 'if self._active_profile_name() == "doudian-listing":\n            asyncio.create_task(self._autolist_watchdog())',
      legacy: '        asyncio.create_task(self._autolist_watchdog())',
      replacement: '        if self._active_profile_name() == "doudian-listing":\n            asyncio.create_task(self._autolist_watchdog())'
    },
    {
      name: "profile-scoped-autolist-slash-commands",
      expected: 'if canonical in {"autolist-status", "autolist-start", "autolist-continue", "autolist-pause"}:\n            if self._active_profile_name() != "doudian-listing":',
      legacy: '        if canonical in {"autolist-status", "autolist-start", "autolist-continue", "autolist-pause"}:\n            action = {',
      replacement: '        if canonical in {"autolist-status", "autolist-start", "autolist-continue", "autolist-pause"}:\n            if self._active_profile_name() != "doudian-listing":\n                return "自动上架命令仅允许在抖店上架运营专用通道执行。"\n            action = {'
    },
    {
      name: "plugin-hook-self-heal",
      expected: 'if not _plugin_manager._hooks.get("pre_gateway_dispatch"):',
      legacy: '                from hermes_cli.plugins import invoke_hook as _invoke_hook',
      replacement: '                from hermes_cli.plugins import (\n                    discover_plugins as _discover_plugins,\n                    get_plugin_manager as _get_plugin_manager,\n                    invoke_hook as _invoke_hook,\n                )\n                _plugin_manager = _get_plugin_manager()\n                if not _plugin_manager._hooks.get("pre_gateway_dispatch"):\n                    logger.warning(\n                        "pre_gateway_dispatch hooks missing at message time; "\n                        "forcing plugin rediscovery for profile=%s",\n                        self._active_profile_name(),\n                    )\n                    _discover_plugins(force=True)'
    }
  ],
  failures,
  writes
);
for (const [source, target] of files) {
  const targetPath = path.join(hermesHome, target);
  if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, "utf8") !== expected(source)) {
    failures.push(`drift:${target}`);
    writes.push({ filePath: targetPath, content: expected(source) });
  }
}
const configPath = path.join(hermesHome, "config.yaml");
if (!fs.existsSync(configPath)) throw new Error(`Hermes config missing: ${configPath}`);
const config = fs.readFileSync(configPath, "utf8");
const nextConfig = enableAutoListingPlugin(config);
if (nextConfig !== config) {
  failures.push("drift:config.plugins");
  writes.push({ filePath: configPath, content: nextConfig });
}
if (verifyOnly && failures.length) throw new Error(`Hermes auto-listing profile verification failed: ${failures.join(", ")}`);
if (!verifyOnly) {
  for (const write of writes) {
    fs.mkdirSync(path.dirname(write.filePath), { recursive: true });
    fs.writeFileSync(write.filePath, write.content);
  }
}
console.log(verifyOnly ? "Hermes auto-listing profile verified." : "Hermes auto-listing profile installed.");
