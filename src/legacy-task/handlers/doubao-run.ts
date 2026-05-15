import path from "node:path";
import { runDoubaoJob } from "../../doubao/run.js";
import type { DoubaoJobInput } from "../../doubao/types.js";
import type { DoubaoRunTaskRequest, TaskResult } from "../types.js";

export async function handleDoubaoRunTask(task: DoubaoRunTaskRequest): Promise<TaskResult> {
  const startedAt = new Date().toISOString();
  const taskId = task.taskId || `task-${Date.now()}`;
  const runtimeDir = path.resolve(task.runtimeDir || path.join(process.cwd(), "data", "tasks", taskId));
  const resultFile = path.resolve(task.resultFile || path.join(runtimeDir, "result.json"));

  try {
    const jobInput: DoubaoJobInput = {
      ...task.input,
      runtimeDir,
      resultFile
    };
    const jobResult = await runDoubaoJob(jobInput);

    return {
      ok: true,
      taskType: task.taskType,
      taskId,
      status: "success",
      message: `Processed ${jobResult.items.length} image(s).`,
      startedAt,
      finishedAt: new Date().toISOString(),
      runtimeDir,
      artifacts: {
        logFile: jobResult.logFile,
        resultFile,
        screenshots: []
      },
      data: {
        itemCount: jobResult.items.length,
        items: jobResult.items
      }
    };
  } catch (error) {
    return {
      ok: false,
      taskType: task.taskType,
      taskId,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      startedAt,
      finishedAt: new Date().toISOString(),
      runtimeDir,
      artifacts: {
        resultFile
      },
      error: {
        code: "TASK_FAILED",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }
    };
  }
}
