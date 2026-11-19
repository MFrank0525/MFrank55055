import assert from "node:assert/strict";
import { validateFeishuPosterPromptBatch } from "../dist/src/autolist/deepseek-prompts.js";
const base = { recordId: "rec-valid", userCognitionName: "医用冷敷面膜", genericName: "医用面部冷敷贴",
  brand: "延草纲目", spu: "SPU-1", productCategory: "医疗器械", qualificationImages: [], whiteBackgroundImages: [] };
const result = validateFeishuPosterPromptBatch([
  { ...base, recordId: "rec-invalid", sellingPointText: "旧版产品卖点" },
  { ...base, sellingPointText: "突出放大的有设计感的艺术字：晒后冷敷护理，尺寸略小一些的有设计感的艺术字：清爽补水舒缓，官方正品，物理冷敷，补水保湿，独立包装，图示产品的使用步骤，突出产品使用部位。" }
]);
assert.equal(result.ok, false);
assert.equal(result.errors.length, 1);
assert.equal(result.errors[0].recordId, "rec-invalid");
assert.match(result.summary, /cache item 1/);
assert.match(result.summary, /固定整段结构/);
