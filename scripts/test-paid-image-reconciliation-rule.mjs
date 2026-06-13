import assert from "node:assert/strict";
import fs from "node:fs";
import {
  validatePaidImageProviderTaskForReconciliation
} from "../dist/src/autolist/paid-image-reconciliation.js";

const cliSource = fs.readFileSync("src/cli/reconcile-paid-image-task.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const ruleDoc = fs.readFileSync("docs/auto-listing/steps/03-main-image-generation.md", "utf8");

assert.deepEqual(
  validatePaidImageProviderTaskForReconciliation({
    requestedTaskId: "task_expected",
    slotCreatedAt: "2026-06-13T09:47:06.000Z",
    payload: { id: "task_expected", status: "completed", progress: 100, created_at: 1781344029 }
  }),
  { taskId: "task_expected", status: "completed" }
);
assert.throws(
  () =>
    validatePaidImageProviderTaskForReconciliation({
      requestedTaskId: "task_expected",
      slotCreatedAt: "2026-06-13T09:47:06.000Z",
      payload: { id: "task_expected", status: "completed", created_at: 1781250000 }
    }),
  /creation time does not match/i
);
assert.throws(
  () =>
    validatePaidImageProviderTaskForReconciliation({
      requestedTaskId: "task_expected",
      payload: { id: "task_other", status: "completed" }
    }),
  /task id mismatch/i
);
assert.throws(
  () =>
    validatePaidImageProviderTaskForReconciliation({
      requestedTaskId: "task_expected",
      payload: { id: "task_expected", status: "failed" }
    }),
  /failed provider task/i
);
assert.match(cliSource, /reconcileAmbiguousPaidImageTask/);
assert.match(cliSource, /reconcileAmbiguousPaidImageNoAcceptance/);
assert.match(cliSource, /reconcileAmbiguousPaidImageProviderFailure/);
assert.match(cliSource, /validatePaidImageProviderTaskForReconciliation/);
assert.match(cliSource, /readPaidImageSlotRecord/);
assert.match(cliSource, /Authorization: "Bearer " \+ config\.apiKey/);
assert.match(cliSource, /--no-provider-task/);
assert.match(cliSource, /--provider-failure/);
assert.match(packageJson.scripts["auto-listing:reconcile-paid-image-task"], /reconcile-paid-image-task/);
assert.match(ruleDoc, /显式对账恢复/);
assert.match(ruleDoc, /验证供应商任务 ID 和状态/);
assert.match(ruleDoc, /未受理/);
assert.match(ruleDoc, /供应商任务明确失败/);
