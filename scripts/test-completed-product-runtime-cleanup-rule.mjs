import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupAfterPublish } from "../dist/src/autolist/cleanup.js";
import { resolvePublishRuntimeDirsForCleanup } from "../dist/src/autolist/cleanup-rules.js";
import { auditIntermediateArtifactResidue } from "../dist/src/autolist/audit-rules.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "completed-product-runtime-cleanup-"));
const sourceImagePath = path.join(tmp, "feishu-images", "product-white.png");
const qualificationPath = path.join(tmp, "qualifications", "product-qualification.png");
const publishRuntimeDir = path.join(tmp, "runs", "20260628-120000", "publish", "target-001");
const screenshotFile = path.join(publishRuntimeDir, "screenshots", "publish-page-basic-filled.png");
const taskRuntimeDir = path.join(tmp, "runs", "20260628-120000", "tasks", "image-001");
const productFolder = path.join(tmp, "shops", "01shop", "product-01");
const pendingProductFolder = path.join(tmp, "shops", "01shop", "product-02-pending");
const titleFile = path.join(tmp, "titles", "product-01.xlsx");
const pendingTitleFile = path.join(tmp, "titles", "product-02.xlsx");
const pendingSourceImage = path.join(tmp, "feishu-images", "product-02-white.png");
const generatedResumeJob = path.join(tmp, "auto-listing", "pending.resume.generated.json");

for (const filePath of [sourceImagePath, qualificationPath, screenshotFile, path.join(taskRuntimeDir, "prompt.docx"), path.join(productFolder, "main.png"), titleFile, path.join(pendingProductFolder, "main.png"), pendingTitleFile, pendingSourceImage, generatedResumeJob]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "artifact");
}

const unfinishedCleanup = cleanupAfterPublish({
  distributedFolders: [productFolder],
  titleWorkbookFiles: [titleFile],
  sourceImagePath,
  sourceAssetFiles: [sourceImagePath, qualificationPath],
  taskRuntimeDir,
  publishRuntimeDirs: [publishRuntimeDir],
  cleanupAfterPublish: false,
  cleanupSourceImageAfterPublish: true,
  simulateOnly: false
});

assert.equal(unfinishedCleanup.removedPaths.length, 0);
assert.equal(fs.existsSync(screenshotFile), true, "unfinished products must retain publish screenshots for diagnosis and resume");

const residueBeforeCleanup = auditIntermediateArtifactResidue({
  tasks: [
    {
      taskId: "image-001",
      status: "cleaned",
      publishArtifact: {
        results: [
          {
            productFolder,
            resultFile: path.join(publishRuntimeDir, "result.json")
          }
        ]
      },
      cleanupArtifact: {
        removedPaths: [productFolder, titleFile, taskRuntimeDir]
      }
    }
  ],
  existingPaths: [screenshotFile]
});

assert.equal(residueBeforeCleanup.ok, false);
assert.equal(residueBeforeCleanup.errors[0].code, "completed_product_publish_runtime_residue");

assert.deepEqual(
  resolvePublishRuntimeDirsForCleanup({
    publishResults: [
      {
        productFolder,
        resultFile: path.join(publishRuntimeDir, "result.json")
      }
    ]
  }),
  [publishRuntimeDir],
  "cleanup must use canonical publish result runtime dirs instead of legacy folder-derived runtime names"
);

assert.deepEqual(
  resolvePublishRuntimeDirsForCleanup({
    publishResults: []
  }),
  [],
  "cleanup must not derive identity-free runtime names when canonical publish results are unavailable"
);

const completedCleanup = cleanupAfterPublish({
  distributedFolders: [productFolder],
  titleWorkbookFiles: [titleFile],
  sourceImagePath,
  sourceAssetFiles: [sourceImagePath, qualificationPath],
  taskRuntimeDir,
  publishRuntimeDirs: [publishRuntimeDir],
  feishuImageDir: path.dirname(sourceImagePath),
  qualificationDir: path.dirname(qualificationPath),
  shopRootDir: path.join(tmp, "shops"),
  autoListingInputDir: path.join(tmp, "auto-listing"),
  titleDir: path.dirname(titleFile),
  cleanupAfterPublish: true,
  cleanupSourceImageAfterPublish: true,
  simulateOnly: false
});

assert.equal(fs.existsSync(screenshotFile), false, "completed products must remove publish runtime screenshots");
assert.ok(completedCleanup.removedPaths.includes(publishRuntimeDir));
assert.equal(fs.existsSync(path.join(pendingProductFolder, "main.png")), true, "completed-product cleanup must preserve another product's pending shop folder");
assert.equal(fs.existsSync(pendingTitleFile), true, "completed-product cleanup must preserve another product's pending workbook");
assert.equal(fs.existsSync(pendingSourceImage), true, "completed-product cleanup must preserve another product's pending Feishu source image");
assert.equal(fs.existsSync(generatedResumeJob), true, "completed-product cleanup must preserve another product's active resume job");

const residueAfterCleanup = auditIntermediateArtifactResidue({
  tasks: [
    {
      taskId: "image-001",
      status: "cleaned",
      publishArtifact: {
        results: [
          {
            productFolder,
            resultFile: path.join(publishRuntimeDir, "result.json")
          }
        ]
      },
      cleanupArtifact: {
        removedPaths: completedCleanup.removedPaths
      }
    }
  ],
  existingPaths: []
});

assert.equal(residueAfterCleanup.ok, true);

console.log("completed product runtime cleanup rule passed");
