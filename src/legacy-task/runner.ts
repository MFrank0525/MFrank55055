import fs from "node:fs";
import path from "node:path";
import { handleDoubaoRunTask } from "./handlers/doubao-run.js";
import { handlePublishFromSpuTask } from "./handlers/publish-from-spu.js";
import type { TaskRequest, TaskResult } from "./types.js";

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Task file must contain a JSON object.");
  }
}

export function loadTaskFile(taskFile: string): TaskRequest {
  const resolvedPath = path.resolve(taskFile);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Task file not found: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, "utf8").replace(/^\uFEFF/, "").trimStart();
  const parsed = JSON.parse(raw) as unknown;
  assertObject(parsed);

  if (typeof parsed.taskType !== "string" || !parsed.taskType.trim()) {
    throw new Error("Task file missing required field: taskType");
  }

  return parsed as unknown as TaskRequest;
}

function writeTaskResult(result: TaskResult): void {
  const resultFile = result.artifacts.resultFile || path.join(result.runtimeDir, "result.json");
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function buildUnsupportedTaskResult(task: TaskRequest, message: string): TaskResult {
  const taskId = task.taskId || `task-${Date.now()}`;
  const runtimeDir = path.resolve(task.runtimeDir || path.join(process.cwd(), "data", "tasks", taskId));
  const resultFile = path.resolve(task.resultFile || path.join(runtimeDir, "result.json"));
  const now = new Date().toISOString();

  return {
    ok: false,
    taskType: task.taskType,
    taskId,
    status: "unsupported",
    message,
    startedAt: now,
    finishedAt: now,
    runtimeDir,
    artifacts: {
      resultFile
    },
    error: {
      code: "UNSUPPORTED_TASK",
      message
    }
  };
}

export async function runTask(task: TaskRequest): Promise<TaskResult> {
  let result: TaskResult;
  const taskType = (task as { taskType?: string }).taskType;

  switch (taskType) {
    case "doubao.run":
      result = await handleDoubaoRunTask(task as import("./types.js").DoubaoRunTaskRequest);
      break;
    case "publish_from_spu":
      result = await handlePublishFromSpuTask(task as import("./types.js").PublishFromSpuTaskRequest);
      break;
    default:
      result = buildUnsupportedTaskResult(
        task,
        typeof taskType === "string" ? `Unsupported task type: ${taskType}` : "Task file missing required field: taskType"
      );
      break;
  }

  writeTaskResult(result);
  return result;
}
