import fs from "node:fs";
import path from "node:path";
import type { AutoListingStep } from "./types.js";

const MANUAL_ROOT = path.resolve(process.cwd(), "docs", "auto-listing", "steps");

const STEP_MANUAL_FILES: Partial<Record<AutoListingStep, string>> = {
  selling_points_loaded: "01-selling-points.md",
  poster_prompts_generated: "02-deepseek-prompts.md",
  main_images_generated: "03-main-image-generation.md",
  product_folders_built: "04-product-folders.md",
  titles_generated: "05-title-generation.md",
  titles_distributed: "06-title-distribution.md",
  metadata_enriched: "07-product-info-enrichment.md",
  qualifications_attached: "08-qualification-attachment.md",
  shop_distributed: "09-shop-distribution.md",
  published: "10-publish.md",
  cleaned: "11-cleanup.md"
};

export function readOperationManual(step: AutoListingStep): { filePath: string; content: string } | null {
  const relativeFile = STEP_MANUAL_FILES[step];
  if (!relativeFile) {
    return null;
  }

  const filePath = path.join(MANUAL_ROOT, relativeFile);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Operation manual not found for step ${step}: ${filePath}`);
  }

  return {
    filePath,
    content: fs.readFileSync(filePath, "utf8")
  };
}

export function readRequiredOperationManual(step: AutoListingStep): { filePath: string; content: string } {
  const manual = readOperationManual(step);
  if (!manual) {
    throw new Error(`Operation manual not configured for step: ${step}`);
  }
  return manual;
}

export function extractManualTextBlock(content: string, heading: string): string | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const headingLine = `### ${heading}`;
  const startIndex = lines.findIndex((line) => line.trim() === headingLine);
  if (startIndex < 0) {
    return null;
  }

  const collected: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line) || /^###\s+/.test(line)) {
      break;
    }
    collected.push(line);
  }

  const block = collected.join("\n").trim();
  if (!block) {
    return null;
  }

  const fenced = block.match(/^```(?:text)?\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1].trim() : block;
}

export function readManualTextBlock(step: AutoListingStep, heading: string): string {
  const manual = readRequiredOperationManual(step);
  const block = extractManualTextBlock(manual.content, heading);
  if (!block) {
    throw new Error(`Operation manual block not found for step ${step}: ${heading}`);
  }
  return block;
}
