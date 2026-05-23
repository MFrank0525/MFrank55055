import fs from "node:fs";

export interface LatestTaskProgressEvent {
  timestamp: string;
  step: string;
  message: string;
}

interface AutoListingEventRecord {
  timestamp?: string;
  level?: string;
  taskId?: string;
  step?: string;
  message?: string;
}

export function readLatestTaskProgressEvent(eventsFile: string, taskId?: string): LatestTaskProgressEvent | undefined {
  if (!eventsFile || !fs.existsSync(eventsFile)) {
    return undefined;
  }

  const lines = fs.readFileSync(eventsFile, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines.reverse()) {
    let event: AutoListingEventRecord;
    try {
      event = JSON.parse(line) as AutoListingEventRecord;
    } catch {
      continue;
    }
    if (event.level !== "info" || !event.timestamp || !event.step || !event.message) {
      continue;
    }
    if (taskId && event.taskId !== taskId) {
      continue;
    }
    return {
      timestamp: event.timestamp,
      step: event.step,
      message: event.message
    };
  }

  return undefined;
}
