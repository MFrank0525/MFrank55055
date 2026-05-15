export function cleanText(value: string): string {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\u4E00-\u9FFFa-zA-Z0-9\s/%()+\-，。；：、,.#·]/g, "")
    .trim();
}

export function compactText(value: string): string {
  return cleanText(value).replace(/\s+/g, "");
}

export function normalizeTitleText(value: string): string {
  return cleanText(value)
    .replace(/#/g, " ")
    .replace(/[，。；：、,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countCjk(value: string): number {
  return (String(value || "").match(/[\u4E00-\u9FFF]/g) || []).length;
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}
