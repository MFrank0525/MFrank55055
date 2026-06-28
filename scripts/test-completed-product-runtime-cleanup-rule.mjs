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
const titleFile = path.join(tmp, "titles", "product-01.xlsx");
const legacyPublishRuntimeDir = path.join(tmp, "runs", "20260628-120000", "publish", "01shop__product-01");

for (const filePath of [sourceImagePath, qualificationPath, screenshotFile, path.join(taskRuntimeDir, "prompt.docx"), path.join(productFolder, "main.png"), titleFile]) {
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
    runtimeDir: path.join(tmp, "runs", "20260628-120000"),
    distributedFolders: [productFolder],
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
    runtimeDir: path.join(tmp, "runs", "20260628-120000"),
    distributedFolders: [productFolder],
    publishResults: []
  }),
  [legacyPublishRuntimeDir],
  "cleanup may fall back to legacy folder-derived runtime names only when publish results are unavailable"
);

const completedCleanup = cleanupAfterPublish({
  distributedFolders: [productFolder],
  titleWorkbookFiles: [titleFile],
  sourceImagePath,
  sourceAssetFiles: [sourceImagePath, qualificationPath],
  taskRuntimeDir,
  publishRuntimeDirs: [publishRuntimeDir],
  cleanupAfterPublish: true,
  cleanupSourceImageAfterPublish: true,
  simulateOnly: false
});

assert.equal(fs.existsSync(screenshotFile), false, "completed products must remove publish runtime screenshots");
assert.ok(completedCleanup.removedPaths.includes(publishRuntimeDir));

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
