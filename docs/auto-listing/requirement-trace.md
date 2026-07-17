# Auto-listing Requirement Trace

## 2026-07-17 Main-image shape recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Find the current listing stall root cause | Runtime log and image readback identified paid slot 18 as `1199x1312`; the previous completion audit checked count/path but not pixels | Real failing raw and watermarked files inspected; other 19 slots were square | verified |
| Prevent non-square provider output from reaching watermark/distribution | `main-image-shape-rules.ts`, `main-image-square-action.ts`, `main-image-square-normalizer.py`, and `main-image-assets.ts` normalize new and recovered raw files by white-background centered padding before watermarking | `test-main-image-square-normalization-rule.mjs`; real slot 18 normalized to `1312x1312` with original evidence retained | verified |
| Repair legacy assets on a publish-stage resume | `recoverMainImageArtifactForPublish` rebuilds exact raw/product-folder mapping; `orchestrator.ts` repairs and audits before every publish mutation | Real 20-folder recovery mapped 20/20 raw files; second repair was idempotent with zero changes | verified |
| Make deep audit reject count-complete but non-square assets | `audit-rules.ts`, `audit-auto-listing.ts`, and the orchestrator completion gate read actual raw/watermarked dimensions | `test-progress-state.mjs` asserts `main_image_not_square` | verified |
| Preserve safe paid-image behavior | Completed provider slots are normalized locally; no paid task is resubmitted, stretched, or cropped | Original `1199x1312` raw/watermarked files retained under current task shape evidence | verified |
| Report future failures precisely | `publish-rules.ts` classifies shape failures as `main_image_shape_invalid`; circuit breaker stops the group safely | Rule test in `test-progress-state.mjs` | verified |
| Keep deep-audit identity scope accurate during a failed multi-task run | `shouldRequirePublishTargetIdentity` excludes untouched `source_images_discovered` placeholders but still fails any task that entered publish assets without canonical identity | `test-deep-auto-listing-audit.mjs` and current runtime deep audit | verified |
| Keep a publish-stage shape failure on the exact product checkpoint | `resolveSupervisorRecoveryChildMode` routes publish-stage shape/completion failures to `resume`; remaining targets are derived by subtracting safe manifest entries from the full product folder set | `test-progress-state.mjs`; current recovery allowlist is watermark 18-20 | verified |
| Prevent an incomplete product from being deleted or skipped | Real pre-run stale history and shared-output cleanup are disabled while the current batch paid ledger exists | `test-progress-state.mjs`; real recovery preserved the project ledger and rebuilt without paid submissions | verified |
| Validate a known remaining publish subset without weakening image gates | `auditPublishMainImageSubset` requires an exact folder set plus existing unique raw/watermarked square files; generation stages still require the full 5x4 set | `test-progress-state.mjs`; real watermark 18-20 dimensions read back square | verified |
| Finish cleanup after a partial publish resume without replaying the product | `archiveUnwatermarkedMainImages` unions and deduplicates resume artifact raw paths with the complete current-task raw set; cleanup-stage archive failures route to `resume` | `test-archive-main-images-rule.mjs` covers a 3-path artifact plus 20-path task directory; `test-progress-state.mjs` covers `failed at cleaned` routing | verified |

## 2026-07-17 Hermes progress accuracy

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Separate completion from current position | `status-progress-rules.ts` formats processed batch completion, current Feishu ordinal, safe publish completion, current target and current shop as distinct fields | `test-progress-state.mjs`; live paused state reads completed 4/6, current 5/6, published 7/20, target/shop 8 | verified |
| Prevent cross-product progress merging | Publish grouping uses canonical batch/record/task identity, with display-name fallback only for legacy identity-free fixtures | Same-name different-record regression test; live manifest has 47 cumulative entries but current group resolves to 7 | verified |
| Preserve the correct phase after pause | A stopped `published` task retains its publish checkpoint even when the pause result is newer than the manifest | Regression rule test and live paused controller status | verified |
| Keep Hermes notices record-specific | `hermesProgress.key` includes recordId, messages prefer Feishu user cognition name, and the gateway stopped formatter consumes the project-owned message | `test-hermes-gateway-watchdog-rule.mjs`; live JSON payload inspection | verified |
