# Auto-listing Requirement Trace

## 2026-08-05 Dedicated Feishu start regression

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why “开始上架” bypassed the installed router and showed thinking | The live Feishu timeline showed a 30-second response with no plugin skip log. Hermes adapter preprocessing still rewrote the phrase to `/autolist-start` before `pre_gateway_dispatch`, so the natural-language plugin could not match it and the synchronous slash handler timed out | Live `gateway.log` timeline for message `om_x100b682a9dd97ca4c491774e6ad9c33`; failing full-inbound-order regression test | verified |
| Keep one deterministic natural-language owner | `install-hermes-profile.mjs` removes the obsolete core auto-listing plaintext coercion; the dedicated profile plugin alone captures exact controls, acknowledges immediately, returns `skip`, and runs the controller in the background | `test-hermes-auto-listing-command-router.py`; `test-hermes-gateway-watchdog-rule.mjs`; `npm run hermes:profile-verify` | verified |
| Preserve coupon/listing runtime isolation while activating the repair | Only `ai.hermes.gateway-doudian-listing` was restarted; the coupon gateway retained its distinct `HERMES_HOME` and unchanged PID | `launchctl print` before/after; listing PID changed `29417` → `65469`, coupon PID remained `28850` | verified |
| Refuse cross-profile installation without partial writes | The installer accepts only the exact resolved `doudian-listing` home, preflights every runtime/profile transformation before applying its write plan, and rejects unknown runtime layouts | `test-hermes-profile-install-rule.mjs` verifies coupon-target and unknown-layout failures leave profile/runtime bytes unchanged | verified |
| Preserve unrelated Hermes plugin configuration | Plugin enablement adds only `auto-listing-command-router` under `plugins.enabled`, retains existing enabled plugins and plugin child configuration, and is idempotent | `test-hermes-profile-install-rule.mjs` | verified |
| Exercise the real inbound order for every supported control phrase | The executable plugin test iterates all start, continue, pause, and status aliases through adapter preprocessing before `pre_gateway_dispatch` | `test-hermes-auto-listing-command-router.py` | verified |

## 2026-08-04 Dedicated Feishu Hermes channel

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Isolate the auto-listing bot from the other three Doudian projects | Dedicated `HERMES_HOME`, `HERMES_PROJECT_ID=douyin-auto-listing`, project-owned plugin, skill, and SOUL installer | `npm run hermes:profile-verify`; gateway profile status and Feishu bot probe | verified |
| Preserve deterministic start/continue/pause/status behavior without a model turn | `integrations/hermes/auto-listing-command-router` | executable router test, gateway watchdog rule test, and `rules:check` | verified |

## 2026-08-02 Resume shop-total status accuracy

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why a 20-shop medical-device run displayed `当前店铺 11/13` | Resume plan contains only remaining shops 08-20, while the status reducer previously preferred that 13-entry subset and omitted historical manifest shops 01-10 from its shop-total set | Live controller status and generated resume plan/manifest reconciliation | verified |
| Report the full canonical shop denominator during resume | Publish progress now unions same-identity historical manifest entries with remaining plan entries before deduplicating shops; active index still comes from the canonical shop prefix | `test-progress-state.mjs`; live status changed from `11/13` to `11/20` without restarting the publisher | verified |

## 2026-08-01 Platform-SPU tab activation

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why shop 08 reported an empty SPU result while shops 01-07 succeeded | Failure screenshot and live DOM inspection show `我的标品` remained selected. The old exact-text locator matched both the tab wrapper and its inner role node, so Playwright rejected the ambiguous click; an empty catch hid that failure | Runtime `platform-spu-query-no-rows.png`; live tab DOM reports two text nodes but one unique `role=tab`, with `我的标品 aria-selected=true` | verified |
| Never query from the wrong SPU tab | The query action now selects the unique `平台标品` tab by semantic role and requires `aria-selected=true`; ambiguous, missing, or inactive tab state fails with screenshot evidence | `test-platform-spu-query-page-rule.mjs`; live read-only Doudian DOM check | verified |
| Recover bounded transient empty results without hiding a real absence | A verified platform-tab query retries at most four times, preserving the exact shop/product identity; terminal empty results are classified as `spu_query_or_match_failed` instead of `unknown_publish_failure` | `test-platform-spu-query-page-rule.mjs`; representative simulation and deep audit | verified |

## 2026-07-31 Hermes visible-thinking elimination

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why “开始上架” still looked like Hermes reasoning | The router did rewrite this message before agent dispatch, but the rewritten slash command synchronously waited up to 30 seconds for the project controller. The exact 30-second response was the gateway timeout, not an LLM turn | Gateway inbound timeline; `_handle_autolist_command` timeout boundary; live plugin discovery state | verified |
| End gateway dispatch before slow controller work | The durable user plugin now owns exact natural-language controls, returns `skip` immediately, sends an acknowledgement, and runs the project controller in an event-loop background task | `test-hermes-auto-listing-command-router.py` loads the installed plugin and asserts skip, immediate reply, exact origin, and background controller action | verified |
| Prevent source-only tests from declaring a broken deployment healthy | The gateway rule test now executes the Hermes Python runtime, forces plugin discovery, verifies the registered hook, and invokes it with a fake Feishu event/gateway | `test-hermes-gateway-watchdog-rule.mjs` | verified |

## 2026-07-29 Doudian session stability

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Separate platform logout from local profile loss | Runtime evidence preserves the same Chrome/profile across both login redirects; login screenshots show the real Doudian login page and new server session cookies were issued only after re-authentication | Controller timelines at 11:15 and 18:46; browser singleton/profile metadata; cookie timestamps without values | verified |
| Prevent project-side profile contention | Every browser action acquires one atomic cross-process lease before CDP connection; a second live owner fails closed, dead leases recover, and only the owner can release | `test-browser-profile-lease-rule.mjs` | verified |
| Reject transient login redirects without hiding real expiry | Shop switching confirms the login page again after bounded navigation to the canonical SPU page before stopping; confirmed expiry still preserves the exact pre-submit checkpoint | `test-shop-switch-structure-rule.mjs`; `test-doudian-publish-session-preflight-rule.mjs` | verified |
| Resume safely after platform re-authentication | Supervisor polls read-only with the fixed profile, releases its lease before launching the resume child, and resumes only the manifest-backed target | `test-doudian-publish-session-preflight-rule.mjs`; `test-progress-state.mjs` | verified |
| Keep deep audit accurate after a remaining-target resume | When resume state intentionally contains only the remaining publish subset, audit reconstructs the complete 20-image artifact only from exact `recordId` folders plus the current task runtime raw files; incomplete or duplicate evidence still fails closed | `test-deep-auto-listing-audit.mjs`; live audit of run `20260729-181109` reports generation 20/20 and publish 17/20 | verified |

## 2026-07-29 Hermes image-wait liveness reporting

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Distinguish active accepted-task polling from a stopped image process | Paid-ledger status formats submitted slots as “生图仍在运行”, with completed/expected counts, submitted count, same-task polling contract, and latest query timestamp | `test-progress-state.mjs`; live status against the 19/20 ledger | verified |
| Keep reporting during an unchanged provider queue | Hermes watchdog repeats a verified service-wait liveness notice every 10 minutes while continuing to ingest the full project heartbeat | `test-hermes-gateway-watchdog-rule.mjs`; gateway source audit | verified |
| Reply to the exact triggering command | Gateway reads the reply anchor from `MessageEvent`; the durable router plugin independently persists `event.message_id`; missing IDs fail closed and do not advance dedupe state | Gateway/plugin source audit and Python compile | verified |
| Make the origin fix recoverable after upgrades | Canonical router source is versioned at `integrations/hermes/auto-listing-command-router` and the installed plugin must match it byte-for-byte | `test-hermes-gateway-watchdog-rule.mjs` | verified |

## 2026-07-28 Hermes hard routing and publish-stall recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why “开始上架” triggered thinking | Gateway source and the live inbound timeline proved only `/autolist-*` slash commands bypassed the agent; the natural-language phrase entered the ordinary LLM path and replied about 30 seconds later | Gateway source inspection; `agent.log` timeline for the exact inbound message | verified |
| Make Hermes a hard launcher, pauser, and reporter | User plugin `auto-listing-command-router` rewrites exact natural-language start/continue/pause/status intents to project-owned slash commands in `pre_gateway_dispatch`, before session or LLM dispatch | Direct plugin routing test; gateway restart reports one discovered and enabled plugin | verified |
| Survive Hermes package upgrades | The router is versioned under `integrations/hermes`, installed under `~/.hermes/plugins`, and enabled in user config instead of relying on package-owned routing | `test-hermes-gateway-watchdog-rule.mjs` requires the installed plugin to exactly match the canonical project source | verified |
| Explain why the listing stopped instead of self-healing | Run `20260728-005050` stalled before shop 15 produced any module evidence; the 12-minute watchdog terminated it, while the old rule rejected every publish-stage watchdog recovery as uncertain | Controller log, run log, state and manifest reconciliation | verified |
| Resume only provably pre-submit stalls | Each target writes a monotonic `publish-submit-attempt.json`; it starts as `not_attempted` and is atomically changed before the publish click. Supervisor only rebuilds an exact resume when this durable state is still `not_attempted` | `test-progress-state.mjs` covers missing, safe, attempted, monotonic, recoverable and fail-closed cases | verified |

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
| Explain why 宝元堂 publish progress was not visible | Project and gateway logs prove 20/20 publish progress signals existed, but proactive sends created standalone messages instead of replying to the exact visible command; a stale channel-directory thread was then incorrectly guessed during recovery | Inbound-command and delivery timeline reconciliation from 12:19 through 17:23 | verified |
| Keep proactive progress in the command conversation | Start, continue, and status commands persist the exact platform/chat/thread/message origin; every watcher notice directly replies to that command message, and missing origin fails closed instead of guessing channel-directory or home-channel targets | Structural gateway regression plus live Feishu reply receipt | verified |

## 2026-07-24 Redacted no-acceptance image recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain the 19/20 image-generation stop | Slot 18 received an explicit HTTP 400 failed response without a provider task ID and was correctly persisted as `failed_before_acceptance`, but its oversized diagnostic was sanitized to `[redacted]`; restart logic then incorrectly treated the placeholder as stronger than the ledger state | Batch `0b392b66c6cc998794d16d21`, record `recvqc3xStOuPO`, slot audit and controller timeline | verified |
| Resume only the unaccepted fixed slot | A `failed_before_acceptance` record with no `non_replayable` disposition remains retryable even when its reason was lossily redacted; permission, balance, quota and billing dispositions remain fail-closed | Red-before-green provider restart regression; live slot 18 changed from failed-before-acceptance to one new submitted task while 19 completed slots remained unchanged | verified |
| Keep nested upstream failures inside self-driven retry | HTTP retry classification recognizes underscore, hyphen and space variants of `upstream_error` and `do_request_failed`, regardless of the outer HTTP status | Red-before-green rule regression for nested HTTP 400 `upstream_error` | verified |
| Audit a shared publish manifest without cross-product false failures | Deep audit scopes manifest evidence by canonical batch/record/task identity before comparing all current-task target keys; unexpected shops or watermarks inside the current task remain errors | Red-before-green shared-manifest regression; live audit changed from 40 false unexpected identities to `identities.ok=true` with current pending targets only | verified |
| Reject false delivery success | Feishu delivery requires `SendResult.success` and a concrete API `message_id` receipt | Live receipt `om_x100b692b427f0c80b4b94c26cb94c6b` in the bound thread | verified |
| Retry failed notices instead of silently dropping them | Failed delivery restores the pre-notice dedupe state, so the same terminal/progress notice remains eligible on the next watchdog cycle | Structural gateway regression | verified |
| Preserve origin across gateway restart | Bound origin is persisted under the project control directory and reloaded after restart | Gateway PID replacement and live thread delivery | verified |

## 2026-07-25 Doudian login recovery and shop-menu readiness

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Identify the live stall without risking duplicate publication | Runtime, failure screenshot and manifest show Doudian login expiry before target 6; targets 1–5 are confirmed and target 6 is `not_checked` | Run `20260725-003455`; deep audit reports `unconfirmed=0` and matching batch fingerprint | verified |
| Preserve the external authentication boundary | Recovery never enters credentials, OTPs or QR data; it keeps the fixed headed profile and reports a dedicated `doudian_login_wait` state | Red-before-green login recovery rules and supervisor structural tests | verified |
| Resume automatically after the user restores login | Supervisor periodically runs only the read-only Doudian session preflight; it does not restart a publish child or consume ordinary recovery budget while logged out | `test-progress-state.mjs` and `test-doudian-publish-session-preflight-rule.mjs` | verified |
| Prevent full-flow replay after publish-stage login loss | A publish-stage login failure must prepare a manifest-backed resume job; only a pre-paid `preflight` failure may return to the locked full flow | Supervisor recovery branch and structural regression | verified |
| Remove shop-menu loading false positives | Menu-open and anchor-ready checks no longer accept whole-page “退出/切换组织” text; evidence is restricted to visible top-right DOM | Red-before-green `test-shop-switch-structure-rule.mjs`; headed card-action regression | verified |
| Validate real external dependencies | Real Feishu 23-field check and a standalone headed 20-shop audit exercise the fixed profile without publish/form mutation | Feishu `check`; shop-access audit `20260725-133807` | verified |

## 2026-07-28 Hermes continue inert-supervisor recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why the accepted continue command did not restart work | Gateway evidence confirms the natural-language router received “继续上架” and replied within one second; the recorded supervisor PID remained alive for hours after the pause result while its log stopped, no child/wait control file existed, and eight CDP sockets remained open | Gateway timeline, controller log/result mtimes, `ps`, and `lsof` evidence | verified |
| Release read-only Doudian probe resources | `assertDoudianPublishSessionReady` disconnects its Playwright CDP client in `finally` without terminating the reusable headed Chrome profile | `test-doudian-publish-session-preflight-rule.mjs` | verified |
| Reject PID-only false running state | Controller liveness now requires a real child or explicit service/login wait after a recent terminal result; an old terminal result with neither is classified as an inert supervisor | `test-progress-state.mjs`; live status changed from false `running` to the actual terminal pause failure | verified |
| Recycle an inert supervisor before continuing | A continue/start request consumes its established inert decision, verifies the exact supervisor command, terminates that process group without racing a second classification, then launches replacement work | Red-before-green `test-progress-state.mjs`; live recovery advanced the locked batch from 14/22 to 15/22 and the old PID was independently confirmed inert before termination | verified |
| Keep pause and continue documentation consistent | Stability checklist uses `auto-listing:hermes-continue`; start remains reserved for refreshing and locking a new batch | Full `rules:check` and obsolete-path search | verified |
| Revalidate real read-only dependencies before delivery | Current Feishu API exposes all 23 mapped fields; fixed-profile Doudian audit reads back all 20 exact shop identities without publish or form mutation | `feishu:check`; shop-access audit `20260728-225143` passed 20/20 with `publishAttempted=false`, `formMutationAttempted=false` | verified |
| Prevent read-only audit from disrupting active publishing | Shop-access audit checks the durable listing-child ownership record and live PID before any browser action; an active owner fails closed and requires a safe-boundary pause | `scripts/test-shop-access-audit-rule.mjs`; shop-access audit `20260729-172024` passed 20/20 only after safe pause, with no publish/form mutation | verified |

## 2026-08-06 Explicit platform submit-rejection recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Identify why shop 17 stopped without risking a duplicate listing | Runtime screenshot shows Doudian operation ID `2026080611514994A2BEE931106AF92453` and “系统异常,请重试” after the click; submit intent remains `attempted_or_unknown` | Original target runtime and controller log; no automatic replay occurred | verified |
| Prove the failed request did not create a delayed product | Re-ran the stable read-only exact-full-title query in target shop 17 more than ten minutes after rejection | Doudian “全部” tab returned `共0条`, with exact title in URL and explicit empty result | verified |
| Give the explicit rejection higher priority than unrelated full-page text | `classifyPublishFailure` recognizes the platform system-error banner before generic “必填” classification | Red-before-green `test-progress-state.mjs` assertion using the production-shaped error text | verified |
| Never blindly replay a post-click request | Generic retry excludes `final_publish_submit_transient`; an attempted request becomes `submit_rejected_confirmed` and must pass negative list verification before one controlled retry | `evaluatePublishResult` and `shouldRetryPublishFailure` regressions | verified |
| Preserve fail-closed behavior | A found product is accepted as `list_verified`; inconclusive lookup or a second rejection remains terminal and later shops do not run | Existing manifest-backed post-submit verification and one-retry ceiling | verified |
