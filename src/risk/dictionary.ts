import fs from "fs";
import path from "path";

function readList(name: string): string[] {
  const filePath = path.join(process.cwd(), "data", "risk-dictionary", name);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function loadRiskDictionary(): { block: string[]; warn: string[]; preferred: string[] } {
  return {
    block: readList("blocklist.txt"),
    warn: readList("warnlist.txt"),
    preferred: readList("preferred-terms.txt")
  };
}
