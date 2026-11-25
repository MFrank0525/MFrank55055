import fs from "node:fs";
import path from "node:path";
import { readSimpleWordDocument } from "../autolist/docx-lite.js";
import {
  ensureMainImageFrameApplied,
  MAIN_IMAGE_FRAME_LAYOUT_VERSION,
  prepareMainImageFrameLayoutReference
} from "../autolist/main-image-frame-action.js";
import {
  DEFAULT_MAIN_IMAGE_FRAME_FILE,
  MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT,
  shouldApplyDefaultMainImageFrame
} from "../autolist/main-image-frame-rules.js";
import {
  buildImageEditPromptFromWord,
  generateWithOpenAiCompatibleProvider
} from "../autolist/main-image-provider-action.js";
import { buildMainImageProductionPrompt } from "../autolist/main-image-visual-direction-rules.js";
import { ensureSquareMainImageFile } from "../autolist/main-image-square-action.js";
import { sha256File, sha256Text } from "../autolist/paid-image-submission-ledger.js";

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith("--") && value && !value.startsWith("--")) {
      args.set(key, value);
      index += 1;
    }
  }
  return args;
}

function requireFile(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}.`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`);
  return resolved;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sourceImagePath = requireFile(args.get("--source"), "--source image");
  const promptWordFile = requireFile(args.get("--prompt"), "--prompt Word file");
  const configFile = requireFile(
    args.get("--config") || "input/image-generation.config.json",
    "--config image-generation config"
  );
  const brand = (args.get("--brand") || "").trim();
  if (!brand) throw new Error("Missing --brand.");
  const recordId = (args.get("--record-id") || "quality-test").trim();
  const basePrompt = buildImageEditPromptFromWord({
    paragraphs: readSimpleWordDocument(promptWordFile),
    promptWordFile
  });
  const protectedFrameFile = shouldApplyDefaultMainImageFrame(brand)
    ? DEFAULT_MAIN_IMAGE_FRAME_FILE
    : undefined;
  const promptText = buildMainImageProductionPrompt({
    basePromptText: basePrompt,
    roundIndex: 0,
    variantIndex: 0,
    hasFixedFrame: Boolean(protectedFrameFile),
    frameContract: MAIN_IMAGE_FRAME_SAFE_ZONE_PROMPT_CONTRACT
  });
  const testId = sha256Text(
    JSON.stringify({
      sourceDigest: sha256File(sourceImagePath),
      promptDigest: sha256Text(promptText),
      brand,
      frameDigest: protectedFrameFile ? sha256File(protectedFrameFile) : "none"
    })
  ).slice(0, 24);
  const outputDir = path.resolve(
    args.get("--out") || path.join("data", "auto-listing", "main-image-quality-tests", testId)
  );
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "prompt.txt"), `${promptText}\n`, "utf8");
  const providerReferenceFile = protectedFrameFile
    ? await prepareMainImageFrameLayoutReference({
        sourceFile: sourceImagePath,
        frameFile: protectedFrameFile,
        outputFile: path.join(outputDir, "layout-reference.png")
      })
    : sourceImagePath;

  const [result] = await generateWithOpenAiCompatibleProvider({
    configFile,
    promptText,
    sourceImagePath: providerReferenceFile,
    downloadDir: path.join(outputDir, "raw"),
    expectedImageCount: 1,
    requestedImageIndexes: [1],
    paidImageLedger: {
      rootDir: path.join("data", "auto-listing", "main-image-quality-test-paid-ledger"),
      batchFingerprint: testId,
      recordId: `quality-test-${recordId}`,
      expectedSlotCount: 1,
      slotOffset: 0,
      owner: { runId: `quality-test-${testId}`, taskId: "image-quality-test", pid: process.pid }
    },
    onProgress: (message) => console.error(message)
  });
  if (!result?.file) throw new Error("Quality test provider returned no image.");
  await ensureSquareMainImageFile({
    sourceFile: result.file,
    evidenceDir: path.join(outputDir, "provider-original")
  });
  await ensureMainImageFrameApplied(result.file, protectedFrameFile);
  const unframedFile = protectedFrameFile ? `${result.file}.unframed.png` : result.file;
  const manifest = {
    ok: true,
    mode: "main-image-quality-test-only",
    publishAllowed: false,
    testId,
    referenceImageCount: 1,
    frameLayoutVersion: protectedFrameFile ? MAIN_IMAGE_FRAME_LAYOUT_VERSION : undefined,
    sourceImagePath,
    providerReferenceFile,
    promptWordFile,
    unframedFile,
    framedFile: result.file,
    providerSubmitId: result.submitId
  };
  fs.writeFileSync(path.join(outputDir, "quality-test-result.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
