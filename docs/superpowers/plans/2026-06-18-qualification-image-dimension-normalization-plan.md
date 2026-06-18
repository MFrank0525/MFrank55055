# Qualification Image Dimension Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize oversized qualification images into verified runtime copies before Doudian upload so images above the 5000px platform limit no longer block publishing.

**Architecture:** Keep dimension policy in a pure TypeScript rule module. Add a focused Pillow CLI for image probing and resizing, wrapped by a TypeScript action that computes target dimensions through the rule module and writes deterministic runtime copies. Replace only the in-memory `ProductAssets.detailImages` paths before any browser operation; source and distributed files remain immutable.

**Tech Stack:** TypeScript, Node.js ESM, Python 3, Pillow, Playwright, script-based rule tests.

---

## File Structure

- Create `src/business/publish-from-spu/qualification-image-rules.ts`: pure threshold, proportional-dimension, and output-verification rules.
- Create `src/business/publish-from-spu/qualification-image-normalizer.py`: Pillow probe/resize action with JSON output.
- Create `src/business/publish-from-spu/qualification-image-normalizer.ts`: Node wrapper, deterministic output paths, source hash preservation, and fail-closed orchestration.
- Create `scripts/test-qualification-image-normalization-rule.mjs`: pure-rule and real Pillow action regressions.
- Modify `src/business/publish-from-spu.ts`: prepare qualification upload paths before opening Doudian.
- Modify `scripts/test-publish-module-sequence-rule.mjs`: structural regression proving preprocessing occurs before browser actions and affects only detail images.
- Modify `package.json`: include the new focused test in `rules:check`.
- Modify `docs/auto-listing/stability-checklist.md`: document the 5000px/4900px invariant and immutable-source rule.

### Task 1: Define the Pure Dimension Policy

**Files:**
- Create: `src/business/publish-from-spu/qualification-image-rules.ts`
- Create: `scripts/test-qualification-image-normalization-rule.mjs`

- [ ] **Step 1: Write failing pure-rule tests**

Create `scripts/test-qualification-image-normalization-rule.mjs` with these assertions:

```js
import assert from "node:assert/strict";
import {
  resolveQualificationImageResize,
  verifyNormalizedQualificationImage
} from "../dist/src/business/publish-from-spu/qualification-image-rules.js";

assert.deepEqual(
  resolveQualificationImageResize({ width: 5534, height: 4141 }),
  { action: "resize", targetWidth: 4900, targetHeight: 3666 }
);
assert.deepEqual(
  resolveQualificationImageResize({ width: 1655, height: 2338 }),
  { action: "reuse", targetWidth: 1655, targetHeight: 2338 }
);
assert.deepEqual(
  resolveQualificationImageResize({ width: 5000, height: 3200 }),
  { action: "reuse", targetWidth: 5000, targetHeight: 3200 }
);
assert.throws(
  () => resolveQualificationImageResize({ width: 0, height: 4141 }),
  /invalid qualification image dimensions/i
);
assert.deepEqual(
  verifyNormalizedQualificationImage({ width: 4900, height: 3666, targetWidth: 4900, targetHeight: 3666 }),
  { passed: true, issue: "" }
);
assert.match(
  verifyNormalizedQualificationImage({ width: 5001, height: 3666, targetWidth: 4900, targetHeight: 3666 }).issue,
  /exceeded target dimensions/i
);
assert.match(
  verifyNormalizedQualificationImage({ width: 4900, height: 3665, targetWidth: 4900, targetHeight: 3666 }).issue,
  /did not match requested dimensions/i
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node scripts/test-qualification-image-normalization-rule.mjs
```

Expected: FAIL because `qualification-image-rules.js` does not exist.

- [ ] **Step 3: Implement the minimal pure rule**

Create `src/business/publish-from-spu/qualification-image-rules.ts`:

```ts
export const QUALIFICATION_IMAGE_PLATFORM_LIMIT = 5000;
export const QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE = 4900;

export type QualificationImageResizeDecision = {
  action: "reuse" | "resize";
  targetWidth: number;
  targetHeight: number;
};

export function resolveQualificationImageResize(input: {
  width: number;
  height: number;
}): QualificationImageResizeDecision {
  const width = Math.floor(input.width);
  const height = Math.floor(input.height);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid qualification image dimensions: width=${input.width}; height=${input.height}`);
  }
  if (width <= QUALIFICATION_IMAGE_PLATFORM_LIMIT && height <= QUALIFICATION_IMAGE_PLATFORM_LIMIT) {
    return { action: "reuse", targetWidth: width, targetHeight: height };
  }
  const longest = Math.max(width, height);
  const scale = QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE / longest;
  return {
    action: "resize",
    targetWidth: Math.max(1, Math.floor(width * scale)),
    targetHeight: Math.max(1, Math.floor(height * scale))
  };
}

export function verifyNormalizedQualificationImage(input: {
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
}): { passed: boolean; issue: string } {
  if (input.width <= 0 || input.height <= 0) {
    return { passed: false, issue: `Normalized qualification image has invalid dimensions. width=${input.width}; height=${input.height}` };
  }
  if (input.width > QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE || input.height > QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE) {
    return { passed: false, issue: `Normalized qualification image exceeded target dimensions. width=${input.width}; height=${input.height}; limit=${QUALIFICATION_IMAGE_TARGET_LONGEST_EDGE}` };
  }
  if (input.width !== input.targetWidth || input.height !== input.targetHeight) {
    return { passed: false, issue: `Normalized qualification image did not match requested dimensions. expected=${input.targetWidth}x${input.targetHeight}; actual=${input.width}x${input.height}` };
  }
  return { passed: true, issue: "" };
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm run build && node scripts/test-qualification-image-normalization-rule.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the rule**

```bash
git add src/business/publish-from-spu/qualification-image-rules.ts scripts/test-qualification-image-normalization-rule.mjs
git commit -m "Define qualification image dimension policy"
```

### Task 2: Add the Pillow Probe and Resize Action

**Files:**
- Create: `src/business/publish-from-spu/qualification-image-normalizer.py`
- Create: `src/business/publish-from-spu/qualification-image-normalizer.ts`
- Modify: `scripts/test-qualification-image-normalization-rule.mjs`

- [ ] **Step 1: Add failing action tests**

Extend `scripts/test-qualification-image-normalization-rule.mjs` to create a temporary directory, generate one `5534×4141` PNG, one `5200×2600` JPEG, one `1655×2338` PNG, and one corrupt PNG with Pillow, then call `prepareQualificationImagesForUpload`.

Required assertions:

```js
const prepared = await prepareQualificationImagesForUpload({
  files: [oversizedPng, oversizedJpeg, compliantPng],
  outputDir: path.join(tempDir, "normalized")
});
assert.equal(prepared.files.length, 3);
assert.equal(prepared.entries[0].action, "resize");
assert.deepEqual(prepared.entries[0].outputDimensions, { width: 4900, height: 3666 });
assert.deepEqual(prepared.entries[1].outputDimensions, { width: 4900, height: 2450 });
assert.equal(prepared.entries[2].action, "reuse");
assert.equal(prepared.files[2], compliantPng);
assert.equal(hashFile(oversizedPng), sourceHashes.get(oversizedPng));
assert.equal(hashFile(oversizedJpeg), sourceHashes.get(oversizedJpeg));
await assert.rejects(
  prepareQualificationImagesForUpload({ files: [corruptPng], outputDir: path.join(tempDir, "corrupt") }),
  /dimension probe failed/i
);
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run build && node scripts/test-qualification-image-normalization-rule.mjs
```

Expected: FAIL because `prepareQualificationImagesForUpload` and the Pillow action do not exist.

- [ ] **Step 3: Implement the Pillow CLI**

Create `src/business/publish-from-spu/qualification-image-normalizer.py` with two explicit modes:

```python
from PIL import Image, ImageOps

def probe(input_file):
    with Image.open(input_file) as source:
        image = ImageOps.exif_transpose(source)
        return {"ok": True, "width": image.width, "height": image.height, "format": source.format or ""}

def resize(input_file, output_file, width, height):
    with Image.open(input_file) as source:
        image = ImageOps.exif_transpose(source)
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        extension = os.path.splitext(output_file)[1].lower()
        if extension in (".jpg", ".jpeg") and resized.mode not in ("RGB", "L"):
            resized = resized.convert("RGB")
        resized.save(output_file)
    return probe(output_file)
```

The CLI must accept `--input`, optional `--output`, optional `--width`, and optional `--height`; probe when no output is supplied, resize otherwise; print one final JSON object; return nonzero with `{"ok": false, "error": ...}` on failure.

- [ ] **Step 4: Implement the TypeScript wrapper**

Create `src/business/publish-from-spu/qualification-image-normalizer.ts` following the existing `local-watermark.ts` process convention:

```ts
export type PreparedQualificationImages = {
  files: string[];
  entries: Array<{
    sourceFile: string;
    outputFile: string;
    action: "reuse" | "resize";
    sourceDimensions: { width: number; height: number };
    outputDimensions: { width: number; height: number };
  }>;
};

export async function prepareQualificationImagesForUpload(options: {
  files: string[];
  outputDir: string;
}): Promise<PreparedQualificationImages>;
```

For every file, the wrapper must:

1. hash the source with SHA-256;
2. probe dimensions through the Pillow CLI;
3. call `resolveQualificationImageResize`;
4. reuse compliant paths unchanged;
5. write oversized outputs as `<stem>-<hash8>-max4900<ext>` inside `outputDir`;
6. probe the output and call `verifyNormalizedQualificationImage`;
7. compare the source SHA-256 after processing with the original hash;
8. throw a filename-specific error on every failure, without falling back to the source.

- [ ] **Step 5: Verify GREEN for PNG, JPEG, compliant reuse, immutability, and corrupt input**

Run:

```bash
npm run build && node scripts/test-qualification-image-normalization-rule.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the action**

```bash
git add src/business/publish-from-spu/qualification-image-normalizer.py src/business/publish-from-spu/qualification-image-normalizer.ts scripts/test-qualification-image-normalization-rule.mjs
git commit -m "Normalize oversized qualification images"
```

### Task 3: Prepare Upload Assets Before Browser Operations

**Files:**
- Modify: `src/business/publish-from-spu.ts:9020-9070`
- Modify: `scripts/test-publish-module-sequence-rule.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing publish-structure tests**

Add source-structure assertions to `scripts/test-publish-module-sequence-rule.mjs`:

```js
assert.match(publishSource, /prepareQualificationImagesForUpload\(\{[\s\S]*files: classifiedAssets\.detailImages[\s\S]*outputDir: path\.join\(runtimeDir, "qualification-images-normalized"\)/);
assert.match(publishSource, /detailImages: preparedQualificationImages\.files/);
assert.doesNotMatch(publishSource, /fs\.(?:copyFileSync|renameSync)\([^\n]*detailImages/);
const runJobStart = publishSource.indexOf("export async function runPublishFromSpuJob");
const prepareIndex = publishSource.indexOf("await prepareQualificationImagesForUpload", runJobStart);
const firstBrowserModeIndex = publishSource.indexOf('if (mode === "open_platform_spu")', runJobStart);
assert.ok(prepareIndex > runJobStart && prepareIndex < firstBrowserModeIndex);
```

Also assert `package.json` contains `node scripts/test-qualification-image-normalization-rule.mjs` inside `rules:check`.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run build && node scripts/test-publish-module-sequence-rule.mjs
```

Expected: FAIL because the publish job still uploads classified source paths directly.

- [ ] **Step 3: Wire preprocessing into `runPublishFromSpuJob`**

Import `prepareQualificationImagesForUpload`. Replace the current asset initialization with:

```ts
const classifiedAssets = requiresLocalProductFiles
  ? classifyAssets(productFolder, { feishuRecordId: input.metadata?.feishuRecordId })
  : {
      workbookFile: undefined,
      mainImages: [],
      whiteBackgroundImages: [],
      detailImages: [],
      otherFiles: []
    };
const preparedQualificationImages = requiresLocalProductFiles
  ? await prepareQualificationImagesForUpload({
      files: classifiedAssets.detailImages,
      outputDir: path.join(runtimeDir, "qualification-images-normalized")
    })
  : { files: [], entries: [] };
const assets: ProductAssets = {
  ...classifiedAssets,
  detailImages: preparedQualificationImages.files
};
```

This block must remain before the first browser action. Keep `mainImages`, `whiteBackgroundImages`, workbook, and other files unchanged.

- [ ] **Step 4: Add the focused test to `rules:check`**

Insert `node scripts/test-qualification-image-normalization-rule.mjs` immediately after `test-detail-upload-outcome-rule.mjs` in the `rules:check` script.

- [ ] **Step 5: Verify focused and structural behavior**

Run:

```bash
npm run build
node scripts/test-qualification-image-normalization-rule.mjs
node scripts/test-publish-module-sequence-rule.mjs
node scripts/test-detail-upload-outcome-rule.mjs
node scripts/test-progress-state.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit the publish integration**

```bash
git add src/business/publish-from-spu.ts scripts/test-publish-module-sequence-rule.mjs package.json
git commit -m "Prepare qualification images before publishing"
```

### Task 4: Documentation, Verification, Two Audits, Delivery, and Resume

**Files:**
- Modify: `docs/auto-listing/stability-checklist.md`

- [ ] **Step 1: Document the invariant**

Append this rule:

```md
飞书资质图在上传抖店前必须解码检查像素尺寸；任一边超过 `5000px` 时，在当前发布 runtime 内生成最长边 `4900px`、等比例缩放的合规副本并复检。合规原图不得放大，飞书缓存和商品目录原图不得覆盖；探测、缩放或复检失败必须在浏览器上传前失败关闭，禁止回退上传超限原图。
```

- [ ] **Step 2: Run full verification in the isolated branch**

Run:

```bash
npm run rules:check
git diff --check
git status --short
```

Expected: rule closure passes, no whitespace errors, and only intended tracked files differ.

- [ ] **Step 3: Deep audit pass 1**

With the project still safely paused:

- verify the Feishu source image remains `5534×4141` and its SHA-256 is unchanged;
- verify the current manifest has no safe or uncertain publish side effects;
- verify no child publish process is active;
- run `npm run audit:auto-listing` and confirm its only blocking errors are the preserved failed publish entries;
- verify the resume job still targets `image-001` at `published` and all 20 product folders remain present.

- [ ] **Step 4: Deep audit pass 2**

Re-run build, all focused tests, and direct manifest/source checks. Record hashes and mtimes of `state.json`, `result.json`, `publish-manifest.json`, and the oversized source before and after the audit; require exact equality. Run the main-directory doctors after integration:

```bash
npm run doctor
npm run doctor:feishu
npm run doctor:auto-listing
```

- [ ] **Step 5: Commit documentation, merge, and push**

```bash
git add docs/auto-listing/stability-checklist.md
git commit -m "Document qualification image dimension limit"
git push origin master
```

- [ ] **Step 6: Resume through Hermes**

Run:

```bash
npm run auto-listing:hermes-start
```

Expected: `mode=resume-real-job`; existing main images, titles, and product folders are reused; no image generation occurs.

- [ ] **Step 7: Verify the real first-folder recovery**

For watermark 01, require all of the following before allowing normal continuation:

- runtime contains a normalized copy of the `5534×4141` qualification at `4900×3666`;
- source and product-folder copies still hash identically to their pre-resume values;
- both qualification files receive per-file preview-count acknowledgement;
- the graphic module completes and the flow advances to price/inventory;
- no generic file input or coordinate click is used;
- if processing or upload fails, the project stops with the exact filename, dimensions, acknowledgement count, and failed file index.
