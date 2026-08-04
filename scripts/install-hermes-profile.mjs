import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const hermesHome = path.resolve(process.env.HERMES_HOME || "/Users/mfrank/.hermes/profiles/doudian-listing");
const verifyOnly = process.argv.includes("--verify");
const hermesSitePackages = "/Users/mfrank/.local/share/uv/tools/hermes-agent/lib/python3.11/site-packages";
const files = [
  ["integrations/hermes/auto-listing-command-router/__init__.py", "plugins/auto-listing-command-router/__init__.py"],
  ["integrations/hermes/auto-listing-command-router/plugin.yaml", "plugins/auto-listing-command-router/plugin.yaml"],
  ["integrations/hermes/SKILL.md", "skills/ecommerce/douyin-auto-listing-project/SKILL.md"],
  ["integrations/hermes/SOUL.md", "SOUL.md"]
];

const expected = (relative) => fs.readFileSync(path.join(projectRoot, relative), "utf8");

function replacePluginsSection(source) {
  const section = "plugins:\n  enabled:\n    - auto-listing-command-router\n";
  const match = source.match(/^plugins:\n(?:^[ \t].*\n|^\s*$)*/m);
  return match ? source.replace(match[0], section) : `${source.trimEnd()}\n\n${section}`;
}

function repairHermesRuntime(filePath, rules, failures) {
  if (!fs.existsSync(filePath)) {
    failures.push(`missing:${filePath}`);
    return;
  }
  let source = fs.readFileSync(filePath, "utf8");
  let next = source;
  for (const rule of rules) {
    if (next.includes(rule.expected)) continue;
    failures.push(`drift:runtime.${rule.name}`);
    if (!verifyOnly) {
      if (!next.includes(rule.legacy)) {
        throw new Error(`Unsupported Hermes runtime layout for ${rule.name}: ${filePath}`);
      }
      next = next.replace(rule.legacy, rule.replacement);
    }
  }
  if (!verifyOnly && next !== source) fs.writeFileSync(filePath, next);
}

const failures = [];
repairHermesRuntime(
  path.join(hermesSitePackages, "gateway/platforms/base.py"),
  [{
    name: "profile-scoped-autolist-plaintext",
    expected: 'if get_active_profile_name() == "doudian-listing":\n            for pattern, command in _PLAINTEXT_AUTOLIST_COMMANDS:',
    legacy: '        for pattern, command in _PLAINTEXT_AUTOLIST_COMMANDS:\n            if pattern.match(text):\n                event.text = command\n                return',
    replacement: '        # Auto-listing plaintext aliases are project-specific.\n        from hermes_cli.profiles import get_active_profile_name\n        if get_active_profile_name() == "doudian-listing":\n            for pattern, command in _PLAINTEXT_AUTOLIST_COMMANDS:\n                if pattern.match(text):\n                    event.text = command\n                    return'
  }],
  failures
);
repairHermesRuntime(
  path.join(hermesSitePackages, "gateway/run.py"),
  [
    {
      name: "profile-scoped-autolist-watchdog",
      expected: 'if self._active_profile_name() == "doudian-listing":\n            asyncio.create_task(self._autolist_watchdog())',
      legacy: '        asyncio.create_task(self._autolist_watchdog())',
      replacement: '        if self._active_profile_name() == "doudian-listing":\n            asyncio.create_task(self._autolist_watchdog())'
    },
    {
      name: "plugin-hook-self-heal",
      expected: 'if not _plugin_manager._hooks.get("pre_gateway_dispatch"):',
      legacy: '                from hermes_cli.plugins import invoke_hook as _invoke_hook',
      replacement: '                from hermes_cli.plugins import (\n                    discover_plugins as _discover_plugins,\n                    get_plugin_manager as _get_plugin_manager,\n                    invoke_hook as _invoke_hook,\n                )\n                _plugin_manager = _get_plugin_manager()\n                if not _plugin_manager._hooks.get("pre_gateway_dispatch"):\n                    logger.warning(\n                        "pre_gateway_dispatch hooks missing at message time; "\n                        "forcing plugin rediscovery for profile=%s",\n                        self._active_profile_name(),\n                    )\n                    _discover_plugins(force=True)'
    }
  ],
  failures
);
for (const [source, target] of files) {
  const targetPath = path.join(hermesHome, target);
  if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, "utf8") !== expected(source)) {
    failures.push(`drift:${target}`);
    if (!verifyOnly) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, expected(source));
    }
  }
}
const configPath = path.join(hermesHome, "config.yaml");
if (!fs.existsSync(configPath)) throw new Error(`Hermes config missing: ${configPath}`);
const config = fs.readFileSync(configPath, "utf8");
const nextConfig = replacePluginsSection(config);
if (nextConfig !== config) {
  failures.push("drift:config.plugins");
  if (!verifyOnly) fs.writeFileSync(configPath, nextConfig);
}
if (verifyOnly && failures.length) throw new Error(`Hermes auto-listing profile verification failed: ${failures.join(", ")}`);
console.log(verifyOnly ? "Hermes auto-listing profile verified." : "Hermes auto-listing profile installed.");
