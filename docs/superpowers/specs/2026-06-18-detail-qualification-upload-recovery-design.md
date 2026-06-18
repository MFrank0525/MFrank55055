# Detail Qualification Upload Recovery Design

## Context

The first product in Feishu batch `92066e25a5e74a4c685310e7` has two qualification images. All 20 publish folders failed before final submission with the same graphic-module error: the detail section expected the fill-from-main baseline plus two qualification images, but the observed count remained two short. The current action sends the qualification files to one selected file input and checks only the aggregate count afterward. It does not prove that each file was accepted by the detail section.

The publisher treated the deterministic pre-submit error as a per-folder failure and repeated it across all 20 folders. The supervisor then stopped because generic publish-stage replay is prohibited. The manifest contains no safely published or submit-accepted-uncertain entries, so retrying these folders after the defect is fixed is safe.

## Goals

- Prove each Feishu qualification image is accepted by the 商品详情 section.
- Prevent fallback upload to another graphic section.
- Stop a product publish batch after the first repeated deterministic detail-upload failure.
- Classify this failure as pre-submit and safe to resume only when the manifest proves no uncertain final-submit side effect.
- Preserve strict detail-image completeness; never pass by lowering the expected count.
- Resume the failed product through the existing Hermes project launcher after verification.

## Non-goals

- Changing the required number of qualification images.
- Allowing missing qualification images.
- Replaying any entry with `publish_signal_confirmed`, `submit_accepted_unconfirmed`, or another uncertain final-submit outcome.
- Changing image generation, titles, prices, inventory, or other publish modules.

## Rule-layer Design

### Per-file acknowledgement

The detail upload rule receives a baseline preview count, the number of qualification files, the number of files acknowledged by preview-count increments, and the final preview count. It passes only when:

- fill-from-main succeeded;
- qualification file count is positive;
- every qualification file produced one observed preview-count increment;
- final count equals `baseline + qualification file count`.

Aggregate equality alone is insufficient if per-file acknowledgement is missing. Counts below or above the expected total remain failures.

### Exact-section input invariant

Every qualification upload must target a file input identified inside 商品详情 or 详情页. If the input is single-file, the action must reacquire an exact-section input before each file. Generic best-input fallback is prohibited after detail-section identification fails because it may target main image, white-background, certificate, or another upload module.

### Deterministic batch stop

After the graphic module has performed its existing bounded retry, an unacknowledged qualification image or exact detail-count mismatch is a deterministic product-level failure. The publisher stops scheduling remaining folders for that product immediately. Completed or safely published manifest entries remain authoritative; unattempted entries remain pending for resume.

### Safe supervisor recovery

This failure is safe to rebuild into a manifest-backed resume only when all affected entries failed before final submit and no entry has an uncertain external side effect. The supervisor must not replay entries already accepted as safely published. If any manifest entry is `submit_accepted_unconfirmed`, ambiguous, or otherwise uncertain, automatic replay remains blocked.

## Action-layer Design

### Detail upload sequence

1. Clear stale detail previews using the existing strict clear action.
2. Click 从主图填入 and read the stable baseline count.
3. Locate an input scoped to 商品详情 or 详情页.
4. Upload one qualification file.
5. Wait until preview count is exactly the previous count plus one.
6. If no increment occurs, reacquire the exact-section input and retry that same file once.
7. Repeat for the next file only after acknowledgement.
8. Run the strict final-count rule.

The action records baseline, expected, final, acknowledged-file count, and failed file index in the publish result/checkpoint so later audits can distinguish upload failure from count-reader failure.

### Publish batch coordination

The product-folder loop recognizes the deterministic detail-upload error class. After the first folder exhausts its module retry, it writes the manifest failure and stops the remaining folder loop. This prevents 20 identical browser attempts while retaining the failed and pending folder identities for resume.

### Resume

After code verification and audit, `npm run auto-listing:hermes-start` rebuilds the resume job from the failed run. The existing manifest decides which entries to skip or retry. The launcher must not start a new full batch or regenerate images.

## Verification

### Focused red/green tests

- Two qualification files with only one acknowledged increment fail.
- Two acknowledged increments and exact final count pass.
- A detail input that disappears is reacquired only from 商品详情/详情页.
- No generic file-input fallback exists in the single-file loop.
- Deterministic detail-upload failure stops remaining product folders after the first failed folder.
- Safe resume is allowed for pre-submit detail failures with no uncertain manifest entries.
- Safe resume remains blocked when any entry has an uncertain final-submit outcome.

### Deep audit pass 1

- Run build, full rule closure, doctor commands, and project audit.
- Inspect all 20 manifest entries from the failed run.
- Confirm safely published count is zero and uncertain-submit count is zero.
- Verify all generated/staged images, titles, qualifications, and shop-folder assets required for resume exist.
- Verify the current Feishu batch fingerprint and record identity match the failed run.

### Deep audit pass 2

- Re-read manifest, state, result, and resume candidates independently.
- Re-run focused tests and project audit.
- Confirm no runtime artifact changed during audit.
- Check Git staging contains only code, tests, and rule documentation; no credentials, browser profiles, attachments, generated images, or runtime data.

## Delivery

Commit and push only verified code, tests, and rule documentation. Start through the Hermes launcher, confirm the resume mode targets the failed product, and observe the first folder through per-file detail acknowledgement. Continue only when the strict graphic-module gate passes; otherwise stop with the exact file index and count evidence.
