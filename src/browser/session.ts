import path from "path";

export function getUserDataDir(): string {
  return path.join(process.cwd(), "data", "browser-profile");
}

export function getFallbackUserDataDir(): string {
  return path.join(process.cwd(), "data", "browser-profile-fallback");
}
