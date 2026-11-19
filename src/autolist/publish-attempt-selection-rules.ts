export function selectLatestUnresolvedPublishAttemptEntry<T extends {
  status?: string;
  runtimeKey?: string;
  updatedAt?: string;
}>(entries: T[]): T | undefined {
  return entries
    .filter((entry) => ["pending", "failed"].includes(entry.status || "") && entry.runtimeKey)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
}
