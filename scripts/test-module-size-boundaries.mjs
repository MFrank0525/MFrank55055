import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SOURCE_MODULE_MAX_LINES = 1500;
const TEST_MODULE_MAX_LINES = 3000;
const maxLinesByFile = new Map([["src/business/publish-from-spu.ts", 120]]);

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

for (const file of listSourceFiles("scripts")) {
  const lineCount = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
  assert.ok(
    lineCount <= TEST_MODULE_MAX_LINES,
    `test module is too large and must be split: ${file} has ${lineCount} lines, limit ${TEST_MODULE_MAX_LINES}`
  );
}

console.log("module size boundaries passed");
