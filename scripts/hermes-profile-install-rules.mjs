import fs from "node:fs";
import path from "node:path";

export const DEDICATED_LISTING_HERMES_HOME = path.resolve(
  "/Users/mfrank/.hermes/profiles/doudian-listing"
);

export function assertDedicatedListingProfilePath(hermesHome) {
  const resolved = path.resolve(hermesHome);
  if (resolved !== DEDICATED_LISTING_HERMES_HOME) {
    throw new Error(
      `Refusing to install auto-listing integration outside the dedicated doudian-listing profile: ${resolved}`
    );
  }
  return resolved;
}

export function enableAutoListingPlugin(source) {
  const pluginName = "auto-listing-command-router";
  const lines = source.split("\n");
  const pluginsIndex = lines.findIndex((line) => /^plugins:\s*$/.test(line));
  if (pluginsIndex < 0) {
    return `${source.trimEnd()}\n\nplugins:\n  enabled:\n    - ${pluginName}\n`;
  }
  let blockEnd = lines.length;
  for (let index = pluginsIndex + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) {
      blockEnd = index;
      break;
    }
  }
  const enabledIndex = lines.findIndex(
    (line, index) => index > pluginsIndex && index < blockEnd && /^  enabled:\s*$/.test(line)
  );
  if (enabledIndex < 0) {
    const unsupportedEnabled = lines.some(
      (line, index) => index > pluginsIndex && index < blockEnd && /^  enabled:/.test(line)
    );
    if (unsupportedEnabled) {
      throw new Error("Unsupported Hermes plugins.enabled layout");
    }
    lines.splice(pluginsIndex + 1, 0, "  enabled:", `    - ${pluginName}`);
    return lines.join("\n");
  }
  let enabledEnd = enabledIndex + 1;
  while (enabledEnd < blockEnd && (/^    /.test(lines[enabledEnd]) || /^\s*$/.test(lines[enabledEnd]))) {
    enabledEnd += 1;
  }
  if (
    lines
      .slice(enabledIndex + 1, enabledEnd)
      .some((line) => line.trim() === `- ${pluginName}`)
  ) {
    return source;
  }
  lines.splice(enabledEnd, 0, `    - ${pluginName}`);
  return lines.join("\n");
}

export function removeObsoleteAutoListingPlaintextCoercionSource(source) {
  if (!source.includes("_PLAINTEXT_AUTOLIST_COMMANDS")) return source;
  const next = source
    .replace(/\n_PLAINTEXT_AUTOLIST_COMMANDS:[\s\S]*?\n\)\n\n/, "\n")
    .replace(
      /        # Auto-listing plaintext aliases are project-specific\.[\s\S]*?                    return\n/,
      ""
    )
    .replace(
      /        for pattern, command in _PLAINTEXT_AUTOLIST_COMMANDS:[\s\S]*?                return\n/,
      ""
    );
  if (next.includes("_PLAINTEXT_AUTOLIST_COMMANDS")) {
    throw new Error("Unsupported obsolete auto-listing plaintext coercion layout");
  }
  return next;
}

export function removeObsoleteAutoListingPlaintextCoercionFile(
  filePath,
  { verifyOnly = false, failures = [] } = {}
) {
  if (!fs.existsSync(filePath)) {
    failures.push(`missing:${filePath}`);
    return;
  }
  const source = fs.readFileSync(filePath, "utf8");
  let next;
  try {
    next = removeObsoleteAutoListingPlaintextCoercionSource(source);
  } catch (error) {
    failures.push("drift:runtime.obsolete-autolist-plaintext-coercion");
    if (!verifyOnly) throw new Error(`${error.message}: ${filePath}`);
    return;
  }
  if (next !== source) {
    failures.push("drift:runtime.obsolete-autolist-plaintext-coercion");
    if (!verifyOnly) fs.writeFileSync(filePath, next);
  }
}
