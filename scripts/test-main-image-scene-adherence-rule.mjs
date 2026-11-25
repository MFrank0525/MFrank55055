import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertMainImageSceneAdherenceReport,
  isMainImageSceneAdherenceAccepted,
  LOCAL_QWEN_VISION_MODEL,
  MAIN_IMAGE_SCENE_ADHERENCE_GATE_VERSION,
  validateMainImageSceneAdherencePayload
} from "../dist/src/autolist/main-image-scene-adherence-rules.js";
import { requireLocalOllamaHost } from "../dist/src/autolist/local-ollama-rules.js";

assert.equal(requireLocalOllamaHost(), "http://127.0.0.1:11434");
assert.equal(requireLocalOllamaHost("http://localhost:11434/"), "http://localhost:11434");
assert.throws(() => requireLocalOllamaHost("https://example.com"), /external model host rejected/);
assert.throws(() => requireLocalOllamaHost("http://192.168.1.8:11434"), /external model host rejected/);

const acceptedPayload = validateMainImageSceneAdherencePayload({
  needMatch: true,
  environmentMatch: true,
  interactionMatch: false,
  productVisible: true,
  brandFrameClear: true,
  observedLocationConcept: "sports",
  observedScene: "户外运动防晒场景",
  reasons: ["需求和环境清楚，人物动作可以简化。"]
});
const acceptedItem = {
  imageIndex: 1,
  imageFile: "/tmp/image.png",
  scenePrompt: "环境：阳光充足的户外网球场。互动关系：商品放在运动装备旁。",
  model: LOCAL_QWEN_VISION_MODEL,
  ...acceptedPayload
};
assert.doesNotThrow(() => assertMainImageSceneAdherenceReport({
  ok: true,
  gateVersion: MAIN_IMAGE_SCENE_ADHERENCE_GATE_VERSION,
  model: LOCAL_QWEN_VISION_MODEL,
  items: [acceptedItem]
}));
assert.equal(isMainImageSceneAdherenceAccepted(acceptedItem), true);
assert.equal(isMainImageSceneAdherenceAccepted({ ...acceptedItem, observedLocationConcept: "beach" }), false);
assert.throws(() => assertMainImageSceneAdherenceReport({
  ok: false,
  gateVersion: MAIN_IMAGE_SCENE_ADHERENCE_GATE_VERSION,
  model: LOCAL_QWEN_VISION_MODEL,
  items: [{ ...acceptedItem, needMatch: false }]
}), /main_image_scene_adherence_rejected/);
assert.throws(() => assertMainImageSceneAdherenceReport({
  ok: true,
  gateVersion: MAIN_IMAGE_SCENE_ADHERENCE_GATE_VERSION,
  model: LOCAL_QWEN_VISION_MODEL,
  items: [{ ...acceptedItem, observedLocationConcept: "beach" }]
}), /observed location beach does not match target sports/);
assert.throws(() => assertMainImageSceneAdherenceReport({
  ok: true,
  gateVersion: MAIN_IMAGE_SCENE_ADHERENCE_GATE_VERSION,
  model: LOCAL_QWEN_VISION_MODEL,
  items: [
    { ...acceptedItem, imageIndex: 1, scenePrompt: "环境：阳光明亮的海边沙滩。", observedLocationConcept: "beach" },
    { ...acceptedItem, imageIndex: 2, scenePrompt: "环境：夏日海滩。", observedLocationConcept: "beach" }
  ]
}), /target scenes repeat beach/);
assert.throws(() => validateMainImageSceneAdherencePayload({
  needMatch: true,
  environmentMatch: true,
  interactionMatch: true,
  productVisible: true,
  brandFrameClear: true,
  observedLocationConcept: "outdoor",
  observedScene: "泛化户外空间",
  reasons: ["地点不具体。"]
}), /observedLocationConcept/);

const assetsSource = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
assert.match(assetsSource, /await assertMainImageSceneAdherence/);
assert.ok(
  assetsSource.lastIndexOf("await assertMainImageSceneAdherence") < assetsSource.lastIndexOf("finalizeProductFolders(stagedFiles"),
  "Local vision scene adherence must pass before shop product folders are finalized."
);
const plannerSource = fs.readFileSync("src/autolist/qwen-scene-planner.ts", "utf8");
assert.match(plannerSource, /requireLocalOllamaHost/);

console.log("main image local vision scene adherence rule passed");
