import {
  SCENE_LOCATION_CONCEPTS,
  isSceneLocationConcept,
  requireSingleSceneLocationConcept,
  type SceneLocationConcept
} from "./scene-location-rules.js";

export const LOCAL_QWEN_VISION_MODEL = "qwen3-vl:8b";
export const MAIN_IMAGE_SCENE_ADHERENCE_GATE_VERSION = "local-qwen-vl-frame-clearance-audit-v5";

export interface MainImageSceneAdherenceItem {
  imageIndex: number;
  imageFile: string;
  scenePrompt: string;
  model: string;
  needMatch: boolean;
  environmentMatch: boolean;
  interactionMatch: boolean;
  productVisible: boolean;
  brandFrameClear: boolean;
  brandFrameBreathingRoom: boolean;
  observedLocationConcept: SceneLocationConcept;
  observedScene: string;
  reasons: string[];
}

export interface MainImageSceneAdherenceReport {
  ok: boolean;
  gateVersion: string;
  model: string;
  items: MainImageSceneAdherenceItem[];
}

export function validateMainImageSceneAdherencePayload(value: unknown): Omit<MainImageSceneAdherenceItem, "imageIndex" | "imageFile" | "scenePrompt" | "model"> {
  const item = value as Record<string, unknown> | null;
  if (!item) throw new Error("Local vision scene audit returned no JSON object.");
  for (const field of ["needMatch", "environmentMatch", "interactionMatch", "productVisible", "brandFrameClear", "brandFrameBreathingRoom"] as const) {
    if (typeof item[field] !== "boolean") {
      throw new Error(`Local vision scene audit field ${field} must be boolean.`);
    }
  }
  if (!isSceneLocationConcept(item.observedLocationConcept)) {
    throw new Error(
      `Local vision scene audit field observedLocationConcept must be one of ${SCENE_LOCATION_CONCEPTS.join(",")}.`
    );
  }
  const observedScene = String(item.observedScene || "").trim();
  const reasons = Array.isArray(item.reasons) ? item.reasons.map((entry) => String(entry).trim()).filter(Boolean) : [];
  if (!observedScene || reasons.length === 0) {
    throw new Error("Local vision scene audit must explain the observed scene and reasons.");
  }
  return {
    needMatch: item.needMatch as boolean,
    environmentMatch: item.environmentMatch as boolean,
    interactionMatch: item.interactionMatch as boolean,
    productVisible: item.productVisible as boolean,
    brandFrameClear: item.brandFrameClear as boolean,
    brandFrameBreathingRoom: item.brandFrameBreathingRoom as boolean,
    observedLocationConcept: item.observedLocationConcept,
    observedScene,
    reasons
  };
}

export function isMainImageSceneAdherenceAccepted(item: MainImageSceneAdherenceItem): boolean {
  const targetConcept = requireSingleSceneLocationConcept(
    item.scenePrompt,
    `Main image ${item.imageIndex} target scene`
  );
  return item.needMatch
    && item.environmentMatch
    && item.productVisible
    && item.brandFrameClear
    && item.brandFrameBreathingRoom
    && item.observedLocationConcept === targetConcept;
}

export function assertMainImageSceneAdherenceReport(report: MainImageSceneAdherenceReport): MainImageSceneAdherenceReport {
  if (report.gateVersion !== MAIN_IMAGE_SCENE_ADHERENCE_GATE_VERSION || report.model !== LOCAL_QWEN_VISION_MODEL) {
    throw new Error("main_image_scene_adherence_rejected: local vision report version or model mismatch.");
  }
  const targetConceptOwners = new Map<SceneLocationConcept, string>();
  for (const item of report.items) {
    const targetConcept = requireSingleSceneLocationConcept(
      item.scenePrompt,
      `Main image ${item.imageIndex} target scene`
    );
    if (item.observedLocationConcept !== targetConcept) {
      throw new Error(
        `main_image_scene_adherence_rejected: image ${item.imageIndex} observed location ${item.observedLocationConcept} does not match target ${targetConcept}.`
      );
    }
    const owner = targetConceptOwners.get(targetConcept);
    if (owner && owner !== item.scenePrompt) {
      throw new Error(`main_image_scene_adherence_rejected: target scenes repeat ${targetConcept}.`);
    }
    targetConceptOwners.set(targetConcept, item.scenePrompt);
  }
  const rejected = report.items.filter((item) => !isMainImageSceneAdherenceAccepted(item));
  if (rejected.length > 0 || !report.ok) {
    throw new Error(
      `main_image_scene_adherence_rejected: images=${rejected.map((item) => item.imageIndex).join(",") || "unknown"}`
    );
  }
  return report;
}
