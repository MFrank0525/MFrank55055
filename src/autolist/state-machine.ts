import path from "node:path";
import { AUTO_LISTING_STEPS } from "./types.js";
import type {
  AutoListingEvent,
  AutoListingRunState,
  AutoListingStatus,
  AutoListingTaskError,
  AutoListingStep,
  ImageTaskState
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function createRunState(runId: string, imagePaths: string[]): AutoListingRunState {
  const timestamp = nowIso();
  return {
    runId,
    startedAt: timestamp,
    lastUpdatedAt: timestamp,
    status: "running",
    tasks: imagePaths.map((filePath, index) => ({
      taskId: `image-${String(index + 1).padStart(3, "0")}`,
      sequenceNo: index + 1,
      sourceImagePath: path.resolve(filePath),
      sourceImageName: path.basename(filePath),
      status: "source_images_discovered",
      startedAt: timestamp,
      lastUpdatedAt: timestamp,
      generatedProductFolders: [],
      notes: []
    })),
    errors: []
  };
}

export function advanceTask(task: ImageTaskState, nextStatus: AutoListingStatus, note?: string): ImageTaskState {
  const timestamp = nowIso();
  const nextTask: ImageTaskState = {
    ...task,
    status: nextStatus,
    lastUpdatedAt: timestamp,
    finishedAt: nextStatus === "done" ? timestamp : task.finishedAt
  };
  if (note) {
    nextTask.notes = [...task.notes, note];
  }
  return nextTask;
}

export function recordTaskProgress(task: ImageTaskState, step: AutoListingStatus, message: string): ImageTaskState {
  const timestamp = nowIso();
  const note = `${step}: ${message}`;
  return {
    ...task,
    status: step,
    lastUpdatedAt: timestamp,
    notes: [...task.notes, note].slice(-25)
  };
}

export function failTask(task: ImageTaskState, step: string, message: string): ImageTaskState {
  const timestamp = nowIso();
  const error: AutoListingTaskError = {
    step,
    message,
    capturedAt: timestamp
  };
  return {
    ...task,
    status: "failed",
    lastUpdatedAt: timestamp,
    finishedAt: timestamp,
    error,
    notes: [...task.notes, `failed at ${step}: ${message}`]
  };
}

export function createEvent(level: "info" | "error", step: string, message: string, taskId?: string): AutoListingEvent {
  return {
    timestamp: nowIso(),
    level,
    taskId,
    step,
    message
  };
}

export function markRunCompleted(state: AutoListingRunState): AutoListingRunState {
  return {
    ...state,
    status: "completed",
    currentTaskId: undefined,
    lastUpdatedAt: nowIso()
  };
}

export function markRunFailed(state: AutoListingRunState, error: AutoListingTaskError): AutoListingRunState {
  return {
    ...state,
    status: "failed",
    currentTaskId: undefined,
    lastUpdatedAt: nowIso(),
    errors: [...state.errors, error]
  };
}

export function markRunPaused(state: AutoListingRunState): AutoListingRunState {
  return {
    ...state,
    status: "paused",
    lastUpdatedAt: nowIso()
  };
}

export function getPlannedSteps(): AutoListingStep[] {
  return [...AUTO_LISTING_STEPS];
}
