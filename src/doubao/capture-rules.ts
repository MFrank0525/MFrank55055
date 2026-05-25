export interface DoubaoCaptureRetryPolicy {
  maxAttempts: number;
  delayMs: number[];
}

export function resolveDoubaoCaptureRetryPolicy(mode: "titles" | "selling_points" | "latest" | undefined): DoubaoCaptureRetryPolicy {
  if (mode === "titles") {
    return {
      maxAttempts: 4,
      delayMs: [30000, 60000, 90000]
    };
  }
  return {
    maxAttempts: 2,
    delayMs: [15000]
  };
}

export function isRetryableDoubaoCaptureError(message: string): boolean {
  return /Doubao title response was not found|latest visible answer|response was not found/i.test(message);
}

export function looksLikeDoubaoTitleResponse(text: string, titleCount: number): boolean {
  const normalized = text.replace(/\r/g, "\n");
  const numbered = [...normalized.matchAll(/(?<!\d)0?(\d{1,3})\s*[、,，.．:：)）\]\】\s]+/g)].map((match) => Number(match[1]));
  for (let start = 0; start < numbered.length; start += 1) {
    if (numbered[start] !== 1) {
      continue;
    }
    let expected = 2;
    for (let index = start + 1; index < numbered.length && expected <= titleCount; index += 1) {
      if (numbered[index] !== expected) {
        break;
      }
      expected += 1;
    }
    if (expected > titleCount) {
      return true;
    }
  }
  return false;
}
