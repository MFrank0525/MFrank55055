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

## 2026-07-22 Repeated paid-image timeout recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Identify the current listing stall from durable evidence | Current paid-image ledger and provider status responses show slots 10, 12, 14, 15, and 18 repeatedly ended with explicit `upstream_error` timeout responses while the other 15 slots completed | Live ledger audit and current runtime events for batch `e01fbc4ba0781359f6158903` | verified |
| Keep ordinary provider timeouts from changing image intent | `image-generation-rules.ts` preserves the existing prompt identity; `main-image-assets.ts` authorizes digest changes only for explicit content-policy failures | `test-image-provider-videos-base64-rule.mjs` fails before the fix and passes after it | verified |
| Stop immediate paid retries after a repeated timeout | The second accepted timeout opens the fixed-slot cooldown for the remaining three-minute window; the supervisor retains the locked batch and exact slot ledger | Targeted timeout recovery rule tests | verified |
| Preserve already accepted and completed side effects | Current accepted task IDs continue to be polled; completed slots remain reusable and are never resubmitted | Live ledger remains 20 fixed identities; current run advanced from 15/20 images into publish without clearing the ledger | verified |
| Finish and independently audit the current real batch | Current controller publish manifest, final result, processed manifest, archive, cleanup, full doctors, representative simulation, and two deep audits | Run `20260722-151245`: 20/20 `publish_signal_confirmed`, processed 1/1, archived 20, paid ledger removed, two fresh eight-dimension audits `ok=true` | verified |

## 2026-07-22 Transient Doudian shop-switch recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Identify the new stall without risking duplicate publication | Failure screenshot and manifest identify Doudian's “似乎出现了一些错误” modal after clicking “切换组织/店铺”; target 1 is safely published and target 2 failed before submission | Deep audit reports `unconfirmed=0`; resume allowlist begins at canonical target 2 | verified |
| Recover only the exact transient platform modal | `recoverTransientShopSwitchError` scopes the exact “重试” button to the visible error modal, retries at most twice, and reads back chooser appearance or modal dismissal | `test-shop-switch-structure-rule.mjs`; full `rules:check` | verified |
| Eliminate false-success DOM fallbacks | Both visible-action and shop-switch fallback paths now execute the matched element click before returning success | Red-before-green structural regressions; DOM-only click policy | verified |
| Preserve safe failure behavior | Ambiguous/missing dialogs still stop with DOM and screenshot evidence; no coordinate click or page-wide retry button is allowed | `rules:check`, module-boundary checks, representative simulation | verified |
| Validate real external dependencies before resuming | All doctor modes and a real read-only Feishu field check passed | `doctor`, `doctor:feishu`, `doctor:auto-listing`, `doctor:all`, `feishu:check` | verified |
| Prove recovery on the original checkpoint | Run `20260722-195352` resumed the original target 2, passed shop switching, and reached `publish_signal_confirmed` before automatically advancing to target 3 | Controller log `auto-listing-controller-20260722-233351.log` | verified |

## 2026-07-23 Exact shop-card action recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Prove the current target is present instead of accepting a false “not found” classification | Failure screenshot for canonical target `39e5c10f35f9e8208402140e__recvqagp4TKggC__image-001__08__08` visibly contains the exact target shop card | Runtime screenshot and manifest show 7 safe publishes, target 8 `not_checked`, and `unconfirmed=0` | verified |
| Reproduce the browser failure before changing behavior | A headed Playwright fixture presents an exact visible shop name while decorative SVG consumes its own click | `test-shop-switch-card-action.mjs` failed in the old path with `targetNode.click is not a function` | verified |
| Remove brittle shop-card click targets | All three selection paths click the exact shop-name element or its verified card, never an SVG; hashed build classes are no longer required | Headed card-action regression and `test-shop-switch-structure-rule.mjs` | verified |
| Preserve selection correctness across scrolling | Every scroll iteration re-runs exact-name selection and final success still requires the chooser to close followed by exact header shop-name readback | Shop-switch structure rule and existing `ensureShopContextAttempt` readback | verified |
| Preserve actionable failure evidence | A future target-selection failure writes both `shop-switch-target-missing.html` and `.png` | Structural regression | verified |
| Audit adjacent click risks | Shop selection functions prohibit coordinate clicks and decorative SVG targets; DOM-only click and module-boundary checks remain green | Full `rules:check` | verified |
| Prevent cross-project Chrome attachment | CDP reuse verifies the requested `user-data-dir` before connecting; ports owned by another profile are skipped without termination, with 9555/9666 fallbacks | Red-before-green `test-browser-cdp-recovery-rule.mjs`; competing 9444 profile observed in process evidence | verified |
| Validate real external dependencies | All doctor modes, representative simulation, real Feishu 23-field check, and isolated-profile headed Doudian 20-shop read-only audit passed | Shop-access audit `20260723-141846`: dedicated 9333 listener PID/profile verified, 20/20 exact name readbacks, no publish or form mutation | verified |
| Prove safe recovery on the original failed target | Resume reused batch `39e5c10f35f9e8208402140e`, skipped the seven confirmed targets, selected shop 08 through the isolated profile, and completed the original target before advancing to shop 09 | Controller log `auto-listing-controller-20260723-142430.log`: shop 08 `publish_signal_confirmed` | verified |

## 2026-07-23 Native square main-image contract

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Distinguish provider output from actual upload assets | Inspected all 20 provider-original files and all 20 first-product shop upload sources | Provider originals: 0/20 square; upload sources: 20/20 square | verified |
| Prove whether another project's 3:4 setting was copied | Persisted paid request sends `metadata.aspect_ratio=1:1` and `metadata.size=1024x1024`; the five-part prompt contained no portrait directive | Request evidence under run `20260723-122318`, task `image-001` | verified |
| Reject future cross-project configuration drift before cost | `assertSquareMainImageProviderConfig` accepts only `1024x1024` and compatible `1:1` metadata | `test-image-provider-videos-base64-rule.mjs` rejects 1024x1536 and 3:4 metadata | verified |
| Reinforce providers that ignore metadata | Every paid prompt appends an explicit square-canvas contract and rejects pre-existing non-square aspect directives | Red-before-green prompt/config regressions | verified |
| Preserve the user's accepted first product | Existing 20 paid outputs, normalized raw images, watermarks, and shop distributions remain untouched; completed ledger slots remain reusable | File dimension/readback audit; no regeneration command executed | verified |
| Keep the upload boundary fail closed | Existing publish asset classifier reads every main image's real dimensions before browser upload; exact-section selection excludes `主图3:4` | `test-progress-state.mjs`, `test-publish-module-sequence-rule.mjs`, and 20/20 current upload-source readback | verified |

## 2026-07-23 Hermes origin-bound delivery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why 宝元堂 publish progress was not visible | Project and gateway logs prove 20/20 publish progress signals existed; the watcher sent proactive notices to the base Feishu chat while the operator was using a Feishu topic thread | Timeline reconciliation from 16:36 through 17:23 | verified |
| Keep proactive progress in the command conversation | Start, continue, and status commands persist the exact platform/chat/thread/message origin; the watcher routes only to that bound origin | Structural gateway regression | verified |
| Reject false delivery success | Feishu delivery requires `SendResult.success` and a concrete API `message_id` receipt | Live receipt `om_x100b692b427f0c80b4b94c26cb94c6b` in the bound thread | verified |
| Retry failed notices instead of silently dropping them | Failed delivery restores the pre-notice dedupe state, so the same terminal/progress notice remains eligible on the next watchdog cycle | Structural gateway regression | verified |
| Preserve origin across gateway restart | Bound origin is persisted under the project control directory and reloaded after restart | Gateway PID replacement and live thread delivery | verified |
