export type ImageGenerationProvider = "openai-compatible" | "none";

export function resolveImageGenerationProvider(
  value: unknown,
  simulateOnly: boolean,
  context: string
): ImageGenerationProvider {
  if (value === "openai-compatible") {
    return value;
  }
  if (simulateOnly && value === "none") {
    return value;
  }
  if (simulateOnly && (value === undefined || value === null || value === "")) {
    return "openai-compatible";
  }
  throw new Error(
    `${context} image generation provider must be openai-compatible${simulateOnly ? " or none for simulation-only execution" : ""}.`
  );
}

export function requireOpenAiCompatibleImageProvider(value: unknown, context: string): "openai-compatible" {
  if (value !== "openai-compatible") {
    throw new Error(`${context} image generation provider must be openai-compatible.`);
  }
  return value;
}
