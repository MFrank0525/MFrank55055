import fs from "node:fs";
import path from "node:path";

const PROVIDER_ERROR_TEXT_LIMIT = 2000;
const CONCURRENT_FAILURE_REASON_LIMIT = 1000;
const CONCURRENT_FAILURE_MESSAGE_LIMIT = 32 * 1024;

export function redactImageGenerationLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactImageGenerationLogValue(item));
  if (typeof value === "string" && /^data:image\/[^;]+;base64,/i.test(value)) return "[redacted base64 image data url]";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 512 && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      try {
        return redactImageGenerationLogValue(JSON.parse(trimmed));
      } catch {
        // Preserve a bounded plain-text diagnostic below.
      }
    }
    return redactImageGenerationLogText(value).slice(0, 64 * 1024);
  }
  if (!value || typeof value !== "object") return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (/api(?:[-_\s]?key)|authorization|bearer|secret|token|cookie|(?:request|response|image|body).*b64/i.test(key)) {
      redacted[key] = "[redacted]";
    } else if (/url|image|images|reference/i.test(key) && typeof nestedValue === "string" && /^https?:\/\//i.test(nestedValue)) {
      redacted[key] = "[redacted image url]";
    } else {
      redacted[key] = redactImageGenerationLogValue(nestedValue);
    }
  }
  return redacted;
}

export function writeImageGenerationJsonLog(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(redactImageGenerationLogValue(value), null, 2) + "\n", "utf8");
}

export function redactImageGenerationLogText(text: string): string {
  return text
    .replace(/(authorization|bearer|api(?:[-_\s]?key)|secret|token|cookie)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted api key]")
    .replace(/https?:\/\/[^\s"',}]+/gi, "[redacted url]");
}

export function sanitizeImageGenerationProviderErrorText(text: string, fallback: string): string {
  const raw = text || fallback;
  const compact = (value: unknown, depth = 0): unknown => {
    if (depth > 6) return "[truncated]";
    if (typeof value === "string") {
      const trimmed = value.trim();
      if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > 1) {
        try {
          return compact(JSON.parse(trimmed), depth + 1);
        } catch {
          // Keep the bounded plain-text fallback below.
        }
      }
      return redactImageGenerationLogText(value).slice(0, PROVIDER_ERROR_TEXT_LIMIT);
    }
    if (Array.isArray(value)) return value.slice(0, 16).map((item) => compact(item, depth + 1));
    if (!value || typeof value !== "object") return value;
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
      result[key] = /(?:request|response|image|body).*b64|authorization|bearer|api(?:[-_\s]?key)|secret|token|cookie/i.test(key)
        ? "[redacted]"
        : compact(nestedValue, depth + 1);
    }
    return result;
  };
  let summarized: string;
  try {
    summarized = JSON.stringify(compact(JSON.parse(raw)));
  } catch {
    summarized = String(compact(raw));
  }
  return summarized.slice(0, PROVIDER_ERROR_TEXT_LIMIT) || fallback.slice(0, PROVIDER_ERROR_TEXT_LIMIT);
}

export function writeImageGenerationTextLog(filePath: string, text: string): void {
  try {
    writeImageGenerationJsonLog(filePath, JSON.parse(text));
  } catch {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, redactImageGenerationLogText(text).slice(0, 64 * 1024) + "\n", "utf8");
  }
}

export async function settleConcurrentWork<T>(work: Array<Promise<T>>, label: string): Promise<T[]> {
  const settled = await Promise.allSettled(work);
  const failures = settled
    .map((result, index) => ({ result, index }))
    .filter((item): item is { result: PromiseRejectedResult; index: number } => item.result.status === "rejected");
  if (failures.length > 0) {
    const reasons = failures.map((item) => {
      const reason = item.result.reason instanceof Error ? item.result.reason.message : String(item.result.reason);
      return reason.slice(0, CONCURRENT_FAILURE_REASON_LIMIT);
    });
    const message = `${label} failed after all concurrent work settled; failed indexes: ${failures.map((item) => item.index + 1).join(", ")}; reasons: ${reasons.join(" | ")}`;
    throw new AggregateError(
      failures.map((item) => new Error((item.result.reason instanceof Error ? item.result.reason.message : String(item.result.reason)).slice(0, CONCURRENT_FAILURE_REASON_LIMIT))),
      message.slice(0, CONCURRENT_FAILURE_MESSAGE_LIMIT)
    );
  }
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}
