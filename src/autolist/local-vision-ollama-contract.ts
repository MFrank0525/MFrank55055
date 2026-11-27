export const LOCAL_VISION_RENDERER = "qwen3-vl-instruct";

interface LocalVisionModelMetadata {
  renderer?: string;
  parser?: string;
  capabilities?: string[];
}

interface LocalVisionChatEnvelope {
  model?: string;
  done?: boolean;
  done_reason?: string;
  message?: {
    content?: string;
    thinking?: string;
  };
}

export function assertLocalVisionModelContract(metadata: LocalVisionModelMetadata): void {
  const capabilities = new Set(metadata.capabilities || []);
  if (metadata.renderer !== LOCAL_VISION_RENDERER || metadata.parser !== LOCAL_VISION_RENDERER) {
    const selected = `${metadata.renderer || "missing"}/${metadata.parser || "missing"}`;
    const suffix = selected.includes("thinking") ? " thinking variant rejected" : " instruct renderer/parser required";
    throw new Error(`Local vision model contract violation:${suffix}; got ${selected}.`);
  }
  for (const capability of ["completion", "vision"]) {
    if (!capabilities.has(capability)) {
      throw new Error(`Local vision model contract violation: missing ${capability} capability.`);
    }
  }
}

export function parseLocalVisionStructuredResponse(raw: string): { model: string; payload: unknown } {
  let envelope: LocalVisionChatEnvelope;
  try {
    envelope = JSON.parse(raw) as LocalVisionChatEnvelope;
  } catch {
    throw new Error("Local vision structured response was not a JSON envelope.");
  }
  const content = envelope.message?.content?.trim() || "";
  const thinking = envelope.message?.thinking?.trim() || "";
  if (!content) {
    const diagnostic = `done_reason=${envelope.done_reason || "missing"}; thinking_chars=${thinking.length}`;
    if (thinking) {
      throw new Error(`Local vision thinking-only response rejected: ${diagnostic}.`);
    }
    throw new Error(`Local vision empty response rejected: ${diagnostic}.`);
  }
  if (thinking) {
    throw new Error(`Local vision instruct contract emitted unexpected thinking content: chars=${thinking.length}.`);
  }
  if (envelope.done !== true || envelope.done_reason !== "stop") {
    throw new Error(`Local vision incomplete response rejected: done=${String(envelope.done)}; done_reason=${envelope.done_reason || "missing"}.`);
  }
  try {
    return { model: envelope.model || "", payload: JSON.parse(content) };
  } catch {
    throw new Error("Local vision response content was not valid structured JSON.");
  }
}

export async function assertLocalVisionModelAvailable(options: {
  host: string;
  model: string;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(`${options.host}/api/show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: options.model }),
    signal: options.signal
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Local vision model preflight failed with HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  let metadata: LocalVisionModelMetadata;
  try {
    metadata = JSON.parse(raw) as LocalVisionModelMetadata;
  } catch {
    throw new Error("Local vision model preflight returned invalid JSON.");
  }
  assertLocalVisionModelContract(metadata);
}

export async function requestLocalVisionStructuredJson(options: {
  host: string;
  model: string;
  prompt: string;
  images: string[];
  format: unknown;
  signal: AbortSignal;
  maxOutputTokens?: number;
}): Promise<{ model: string; payload: unknown }> {
  const response = await fetch(`${options.host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      stream: false,
      format: options.format,
      messages: [{ role: "user", content: options.prompt, images: options.images }],
      options: {
        temperature: 0,
        num_ctx: 8192,
        num_predict: options.maxOutputTokens || 2048
      }
    }),
    signal: options.signal
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Local vision structured request failed with HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  const result = parseLocalVisionStructuredResponse(raw);
  if (result.model && result.model !== options.model) {
    throw new Error(`Local vision response model mismatch: expected ${options.model}, got ${result.model}.`);
  }
  return { model: result.model || options.model, payload: result.payload };
}
