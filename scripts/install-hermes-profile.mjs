import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const hermesHome = path.resolve(process.env.HERMES_HOME || "/Users/mfrank/.hermes/profiles/doudian-listing");
const verifyOnly = process.argv.includes("--verify");
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

const failures = [];
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
