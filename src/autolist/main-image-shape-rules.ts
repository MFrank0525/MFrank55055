import type { ImageDimensions } from "../utils/image-dimensions.js";

export interface MainImageSquareDecision {
  action: "reuse" | "pad_to_square";
  targetSide: number;
  issue: string;
}

export function evaluateMainImageSquareRule(dimensions: ImageDimensions): MainImageSquareDecision {
  if (
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new Error(`Main image dimensions must be positive integers: ${dimensions.width}x${dimensions.height}.`);
  }
  if (dimensions.width === dimensions.height) {
    return {
      action: "reuse",
      targetSide: dimensions.width,
      issue: ""
    };
  }
  return {
    action: "pad_to_square",
    targetSide: Math.max(dimensions.width, dimensions.height),
    issue: `Main image is not square: ${dimensions.width}x${dimensions.height}.`
  };
}
