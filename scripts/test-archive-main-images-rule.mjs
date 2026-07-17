import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  archiveUnwatermarkedMainImages,
  resolveArchiveProductName
} from "../dist/src/autolist/archive-main-images.js";

const archiveMainImagesSource = fs.readFileSync("src/autolist/archive-main-images.ts", "utf8");
assert.doesNotMatch(
  archiveMainImagesSource,
  /findCompleteProductArchive|archiveDirPattern|productNames\?:|archiveProductNames/,
  "Archive rules must not retain name-matched historical main image lookup or alias inputs; archives are write-only evidence, not generation or cleanup input."
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archive-main-images-"));
const archiveRoot = path.join(tmp, "archive");
const userCognitionName = "医用凡士林唇喃软膏";
const shortTitle = "凡士林润唇软膏";
const productName = resolveArchiveProductName({
  shortTitle,
  userCognitionName,
  fallbackName: "source-image.png"
});
assert.equal(productName, shortTitle);
assert.equal(
  resolveArchiveProductName({
    shortTitle: " ",
    userCognitionName,
    fallbackName: "source-image.png"
  }),
  userCognitionName
);
const completeArchive = path.join(archiveRoot, `202606101219${productName}`);
fs.mkdirSync(completeArchive, { recursive: true });
for (let index = 1; index <= 20; index += 1) {
  fs.writeFileSync(path.join(completeArchive, `${productName}无水印主图${String(index).padStart(2, "0")}.png`), `archive-${index}`);
}

const taskDir = path.join(tmp, "runs", "current", "tasks", "image-001");
const rawFiles = [];
for (let roundIndex = 1; roundIndex <= 4; roundIndex += 1) {
  const rawDir = path.join(taskDir, `main-image-${String(roundIndex).padStart(2, "0")}`, "openai-compatible", "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const count = roundIndex === 4 ? 3 : 4;
  for (let imageIndex = 1; imageIndex <= count; imageIndex += 1) {
    const file = path.join(rawDir, `generated-${String(imageIndex).padStart(2, "0")}.png`);
    fs.writeFileSync(file, `raw-${roundIndex}-${imageIndex}`);
    rawFiles.push(file);
  }
}

const incompleteArchiveInput = {
  mainImageArtifact: {
    promptFile: path.join(tmp, "prompts.txt"),
    generatedFiles: rawFiles.map((rawImageFile, index) => ({
      imageFile: path.join(tmp, `watermarked-${index}.png`),
      rawImageFile,
      productFolder: path.join(tmp, `product-${index}`),
      storeName: "test",
      promptIndex: Math.floor(index / 4) + 1
    })),
    simulated: false
  },
  productName,
  archiveRootDir: archiveRoot,
  rawImageSearchDir: taskDir,
  expectedImageCount: 20,
  simulateOnly: false
};

assert.throws(
  () => archiveUnwatermarkedMainImages(incompleteArchiveInput),
  /expected 20 current unwatermarked main image\(s\), got 15/,
  "Archiving must fail closed when current raw images are incomplete instead of silently archiving a partial set."
);

const archived = archiveUnwatermarkedMainImages({
  ...incompleteArchiveInput,
  expectedImageCount: 15
});

assert.equal(archived.length, 15);
assert.ok(path.basename(path.dirname(archived[0])).endsWith(shortTitle));
assert.equal(path.basename(archived[0]), `${shortTitle}无水印主图01.png`);
assert.equal(fs.readFileSync(archived[0], "utf8"), "raw-1-1");
assert.equal(fs.readFileSync(archived[14], "utf8"), "raw-4-3");

const fourthRawDir = path.join(taskDir, "main-image-04", "openai-compatible", "raw");
const missingFourthRaw = path.join(fourthRawDir, "generated-04.png");
fs.writeFileSync(missingFourthRaw, "raw-4-4");
rawFiles.push(missingFourthRaw);
const finalRawDir = path.join(taskDir, "main-image-05", "openai-compatible", "raw");
fs.mkdirSync(finalRawDir, { recursive: true });
for (let imageIndex = 1; imageIndex <= 4; imageIndex += 1) {
  const file = path.join(finalRawDir, `generated-${String(imageIndex).padStart(2, "0")}.png`);
  fs.writeFileSync(file, `raw-5-${imageIndex}`);
  rawFiles.push(file);
}
const archivedFromPartialResumeArtifact = archiveUnwatermarkedMainImages({
  ...incompleteArchiveInput,
  mainImageArtifact: {
    ...incompleteArchiveInput.mainImageArtifact,
    generatedFiles: incompleteArchiveInput.mainImageArtifact.generatedFiles.slice(-3)
  }
});
assert.equal(
  archivedFromPartialResumeArtifact.length,
  20,
  "A partial publish-resume artifact must be united with the complete current-task raw image set before archiving."
);
assert.equal(
  new Set(archivedFromPartialResumeArtifact.map((file) => fs.readFileSync(file, "utf8"))).size,
  20,
  "Artifact and disk-discovered raw images must be deduplicated before archiving."
);
