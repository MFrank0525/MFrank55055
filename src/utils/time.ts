export function nowIso(): string {
  return new Date().toISOString();
}

export function fileTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
