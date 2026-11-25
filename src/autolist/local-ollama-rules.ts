export const DEFAULT_LOCAL_OLLAMA_HOST = "http://127.0.0.1:11434";

export function requireLocalOllamaHost(value?: string): string {
  const raw = value?.trim() || DEFAULT_LOCAL_OLLAMA_HOST;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Local Ollama host must be a valid loopback URL, got ${raw}.`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error(`Local Ollama host must use HTTP loopback only; external model host rejected: ${raw}.`);
  }
  return raw.replace(/\/$/u, "");
}
