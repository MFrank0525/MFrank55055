export const QUALIFICATION_IMAGE_PLATFORM_LIMIT = 1999;
export const QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE = 1900;

export type QualificationImageResizeDecision = {
  action: "reuse" | "resize";
  targetWidth: number;
  targetHeight: number;
};

export function resolveQualificationImageResize(input: {
  width: number;
  height: number;
}): QualificationImageResizeDecision {
  const width = Math.floor(input.width);
  const height = Math.floor(input.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid qualification image dimensions: width=${input.width}; height=${input.height}`);
  }
  if (width <= QUALIFICATION_IMAGE_PLATFORM_LIMIT && height <= QUALIFICATION_IMAGE_PLATFORM_LIMIT) {
    return { action: "reuse", targetWidth: width, targetHeight: height };
  }
  const longest = Math.max(width, height);
  const scale = QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE / longest;
  return {
    action: "resize",
    targetWidth: Math.max(1, Math.floor(width * scale)),
    targetHeight: Math.max(1, Math.floor(height * scale))
  };
}

export function verifyNormalizedQualificationImage(input: {
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
}): { passed: boolean; issue: string } {
  if (input.width <= 0 || input.height <= 0) {
    return {
      passed: false,
      issue: `Normalized qualification image has invalid dimensions. width=${input.width}; height=${input.height}`
    };
  }
  if (input.width > QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE || input.height > QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE) {
    return {
      passed: false,
      issue: `Normalized qualification image exceeded target dimensions. width=${input.width}; height=${input.height}; limit=${QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE}`
    };
  }
  if (input.width !== input.targetWidth || input.height !== input.targetHeight) {
    return {
      passed: false,
      issue: `Normalized qualification image did not match requested dimensions. expected=${input.targetWidth}x${input.targetHeight}; actual=${input.width}x${input.height}`
    };
  }
  return { passed: true, issue: "" };
}
