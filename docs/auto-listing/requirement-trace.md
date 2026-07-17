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
