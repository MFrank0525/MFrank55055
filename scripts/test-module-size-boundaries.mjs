import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const maxLinesByFile = new Map([
  ["src/business/publish-from-spu.ts", 120],
  ["src/cli/auto-listing-controller.ts", 3000],
  ["src/autolist/main-image-assets.ts", 2600]
]);

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    return /\.(?:ts|mjs)$/.test(entry.name) ? [fullPath] : [];
  });
}

for (const file of listSourceFiles("src")) {
  const lineCount = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
  const maxLines = maxLinesByFile.get(file) ?? 1500;
  assert.ok(
    lineCount <= maxLines,
    `source module is too large and must be split: ${file} has ${lineCount} lines, limit ${maxLines}`
  );
}

console.log("module size boundaries passed");
