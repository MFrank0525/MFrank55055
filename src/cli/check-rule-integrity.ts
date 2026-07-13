import fs from "node:fs";
import path from "node:path";
import { selectMaintenanceResidueTargets } from "../autolist/maintenance-rules.js";
import { assertRuleTextIntegrity } from "../autolist/rule-text.js";

function collectExistingFiles(rootDir: string, relativeDirs: string[]): string[] {
  const files: string[] = [];
  for (const relativeDir of relativeDirs) {
    const dir = path.join(rootDir, relativeDir);
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function assertNoMaintenanceResidue(): void {
  const rootDir = process.cwd();
  const targets = selectMaintenanceResidueTargets({
    filePaths: collectExistingFiles(rootDir, ["scripts", "input/auto-listing", "docs/superpowers"])
  });
  if (targets.length) {
    throw new Error(
      `Maintenance residue check failed: ${targets
        .map((target) => `${path.relative(rootDir, target.filePath)} (${target.reason})`)
        .join("; ")}`
    );
  }
}

function main(): void {
  assertRuleTextIntegrity();
  assertNoMaintenanceResidue();
  process.stdout.write("Rule text integrity check passed.\n");
}

main();
