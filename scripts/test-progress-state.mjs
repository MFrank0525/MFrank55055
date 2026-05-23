import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLatestTaskProgressEvent } from "../dist/src/autolist/progress-events.js";
import { selectCleanupTargets } from "../dist/src/autolist/cleanup-rules.js";
import { createRunState, recordTaskProgress } from "../dist/src/autolist/state-machine.js";
import { classifyPublishFailure, shouldRetryPublishFailure } from "../dist/src/business/publish-from-spu/publish-rules.js";

const state = createRunState("test-run", ["/tmp/product.png"]);
const task = state.tasks[0];
const before = task.lastUpdatedAt;

await new Promise((resolve) => setTimeout(resolve, 5));

const updated = recordTaskProgress(task, "main_images_generated", "Prompt 2/5: Image 4: submitting edits request.");

assert.equal(updated.status, "main_images_generated");
assert.notEqual(updated.lastUpdatedAt, before);
assert.equal(updated.notes.at(-1), "main_images_generated: Prompt 2/5: Image 4: submitting edits request.");

const saved = recordTaskProgress(updated, "main_images_generated", "Prompt 2/5: Image 4: saved generated-04.png.");

assert.equal(saved.status, "main_images_generated");
assert.equal(saved.notes.at(-1), "main_images_generated: Prompt 2/5: Image 4: saved generated-04.png.");
assert.ok(saved.notes.length <= 25);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-listing-progress-"));
const eventsFile = path.join(tempDir, "events.ndjson");
fs.writeFileSync(
  eventsFile,
  [
    JSON.stringify({ timestamp: "2026-05-23T10:01:00.000Z", level: "info", taskId: "image-001", step: "main_images_generated", message: "Prompt 1/5: Image 1: saved generated-01.png." }),
    JSON.stringify({ timestamp: "2026-05-23T10:02:00.000Z", level: "info", taskId: "image-002", step: "main_images_generated", message: "Prompt 1/5: Image 1: submitting edits request." }),
    JSON.stringify({ timestamp: "2026-05-23T10:03:00.000Z", level: "info", taskId: "image-001", step: "main_images_generated", message: "Prompt 1/5: Image 2: submitting edits request." })
  ].join("\n") + "\n",
  "utf8"
);

const latestEvent = readLatestTaskProgressEvent(eventsFile, "image-001");

assert.deepEqual(latestEvent, {
  timestamp: "2026-05-23T10:03:00.000Z",
  step: "main_images_generated",
  message: "Prompt 1/5: Image 2: submitting edits request."
});

const pageNotReadyClass = classifyPublishFailure("Platform SPU query page was not ready after navigation.");
assert.equal(pageNotReadyClass, "platform_page_not_ready");
assert.equal(shouldRetryPublishFailure(pageNotReadyClass, 0), true);
assert.equal(shouldRetryPublishFailure(pageNotReadyClass, 2), false);
assert.equal(shouldRetryPublishFailure("validation_blocked", 0), false);

const cleanupTargets = selectCleanupTargets({
  candidates: [
    "/work/input/auto-listing/feishu-images/product-1.png",
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/qualifications/product-1-cert.png",
    "/work/input/auto-listing/qualifications/product-2-cert.png"
  ],
  protectedPaths: [
    "/work/input/auto-listing/feishu-images/product-2.png",
    "/work/input/auto-listing/qualifications/product-2-cert.png"
  ]
});

assert.deepEqual(cleanupTargets.sort(), [
  "/work/input/auto-listing/feishu-images/product-1.png",
  "/work/input/auto-listing/qualifications/product-1-cert.png"
]);
