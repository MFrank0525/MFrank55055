# Detail Qualification Upload Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Doudian detail qualification uploads provably complete, stop deterministic batch-wide failures after the first folder, and safely resume only pre-submit manifest failures.

**Architecture:** Add pure rule checks for per-file acknowledgement and a dedicated `detail_qualification_not_ready` error class. Change the browser action to upload one qualification file at a time through an exact 商品详情/详情页 input and wait for a preview-count increment before continuing. Reuse existing manifest-backed resume machinery, extending it only to this explicitly pre-submit error class.

**Tech Stack:** TypeScript, Playwright, Node.js ESM, JSON publish manifest, existing script-based rule tests.

---

## File Structure

- Modify `src/business/publish-from-spu/publish-rules.ts`: per-file acknowledgement rule, deterministic error classification, and batch-stop policy.
- Modify `src/business/publish-from-spu.ts`: exact detail-input lookup and sequential acknowledged uploads.
- Modify `src/autolist/batch-continuation-rules.ts`: safe manifest-backed resume classification for this pre-submit failure.
- Modify `scripts/test-detail-upload-outcome-rule.mjs`: focused detail-rule and action-structure regressions.
- Modify `scripts/test-progress-state.mjs`: classification, batch stop, and supervisor resume regressions.
- Modify `docs/auto-listing/stability-checklist.md`: product-level fail-fast and safe-resume invariant.

### Task 1: Require Per-file Detail Acknowledgement

**Files:**
- Modify: `scripts/test-detail-upload-outcome-rule.mjs`
- Modify: `src/business/publish-from-spu/publish-rules.ts:567-593`

- [ ] **Step 1: Write failing rule tests**

Extend each `evaluateDetailImageCompletion` input with `baselineDetailCount` and `acknowledgedQualificationCount`, then add:

```js
const missingAcknowledgement = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 6,
  qualificationImageCount: 2,
  acknowledgedQualificationCount: 1,
  finalDetailCount: 8,
  expectedDetailCount: 8
});
assert.deepEqual(missingAcknowledgement, {
  passed: false,
  issue: "Qualification detail upload was not acknowledged per file. expected=2; acknowledged=1; baseline=6; final=8"
});

const fullyAcknowledged = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 6,
  qualificationImageCount: 2,
  acknowledgedQualificationCount: 2,
  finalDetailCount: 8,
  expectedDetailCount: 8
});
assert.deepEqual(fullyAcknowledged, { passed: true, issue: "" });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node scripts/test-detail-upload-outcome-rule.mjs
```

Expected: FAIL because aggregate count currently passes without per-file acknowledgement.

- [ ] **Step 3: Implement the strict rule**

Change the rule signature and insert the acknowledgement check before final-count comparison:

```ts
export function evaluateDetailImageCompletion(input: {
  filledFromMain: boolean;
  baselineDetailCount: number;
  qualificationImageCount: number;
  acknowledgedQualificationCount: number;
  finalDetailCount: number;
  expectedDetailCount: number;
}): PublishRuleCheck {
  if (!input.filledFromMain) {
    return { passed: false, issue: "Detail section was not filled from main images before qualification upload." };
  }
  if (input.qualificationImageCount <= 0) {
    return { passed: false, issue: "No Feishu qualification images were available for detail section." };
  }
  if (input.acknowledgedQualificationCount !== input.qualificationImageCount) {
    return {
      passed: false,
      issue: `Qualification detail upload was not acknowledged per file. expected=${input.qualificationImageCount}; acknowledged=${input.acknowledgedQualificationCount}; baseline=${input.baselineDetailCount}; final=${input.finalDetailCount}`
    };
  }
  if (input.finalDetailCount < input.expectedDetailCount) {
    return { passed: false, issue: `Detail image count did not reach expected count. expected=${input.expectedDetailCount}; actual=${input.finalDetailCount}` };
  }
  if (input.finalDetailCount > input.expectedDetailCount) {
    return { passed: false, issue: `Detail image count exceeded expected count. expected=${input.expectedDetailCount}; actual=${input.finalDetailCount}` };
  }
  return { passed: true, issue: "" };
}
```

- [ ] **Step 4: Update existing call sites/tests and verify GREEN**

Pass `baselineDetailCount` and `acknowledgedQualificationCount` in existing test fixtures and the action call site. Run:

```bash
npm run build && node scripts/test-detail-upload-outcome-rule.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the rule**

```bash
git add src/business/publish-from-spu/publish-rules.ts scripts/test-detail-upload-outcome-rule.mjs
git commit -m "Require per-file detail upload acknowledgement"
```

### Task 2: Upload Qualifications Sequentially Through Exact Detail Inputs

**Files:**
- Modify: `scripts/test-detail-upload-outcome-rule.mjs`
- Modify: `src/business/publish-from-spu.ts:5379-5407,6576-6728`

- [ ] **Step 1: Write failing action-structure tests**

Read `src/business/publish-from-spu.ts` and assert the upload function contains exact-section reacquisition and excludes generic fallback:

```js
const publishSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
const uploadStart = publishSource.indexOf("async function uploadDetailImagesByInputCapability");
const uploadEnd = publishSource.indexOf("async function uploadFilesToSectionSlots", uploadStart);
const uploadSource = publishSource.slice(uploadStart, uploadEnd);
assert.match(uploadSource, /pickBestSectionFileInput\(inputs, "\\u5546\\u54c1\\u8be6\\u60c5"/);
assert.match(uploadSource, /pickBestSectionFileInput\(inputs, "\\u8be6\\u60c5\\u9875"/);
assert.match(uploadSource, /waitForPreviewCount[\s\S]*previousCount \+ 1/);
assert.doesNotMatch(uploadSource, /pickBestFileInput\(inputs, scoreDetailGraphicInput\)/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node scripts/test-detail-upload-outcome-rule.mjs
```

Expected: FAIL because the single-file loop currently uses generic `pickBestFileInput` and does not wait for each increment.

- [ ] **Step 3: Replace bulk upload with acknowledged sequential upload**

Use this result type and implementation:

```ts
type DetailQualificationUploadResult = {
  attemptedCount: number;
  acknowledgedCount: number;
  finalCount: number;
  failedFileIndex?: number;
};

async function uploadDetailImagesByInputCapability(
  page: Page,
  files: string[],
  baselineCount: number
): Promise<DetailQualificationUploadResult> {
  let acknowledgedCount = 0;
  let previousCount = baselineCount;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    let acknowledged = false;
    for (let attempt = 0; attempt < 2 && !acknowledged; attempt += 1) {
      const inputs = await collectFileInputs(page);
      const input =
        pickBestSectionFileInput(inputs, "\u5546\u54c1\u8be6\u60c5", scoreDetailGraphicInput) ||
        pickBestSectionFileInput(inputs, "\u8be6\u60c5\u9875", scoreDetailGraphicInput);
      if (!input) break;
      await page.locator("input[type='file']").nth(input.index).setInputFiles(files[fileIndex]);
      const observedCount = await waitForPreviewCount(
        page,
        () => countDetailImagePreviews(page),
        previousCount + 1,
        15000
      );
      if (observedCount >= previousCount + 1) {
        previousCount = observedCount;
        acknowledgedCount += 1;
        acknowledged = true;
      }
    }
    if (!acknowledged) {
      return { attemptedCount: fileIndex + 1, acknowledgedCount, finalCount: previousCount, failedFileIndex: fileIndex + 1 };
    }
  }
  return { attemptedCount: files.length, acknowledgedCount, finalCount: previousCount };
}
```

- [ ] **Step 4: Wire strict evidence into the detail gate**

In `ensureDetailImagesFromMainThenQualifications`, replace the aggregate upload call with:

```ts
  const uploadResult = await uploadDetailImagesByInputCapability(page, assets.detailImages, countAfterFillFromMain);
  const finalCount = await waitForPreviewCount(page, () => countDetailImagePreviews(page), expectedDetailCount, 15000);
  const detailRule = evaluateDetailImageCompletion({
    filledFromMain,
    baselineDetailCount: countAfterFillFromMain,
    qualificationImageCount: assets.detailImages.length,
    acknowledgedQualificationCount: uploadResult.acknowledgedCount,
    finalDetailCount: finalCount,
    expectedDetailCount
  });
```

When returning failure, append `acknowledged`, `qualificationImages`, and `failedFileIndex` to the issue string. Do not loosen `expectedDetailCount`.

- [ ] **Step 5: Run focused and build verification**

Run:

```bash
npm run build
node scripts/test-detail-upload-outcome-rule.mjs
node scripts/test-publish-module-sequence-rule.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit the action fix**

```bash
git add src/business/publish-from-spu.ts scripts/test-detail-upload-outcome-rule.mjs
git commit -m "Acknowledge Doudian detail uploads per file"
```

### Task 3: Fail Fast and Resume Only Safe Pre-submit Failures

**Files:**
- Modify: `scripts/test-progress-state.mjs`
- Modify: `src/business/publish-from-spu/publish-rules.ts:340-505`
- Modify: `src/autolist/batch-continuation-rules.ts:115-220`

- [ ] **Step 1: Write failing classification and batch-stop tests**

Add:

```js
const detailQualificationClass = classifyPublishFailure(
  "Sequential publish flow stopped: 图文信息模块未完成。Qualification detail upload was not acknowledged per file. expected=2; acknowledged=0; baseline=6; final=6"
);
assert.equal(detailQualificationClass, "detail_qualification_not_ready");
assert.equal(
  shouldStopPublishBatchAfterFailure([{ safelyPublished: false, errorClass: detailQualificationClass }]),
  true
);
```

- [ ] **Step 2: Write failing supervisor-resume tests**

Add a failure message containing `failed at published` and the exact detail acknowledgement error. Assert:

```js
assert.equal(resolveSupervisorRecoveryChildMode(detailFailureMessage), "resume");
assert.equal(shouldRecoverFullFlowAfterChildFailure({
  childMode: "full",
  exitCode: 1,
  batchComplete: false,
  retryableFailureMessage: detailFailureMessage,
  activeStep: "published",
  activeMessage: "Publish failed: detail_qualification_not_ready",
  recoveryAttempts: 0,
  maxRecoveryAttempts: 12
}), true);
```

Keep the existing uncertain-final-submit assertion false.

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
npm run build && node scripts/test-progress-state.mjs
```

Expected: FAIL because the error is currently `unknown_publish_failure`, does not stop after one folder, and is not safe-resumable.

- [ ] **Step 4: Implement deterministic classification and fail-fast**

In `classifyPublishFailure`, return `detail_qualification_not_ready` when the normalized message contains `图文信息模块未完成` and either `Qualificationdetailuploadwasnotacknowledgedperfile` or `Detailimagecountdidnotreachexpectedcount`.

Add `detail_qualification_not_ready` to `singleFailureStopClasses` in `shouldStopPublishBatchAfterFailure`. Do not add it to whole-flow retry classes because the graphic module already performs its bounded in-page retry.

- [ ] **Step 5: Implement safe manifest-backed supervisor recognition**

Add the same exact detail error patterns to both `isRetryablePublishPageFailure` and `isSafeManifestBackedPublishResumeFailure`. Do not add broad `图文信息模块未完成` matching by itself. This keeps final-submit uncertainty and unrelated graphic failures blocked.

- [ ] **Step 6: Run the test and verify GREEN**

Run:

```bash
npm run build && node scripts/test-progress-state.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit fail-fast and resume rules**

```bash
git add src/business/publish-from-spu/publish-rules.ts src/autolist/batch-continuation-rules.ts scripts/test-progress-state.mjs
git commit -m "Fail fast on deterministic detail upload failures"
```

### Task 4: Documentation, Two Deep Audits, Delivery, and Resume

**Files:**
- Modify: `docs/auto-listing/stability-checklist.md`

- [ ] **Step 1: Document the invariant**

Append:

```md
详情资质图必须逐张通过商品详情专属 input 上传，并以每张上传后的预览计数 `+1` 作为确认；禁止回退到其他图文模块的通用 file input。首个商品目录在既有图文模块重试后仍出现确定性资质上传失败时，必须停止该商品剩余目录，禁止重复跑完全部水印。只有 manifest 证明失败发生在最终提交前且不存在 `submit_accepted_unconfirmed` 等不确定副作用时，supervisor 才允许重建 resume 任务；已安全发布项必须跳过。
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run rules:check
npm run doctor
npm run doctor:feishu
npm run doctor:auto-listing
```

Expected: all exit 0.

- [ ] **Step 3: Deep audit pass 1**

Run `npm run audit:auto-listing`, then inspect the failed run directly:

- `publish-manifest.json` has 20 failed entries, zero safely published, zero `submit_accepted_unconfirmed`;
- all failures are pre-submit detail errors;
- current Feishu fingerprint is `92066e25a5e74a4c685310e7` and recordId is `recvmScNjpQaiG`;
- 20 raw/staged main images, 20 title rows, two qualification files, and all 20 product folders exist;
- no browser or supervisor process is active before resume.

- [ ] **Step 4: Deep audit pass 2**

Re-run build, focused tests, project audit, and direct manifest/asset checks. Compare manifest/state/result mtimes and hashes before/after to prove the audit is read-only. Run `git diff --check` and verify staging contains no runtime data or secrets.

- [ ] **Step 5: Commit and push**

```bash
git add docs/auto-listing/stability-checklist.md
git commit -m "Document deterministic detail upload recovery"
git push origin master
```

- [ ] **Step 6: Resume through Hermes**

Run:

```bash
npm run auto-listing:hermes-start
```

Expected: mode is `resume-real-job`; the first failed folder is retried, existing generated images/titles are reused, and no new image-generation submissions occur.

- [ ] **Step 7: Verify real first-folder recovery**

Poll `npm run auto-listing:hermes-status` and inspect the first retry publish artifacts. Require evidence that both qualification files were acknowledged and the graphic module passed before allowing the project to continue. If it fails, require the exact failed file index/count evidence and do not claim completion.
