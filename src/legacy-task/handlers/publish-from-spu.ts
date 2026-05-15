import type { PublishFromSpuTaskRequest, TaskResult } from "../types.js";
import { runPublishFromSpuJob } from "../../business/publish-from-spu.js";

export async function handlePublishFromSpuTask(task: PublishFromSpuTaskRequest): Promise<TaskResult> {
  const taskId = task.taskId || `task-${Date.now()}`;
  const result = await runPublishFromSpuJob(task.input, {
    runId: taskId,
    runtimeDir: task.runtimeDir,
    resultFile: task.resultFile
  });

  return {
    ...result,
    taskType: task.taskType,
    taskId
  };
}
