import assert from "node:assert/strict";
import fs from "node:fs";
import {
  matchProviderBilledAcceptanceAfterGateway,
  matchProviderNoAcceptanceLogs,
  matchProviderNoAcceptanceLogsWithRefresh,
  validatePaidImageProviderTaskForReconciliation
} from "../dist/src/autolist/paid-image-reconciliation.js";

const cliSource = fs.readFileSync("src/cli/reconcile-paid-image-task.ts", "utf8");
const providerLogActionSource = fs.readFileSync("src/autolist/paid-image-provider-log-reconciliation-action.ts", "utf8");
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

const noAcceptanceMatches = matchProviderNoAcceptanceLogs({
  model: "gpt-image-2",
  maximumClockSkewMs: 2_000,
  slots: [
    { slot: 1, updatedAt: "2026-09-14T04:58:26.997Z", responseStatus: 524 },
    { slot: 5, updatedAt: "2026-09-14T04:58:38.056Z", responseStatus: 524 },
    { slot: 6, updatedAt: "2026-09-14T05:00:32.633Z", responseStatus: 524 }
  ],
  logs: [
    { id: 101, created_at: 1789361907, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" },
    { id: 102, created_at: 1789361919, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" },
    { id: 103, created_at: 1789362033, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" },
    { id: 104, created_at: 1789361910, type: 2, model_name: "gpt-image-2", quota: 21250, upstream_request_id: "accepted-task" }
  ]
});
assert.deepEqual(noAcceptanceMatches.map(({ slot, logId }) => ({ slot, logId })), [
  { slot: 1, logId: "101" },
  { slot: 5, logId: "102" },
  { slot: 6, logId: "103" }
]);

for (const unsafeLog of [
  { id: 201, created_at: 1789361907, type: 5, model_name: "gpt-image-2", quota: 1, content: "status_code=524, error code: 524\n" },
  { id: 202, created_at: 1789361907, type: 5, model_name: "gpt-image-2", quota: 0, upstream_request_id: "possibly-accepted", content: "status_code=524, error code: 524\n" },
  { id: 203, created_at: 1789361907, type: 5, model_name: "other-model", quota: 0, content: "status_code=524, error code: 524\n" },
  { id: 204, created_at: 1789361907, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=500, error code: 500\n" }
]) {
  assert.throws(
    () => matchProviderNoAcceptanceLogs({
      model: "gpt-image-2",
      maximumClockSkewMs: 2_000,
      slots: [{ slot: 1, updatedAt: "2026-09-14T04:58:26.997Z", responseStatus: 524 }],
      logs: [unsafeLog]
    }),
    /unique zero-billed no-acceptance log/i
  );
}

assert.throws(
  () => matchProviderNoAcceptanceLogs({
    model: "gpt-image-2",
    maximumClockSkewMs: 2_000,
    slots: [{ slot: 1, updatedAt: "2026-09-14T04:58:26.997Z", responseStatus: 524 }],
    logs: [
      { id: 301, created_at: 1789361907, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" },
      { id: 302, created_at: 1789361908, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" }
    ]
  }),
  /unique zero-billed no-acceptance log/i
);

assert.deepEqual(
  matchProviderNoAcceptanceLogs({
    model: "gpt-image-2",
    maximumClockSkewMs: 5_000,
    slots: [{ slot: 14, updatedAt: "2026-09-14T10:54:44.508Z", responseStatus: 524 }],
    logs: [{ id: 401, created_at: 1789383287, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" }]
  }).map(({ slot, logId, clockSkewMs }) => ({ slot, logId, clockSkewMs })),
  [{ slot: 14, logId: "401", clockSkewMs: 2_492 }]
);

assert.deepEqual(
  matchProviderNoAcceptanceLogs({
    model: "gpt-image-2",
    maximumClockSkewMs: 5_000,
    slots: [{ slot: 16, updatedAt: "2026-09-15T07:38:03.403Z", responseStatus: 502 }],
    logs: [{ id: 501, created_at: 1789457883, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=502, error code: 502\n" }]
  }).map(({ slot, logId, clockSkewMs }) => ({ slot, logId, clockSkewMs })),
  [{ slot: 16, logId: "501", clockSkewMs: 403 }]
);

{
  let loadCount = 0;
  let waitCount = 0;
  const refreshed = await matchProviderNoAcceptanceLogsWithRefresh({
    model: "gpt-image-2",
    maximumClockSkewMs: 5_000,
    maximumAttempts: 3,
    slots: [{ slot: 20, updatedAt: "2026-09-15T11:49:36.215Z", responseStatus: 524 }],
    loadLogs: async () => {
      loadCount += 1;
      return loadCount === 1
        ? []
        : [{ id: 601, created_at: 1789472977, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" }];
    },
    waitBeforeRetry: async () => {
      waitCount += 1;
    }
  });
  assert.deepEqual(refreshed.map(({ slot, logId }) => ({ slot, logId })), [{ slot: 20, logId: "601" }]);
  assert.equal(loadCount, 2);
  assert.equal(waitCount, 1);
}

{
  let loadCount = 0;
  let waitCount = 0;
  await assert.rejects(
    () => matchProviderNoAcceptanceLogsWithRefresh({
      model: "gpt-image-2",
      maximumClockSkewMs: 5_000,
      maximumAttempts: 3,
      slots: [{ slot: 20, updatedAt: "2026-09-15T11:49:36.215Z", responseStatus: 524 }],
      loadLogs: async () => {
        loadCount += 1;
        return [];
      },
      waitBeforeRetry: async () => {
        waitCount += 1;
      }
    }),
    /found no candidate/i
  );
  assert.equal(loadCount, 3);
  assert.equal(waitCount, 2);
}

for (const unsafeGatewayEvidence of [
  {
    slotStatus: 502,
    logContent: "status_code=524, error code: 524\n"
  },
  {
    slotStatus: 500,
    logContent: "status_code=500, error code: 500\n"
  }
]) {
  assert.throws(
    () => matchProviderNoAcceptanceLogs({
      model: "gpt-image-2",
      maximumClockSkewMs: 5_000,
      slots: [{ slot: 16, updatedAt: "2026-09-15T07:38:03.403Z", responseStatus: unsafeGatewayEvidence.slotStatus }],
      logs: [{ id: 502, created_at: 1789457883, type: 5, model_name: "gpt-image-2", quota: 0, content: unsafeGatewayEvidence.logContent }]
    }),
    /HTTP|unique zero-billed no-acceptance log/i
  );
}
assert.match(providerLogActionSource, /PROVIDER_LOG_CLOCK_SKEW_MS\s*=\s*5_000/);
assert.match(providerLogActionSource, /provider_log_billed_acceptance_without_task_id/);
assert.match(providerLogActionSource, /PROVIDER_BILLED_ACCEPTANCE_POST_RESPONSE_LAG_MS\s*=\s*60_000/);

assert.deepEqual(
  matchProviderBilledAcceptanceAfterGateway({
    model: "gpt-image-2",
    maximumPostResponseLagMs: 60_000,
    slots: [{ slot: 11, updatedAt: "2026-09-16T13:11:19.549Z", responseStatus: 524 }],
    logs: [{
      id: 701,
      created_at: 1789564298,
      type: 2,
      model_name: "gpt-image-2",
      quota: 21250,
      content: "操作 textGenerate，按次计费",
      request_id: "request-701",
      upstream_request_id: "upstream-701",
      other: { request_path: "/v1/videos", is_task: true }
    }]
  }),
  [{
    slot: 11,
    logId: "701",
    logCreatedAt: 1789564298,
    postResponseLagMs: 18451,
    requestId: "request-701",
    upstreamRequestId: "upstream-701"
  }]
);
assert.throws(
  () => matchProviderBilledAcceptanceAfterGateway({
    model: "gpt-image-2",
    maximumPostResponseLagMs: 60_000,
    slots: [{ slot: 11, updatedAt: "2026-09-16T13:11:19.549Z", responseStatus: 524 }],
    logs: [
      { id: 702, created_at: 1789564298, type: 2, model_name: "gpt-image-2", quota: 21250, content: "操作 textGenerate，按次计费", upstream_request_id: "a", other: { request_path: "/v1/videos", is_task: true } },
      { id: 703, created_at: 1789564299, type: 2, model_name: "gpt-image-2", quota: 21250, content: "操作 textGenerate，按次计费", upstream_request_id: "b", other: { request_path: "/v1/videos", is_task: true } }
    ]
  }),
  /unique post-gateway billed acceptance/i
);
assert.throws(
  () => matchProviderBilledAcceptanceAfterGateway({
    model: "gpt-image-2",
    maximumPostResponseLagMs: 60_000,
    slots: [{ slot: 11, updatedAt: "2026-09-16T13:11:19.549Z", responseStatus: 524 }],
    logs: [{ id: 704, created_at: 1789564298, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524" }]
  }),
  /unique post-gateway billed acceptance/i
);

assert.deepEqual(
  matchProviderNoAcceptanceLogs({
    model: "gpt-image-2",
    maximumClockSkewMs: 5_000,
    slots: [
      { slot: 2, updatedAt: "2026-09-14T20:19:03.707Z", responseStatus: 524 },
      { slot: 3, updatedAt: "2026-09-14T20:19:03.814Z", responseStatus: 524 }
    ],
    logs: [
      { id: 22, created_at: 1789417145, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" },
      { id: 23, created_at: 1789417145, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" }
    ]
  }).map(({ slot, logId }) => ({ slot, logId })),
  [{ slot: 2, logId: "22" }, { slot: 3, logId: "23" }]
);

assert.throws(
  () => matchProviderNoAcceptanceLogs({
    model: "gpt-image-2",
    maximumClockSkewMs: 5_000,
    slots: [
      { slot: 2, updatedAt: "2026-09-14T20:19:03.707Z", responseStatus: 524 },
      { slot: 3, updatedAt: "2026-09-14T20:19:03.814Z", responseStatus: 524 }
    ],
    logs: [
      { id: 22, created_at: 1789417145, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" },
      { id: 23, created_at: 1789417145, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" },
      { id: 24, created_at: 1789417146, type: 5, model_name: "gpt-image-2", quota: 0, content: "status_code=524, error code: 524\n" }
    ]
  }),
  /one-to-one.*unique zero-billed/i
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
