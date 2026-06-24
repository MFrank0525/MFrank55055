import path from "node:path";

export function normalizeShopName(value: string): string {
  return value.replace(/^\d+/, "").replace(/\s+/g, "").trim();
}

export function resolveExpectedShopName(shopFolder: string): string {
  return normalizeShopName(path.basename(shopFolder));
}
