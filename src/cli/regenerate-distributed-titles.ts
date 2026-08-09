import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "../utils/atomic-file.js";
import { getProductCategoryPlan } from "../autolist/product-category.js";
import { regenerateDistributedTitleWorkbooks } from "../autolist/title-sheets.js";
import type { AutoListingRunState } from "../autolist/types.js";

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

const runtimeDir = path.resolve(argumentValue("--runtime-dir"));
if (!argumentValue("--runtime-dir")) {
  throw new Error("Usage: regenerate-distributed-titles --runtime-dir <locked run directory>");
}
const stateFile = path.join(runtimeDir, "state.json");
if (!fs.existsSync(stateFile)) {
  throw new Error(`Locked run state did not exist: ${stateFile}`);
}
const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as AutoListingRunState;
if (state.status !== "paused") {
  throw new Error(`Distributed title regeneration requires a paused run, got ${state.status}.`);
}
const task = state.tasks.find((item) => item.taskId === state.currentTaskId) || state.tasks[0];
if (!task?.feishuProductRecord) {
  throw new Error("Paused run did not retain an exact Feishu product record.");
}
const plan = getProductCategoryPlan(task.feishuProductRecord.productCategory);
if (task.generatedProductFolders.length !== plan.titleCount) {
  throw new Error(
    `Distributed title regeneration target mismatch: folders=${task.generatedProductFolders.length}, expected=${plan.titleCount}.`
  );
}
const artifact = regenerateDistributedTitleWorkbooks({
  productFolders: task.generatedProductFolders,
  keywordText: task.feishuProductRecord.titleKeywordText,
  fixedSuffixText: task.feishuProductRecord.titleSuffixText,
  productCategory: task.feishuProductRecord.productCategory,
  productPriceText: task.feishuProductRecord.productPriceText
});
const updatedAt = new Date().toISOString();
task.titleSheetArtifact = artifact;
task.lastUpdatedAt = updatedAt;
task.notes = [
  ...task.notes,
  `Regenerated ${artifact.generatedFiles.length} distributed title workbook(s) from the locked Feishu record.`
];
state.lastUpdatedAt = updatedAt;
atomicWriteJson(stateFile, state);

process.stdout.write(`${JSON.stringify({
  ok: true,
  runId: state.runId,
  recordId: task.feishuProductRecord.recordId,
  productCategory: plan.category,
  fixedSuffixText: task.feishuProductRecord.titleSuffixText,
  regeneratedCount: artifact.generatedFiles.length,
  titles: artifact.generatedFiles.map((item) => item.title)
}, null, 2)}\n`);
