# Auto-listing Requirement Trace

## 2026-11-19 DeepSeek prompt-length false rejection recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why the locked fourth product stopped before image generation | All three DeepSeek replies contained five complete current-product keyword paragraphs; the recently added hard 100–150-character validator rejected only lengths 153–157 | Run `20261119-192607`, task `image-002`; raw reply replay reports five prompts on every attempt | verified |
| Accept DeepSeek output regardless of character count | Prompt count, keyword structure and current-product identity remain fail-closed, while character-count rejection is removed; accepted text is not truncated or padded | Shorter-than-100 and longer-than-150 red-before-green regression in `test-feishu-poster-prompts-rule.mjs` | verified |
| Resume without submitting another DeepSeek request | When the exact saved request text still matches, recovery validates newest-to-oldest raw attempts, writes `deepseek-extracted.txt`, and reuses the first complete current-product set | Saved-raw recovery regression; three current runtime raw files replay successfully | verified |
| Rehydrate selling points before recovering DeepSeek output | A saved `selling-points.txt` proves disk continuity but no longer advances the generated resume job past `selling_points_loaded`; the locked Feishu record is reloaded into memory before prompt recovery | Resume-runtime evidence red-before-green regression in `test-progress-state-part-3.mjs`; first continuation failure remained pre-paid and pre-publish | verified |

## 2026-11-19 policy-rejected main-image correction

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Never replace the fixed relay prompt with an invented neutral prompt | Content-policy rejection now fails with `feishu_source_reselection_required`; the neutral still-life fallback builder and retry-request writer were removed | Provider rule regression; active source contains no neutral fallback builder | verified |
| Keep Feishu copy, DeepSeek prompts and Word prompts in one atomic revision | Changing any of `主图主标题`、`主图副标题`、`主图卖点` creates a new source digest, forces a fresh call to the fixed DeepSeek conversation, regenerates all five Word files, and validates Word paragraph 2/3 against the current source and DeepSeek prompt before provider submission | Revision `feishu-source-f8479da5c1902772`; digest `f8479da5c1902772...`; `test-main-image-prompt-revision-rule.mjs` | verified |
| Replace only the four obsolete fallback images | Slots 07/13/14/16 were evidence-checked, archived, invalidated and resubmitted with new prompt digests; all other completed slots were reused | Provider tasks `task_WQ92...`, `task_C1WA...`, `task_KseL...`, `task_o06G...`; four slot ledgers are `completed`; regenerated product files exist | verified |
| Cancel review for the already-submitted bad image without touching other products | Exact shop-07 product `3854879546667040921` was uniquely located and withdrawn; its publish runtime and prior manifest were archived, and only its canonical manifest entry was changed to `pending/not_checked` | `shop07-unlisted-confirmed.png`; correction archive `withdrawn-shop07`; remaining six submitted entries unchanged | verified |
| Keep the listing workflow paused after correction | Correction ran as a standalone image action and never invoked publish; the existing pause request remains present | process check and pause control file | verified |

## 2026-11-19 full-bleed frame restart safety

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Keep the fixed top-left brand frame without shrinking the complete poster | `full-bleed-layout-guide-v2` sends one spatially composed product/frame reference; post-processing preserves the provider poster at 800×800 and only overlays the exact frame | Accepted quality test `ad846d1c103544e1f12e3021`; frame-ready and unframed pixel-equality regression | verified |
| Preserve numeric specifications such as `200ml` | Candidate ordinal cleanup requires a real ordinal delimiter and no longer strips leading product numbers | `test-feishu-source-fields-rule.mjs`; accepted image renders `200ml大容量` | verified |
| Prevent legacy shrink-layout artifacts from entering a new run | Legacy `safe-inset-v1` markers fail closed; frame layout version and the complete layout prompt contract participate in the business-rule fingerprint | `test-main-image-frame-rule.mjs`; resume fingerprint gate | verified |
| Archive incompatible local state before a from-first-product restart | Explicit rerun now works for incomplete unchanged batches, rejects active/uncertain paid slots, and moves the old paid ledger plus matching runtime directories into a timestamped recovery archive before clearing processed state | `test-fresh-rerun-archive.mjs`; archive `fresh-rerun-2026-11-19T04-50-16-848Z-58b15a92cc54`; clean full audit | verified |
| Prevent a from-first-product restart from duplicating an already published external product | Read-only verification found product `3854855932777463980`; the operator chose to retain it, so a durable resolution binds it to the exact canonical shop-01 target and records `list_verified` coverage without another publish mutation. Every other target continues normally | `test-external-product-resolution-rule.mjs`; forced-rerun preflight; controller `20261119-130237` | verified, running |


## 2026-11-04 short-title platform-limit recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain why the second Feishu product stopped at target 1/20 | The retained publish page showed `导购短标题` value `SNM医用重组Ⅲ型胶原蛋白面膜` at `26/24` with `至多输入12个汉字（24字符）`; the old preflight checked only presence and the old observer did not classify this field rejection | Run `20261103-141419`; canonical target `516994d3d4fb2b27838495dd__reczz28Uee45ApKZ__image-001__01__01`; retained publish screenshot and exact-title `共0条` screenshot | verified |
| Enforce the limit before browser mutation without inventing source text | Short-title counting matches the platform: Han=2, other characters=1. An over-limit value may remove only one complete leading ASCII/number source token when the untouched semantic remainder fits; otherwise metadata resolution fails closed rather than truncating a Chinese term | `title-rules.ts`; metadata-resolution regressions | verified |
| Never downgrade the exact field rejection to uncertainty again | Submission rules require all three exact clauses—`导购短标题`, `至多输入12个汉字`, and `24字符`—and post-click polling returns the deterministic `short_title_length_rejected` result immediately | `publish-rules.ts`; progress-state red-before-green regression | verified |
| Resume the locked target without duplicate publication | Historical recovery requires the attempted durable boundary, canonical identity, prior negative screenshot and a fresh live exact-title `共0条` verification before the one-use retry | Recovery archive `2026-11-04T02-31-59-673Z`; controller `20261104-103227`; normalized short title `医用重组Ⅲ型胶原蛋白面膜` received `publish_signal_confirmed` at target 1 and advanced to target 2 | verified |

## 2026-11-03 repeated-segment title-policy rejection recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain why the locked batch stopped at target 15/20 | The retained publish page showed `标题中不允许出现连续重复片段「械字号械字号」，建议修改后提交`; the old observer recognized only the earlier `商品标题描述“…”不符合平台要求` copy, waited for a success signal, and persisted a false final-submit uncertainty | Run `20261103-104822`; canonical target `516994d3d4fb2b27838495dd__reczz28Uee22Zzgz__image-001__15__15`; retained publish and exact-title `共0条` screenshots | verified |
| Recognize the new response without broad false positives | Rejection parsing requires the complete repeated-segment prefix, a quoted exact phrase, and the `建议修改后提交` suffix; it emits the existing deterministic `title_policy_rejected` class and canonical issue | `publish-rules.ts`; progress-state red-before-green regression | verified |
| Reuse the bounded Feishu-derived fallback | The exact repeated phrase feeds the existing candidate filter, which excludes the current title, duplicates and any candidate containing that phrase, then permits at most three one-shot candidates | Candidate-selection regression; `publish-submit-page-action.ts` | verified |
| Resume without duplicating a product | Recovery requires the durable attempted boundary, canonical identity, retained prior negative screenshot, a new live exact-title `共0条` verification and a one-use retry ledger before the stopped target can be retried | Recovery archive `2026-11-03T05-48-41-887Z`; continuation controller `20261103-134901`; target 15 received `publish_signal_confirmed` and advanced to target 16 while targets 1-14 remained intact | verified |

## 2026-10-19 GPT Plus tab contamination recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why the locked batch changed from provider backoff to terminal failure | A persisted `https://chatgpt.com/` tab existed in the dedicated Doudian browser profile; guard installation asserted before installing its route or quarantining the tab, so preflight threw and terminated the supervisor | Controller log `auto-listing-controller-20261018-221115.log`; run `20261019-042015` result | verified |
| Keep ChatGPT web isolated without stopping Doudian work | Guard installation now installs the deny route first, closes only blocked ChatGPT-domain pages in the dedicated automation context, verifies none remain, and closes a page that later requests a blocked URL | `src/utils/gpt-plus-guard.ts`; red-before-green `test-gpt-plus-browser-quarantine.mjs`; live continuation quarantined the stale tab and passed Doudian preflight | verified |
| Keep provider task-list authentication recoverable | Login-required detection preserves and reuses the provider page, propagates the exact checkpoint, and remains a non-budget-consuming external-service wait even inside the paid submission safety wrapper | Paid reconciliation and progress-state regressions; first continuation exposed the terminal wrapper defect, second continuation remained active and refreshed canonical browser authentication | verified |
| Preserve paid-image non-replay safety while resuming | Continue the exact locked batch and retain ambiguous slot 1 until provider token/task evidence proves acceptance or non-acceptance; never submit a second paid request from absence of evidence | Authenticated task-list query proved no task in window `1792381361..1792381729`; slot 1 transitioned `ambiguous → failed_before_acceptance → reserved → submitted` only after that proof | verified |

## 2026-10-12 split-table price-column recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why 体温计 stopped at shop 1 | Doudian inserted an optional `国补商品型号` column before `价格`; the split-table fallback treated the first editable non-code input as price, wrote and read prices from the wrong column, then reached final validation with all four real price inputs empty | Run `20261011-223738`; target `...__reczz28M7vylyuOu__image-013__01__01`; spec, price and fill-check screenshots | verified |
| Bind price and stock mutations to semantic table columns | Both same-table and split-table row discovery derive exact cell indexes from the visible `价格/售价` and `现货库存/库存` headers; optional inserted columns can no longer become price targets | `price-inventory-action.ts`; `test-spec-template-rule.mjs`; live screenshot shows prices `129/119/79.9/69.9`, stock `2000`, and sale range `69.9~129` | verified |
| Preserve irreversible-submit safety during recovery | The failed target has `publishClickAttempted=false` and `publish-submit-attempt.state=not_attempted`; prior 12 products and their canonical published targets remain untouched | Target result, submit-attempt ledger and manifest | verified |
| Prove the repair on the locked real batch | Continuation retained batch `b54d663e240ca0fd88a12c47`, published shop 1 with `publish_signal_confirmed`, and advanced to shop 2; the live Feishu dump retained the same fingerprint and exact `买二送一` plus four prices | Controller `auto-listing-controller-20261012-171312.log`; deep audit `ok=true`, `unconfirmed=0`; live Feishu dump | verified |

## 2026-10-09 controlled template / price cardinality recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain the stop at Feishu record 12, shop 1 | Locked record `reczz28KvXcbn7bl` combined template `买一送一` (two generated SKU rows) with four Feishu prices; the generic `price_inventory_not_ready` classifier retried the deterministic mismatch four times | Run `20261009-075501`, controller log, spec-editor and price-inventory screenshots | verified |
| Reject known source contradictions before browser work | Known controlled templates declare their expected SKU cardinality; a mismatch throws before `launchPersistentBrowser` and receives the non-retryable class `spec_template_price_cardinality_mismatch` | `test-feishu-price-inventory-rule.mjs`; `test-spec-template-rule.mjs` | verified |
| Apply the user-confirmed correction without replaying prior products | A fresh read-only Feishu candidate proved the only scalar change was record `reczz28KvXcbn7bl.specTemplate`, from `买一送一` to `买二送一`; the failed task was corrected only after durable proof that final submit was `not_attempted`, while the locked canonical target key and first 11 completed records were retained | `feishu-source-correction.json`; live candidate fingerprint `ea5ed9ae607a43495ab2e20c`; locked batch `651a6921504063ad084246c9` | verified |

## 2026-10-07 Direct model-unavailable paid-submit recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why the final product stopped after generating 10/20 images | Slot 11 received HTTP 503 with a root-only structured `error.code=model_not_found` and `No available channel`, but the no-acceptance classifier required the older outer `fail_to_fetch_task` wrapper and persisted the slot as `ambiguous` | Batch `9718294dda18758196743dea`, product `reczz28K3UlcTFC7`, slot 11 ledger and SHA-bound response evidence | verified |
| Recognize only the exact direct no-acceptance response | The image-generation rule parses the JSON suffix and requires a root object containing only `error`, the exact `model_not_found` code, and the channel-unavailable message; different codes and extra root fields remain fail-closed | Provider-policy and paid-ledger red-before-green regressions | verified |
| Preserve fixed-slot paid safety | Historical slot 11 is reclassified as `failed_before_acceptance`; completed slots 1-10 remain reusable and no slot with task/data evidence is authorized for replay | Slot 11 audit chain retained the SHA-bound response and transitioned `ambiguous → failed_before_acceptance → reserved → submitted`; slots 1-10 remained completed | verified |
| Prove the locked batch continues without regenerating completed images | Resume the exact cached batch and observe slot 11 leave ambiguity, image count advance beyond 10/20, then continue into publish | Controller `auto-listing-controller-20261007-104031.log`; live status advanced from main images 10/20 to 18/20, then entered publish target 1/20 after all 20 completed | verified |

## 2026-10-06 Navigation-time null-body publish recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why medical-device target 12 stopped after target 11 succeeded | Doudian navigated between shop contexts before SPU query; the login probe dereferenced `document.body.innerText` while the SPA had temporarily unmounted `<body>`, producing a pre-submit TypeError | Run `20261006-042105`, target 12 event/log timeline; no SPU-query or submit evidence exists for target 12 | verified |
| Retry the transient DOM gap instead of opening an unknown-failure circuit | Shop navigation reads explicitly treat a temporarily absent body as a bounded navigation-read condition and wait for `domcontentloaded`; other publish-page body reads are null-safe | Shop-access navigation regression and build | verified |
| Recover the existing persisted failure without replaying completed targets | Failure classification maps the exact pre-fix null-body signature to `page_context_lost`; unknown stored classes are reclassified by the existing verified pre-submit recovery gate | Progress-state classification and historical-failure recovery regression | verified |
| Preserve irreversible publish safety | Recovery remains limited to `finalVerifyStatus=not_checked`; targets 1-11 retain `publish_signal_confirmed` and target 12 has no submit attempt | Manifest/result audit before continuation | verified |
| Prove recovery on the locked real batch | `auto-listing:hermes-continue` retained batch `2a0f31e45a01cbdf5f339f66`, resumed target 12 directly, completed it, and advanced to target 13 without replaying targets 1-11 | Controller `auto-listing-controller-20261006-105941.log`; live status advanced from 11/20 at target 12 to 12/20 at target 13 | verified |

## 2026-10-05 Stale Doudian-login waiter recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why `继续上架` stayed at target 6 after the browser session was restored | Supervisor PID `31964` retained a `doudian_login_wait` file whose 30-second heartbeat stopped at attempt 2637 on 2026-10-03 05:38:39; controller liveness treated any owned wait file as permanently healthy, so continuation returned `already_running` | Process inspection, wait-file timestamps, controller log, and retained login screenshot | verified |
| Recycle only a genuinely stale wait without interrupting valid long backoff | Controller liveness now requires the wait heartbeat to remain within five minutes of the later of file mtime and declared `retryAt`; a future external-service retry remains active, while a missed login retry becomes inert | Pure heartbeat boundary regressions and controller-liveness source contract | verified |
| Preserve the exact locked batch and publish checkpoint | `auto-listing:hermes-continue` recycled only the verified wait-only supervisor, kept batch `2a0f31e45a01cbdf5f339f66`, rebuilt the manifest-backed resume job at `image-004`, and retained targets 1-5 | New supervisor PID `32248`; live status returned to 5/20 and target 6/20 | verified |
| Prove real recovery instead of only passing a smoke test | The resumed browser passed authenticated Doudian preflight, target 6 received `publish_signal_confirmed`, and the controller advanced to target 7/20 without replaying targets 1-5 | Controller `auto-listing-controller-20261005-171651.log`; live manifest/status | verified |

## 2026-09-19 Verified platform-brand identity reuse

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why platform-SPU selection appeared stuck despite the established same-name-brand procedure | Every target correctly exhausted the first `圣迪` identity (`standard_brand_id=1011059305`) through four empty queries before the second identity succeeded, but no successful identity was retained across the 20 targets; the status relay therefore repeatedly showed the last `no_rows` screenshot | Live run `20260919-172136`, targets 1-11; controller timeline and per-target screenshots | verified |
| Reuse the already-proven same-name brand safely | A run-scoped atomic preference store keys the verified identity by exact brand, SPU, specification policy, and normalized specification; the preferred identity is promoted only when rediscovered in the current exact-name dropdown | Platform-SPU rule and persistence regressions; full `rules:check`; representative simulation; live target 12 learned identity `1682826312`, target 13 selected it directly without retrying `1011059305` | verified |
| Preserve fail-closed fallback | Missing, malformed, stale, or absent preferences leave the complete frozen candidate sequence unchanged; the identity is recorded only after a unique exact row opens a real `/ffa/g/create` page | Platform-SPU rule and action source checks; all doctors; deep audit; real Feishu API and read-only Doudian session/DOM preflight | verified |

## 2026-09-19 Missing specification-template manual checkpoint

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Do not invent specification values when the controlled template surface is absent | Health-food specification editing again requires exactly one populated value supplied by the selected Feishu template; the standardized manual fallback was removed | Specification-template, health-food DOM, publish-sequence, module-boundary, and full rules checks | verified |
| Stop promptly and ask for manual correction | `spec_template_surface_missing` is not retried in the product loop or supervisor; controller status preserves the exact checkpoint and reports “请人工修改后继续上架” | Progress-state regressions and compact controller status | verified |
| Resume the manually corrected target without replaying successful targets | Resume continues from the canonical manifest and durable pre-submit state | Live locked batch resumed at watermark 07 with 6/20 retained; watermark 07 then published successfully | verified |

## 2026-08-09 OTC dosage asterisk preservation

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Login expiry after a safe publish prefix must enter observable wait and resume the untouched tail | Immutable 20-target publish plan authorizes target coverage; manifest remains the sole outcome authority for attempted targets | Red-before-green canonical plan plus partial manifest recovery regression; live image-008 target 09 failure; full rules, doctors, representative simulation, real Feishu API, and two eight-dimension audits | verified |
| Preserve the dosage separator from Feishu `标题固定后缀` | Title suffix normalization removes whitespace only and retains `*`; keyword cleanup remains separate | `test-feishu-title-keywords-rule.mjs` with `锁阳固精丸北方经开9g*10丸`; full `rules:check` | verified |
| Refuse an OTC publish whose workbook lost the fixed-suffix `*` | Publish metadata construction requires the workbook title to end with the exact current Feishu suffix before browser actions | OTC publish-policy regression and representative simulation | verified |
| Rebuild all 20 locked-batch workbooks without losing metadata | Distributed-title regeneration preflights exactly one canonical workbook per folder, stages all replacements, and changes only the title row | 20-workbook regression; current run deep-audit evidence `titles=20/20,unique=20` in two independent audits | verified |
| Resume at shop 02 without replaying shop 01 | Canonical manifest keeps shop 01 watermarks 01–04 safely published; remaining-folder selection subtracts those exact identities | Read-only remaining-target check returns 16 folders, first watermark 05; two independent deep audits report safe publish 4/20 and `unconfirmed=0` | verified |

## 2026-08-07 Hermes-isolated browser doctor parity

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why the locked 13-product batch stopped before product 1 | The latest controller log shows `doctor:feishu` rejected a nonexistent Playwright Chromium path derived from the isolated Hermes `HOME`; no run, paid image ledger, browser mutation, or submit attempt was created | Controller log `auto-listing-controller-20260807-220317.log`; processed manifest remains 0/13; runtime and paid-ledger directories are empty | verified |
| Doctor and real publisher must validate the same browser | `resolveBrowserExecutable` is the single exported candidate resolver used by both the CDP launcher and doctor; system Chrome/Edge remains preferred and the Playwright bundle is only a fallback | Red-before-green `test-browser-workspace-provider-rule.mjs`; all doctor modes resolve the production system Chrome; 20-shop audit uses the same launcher | verified |
| Preserve fail-closed browser availability | The shared resolver still throws when no supported system or Playwright browser exists; doctor converts that exact failure into a failed check | Full doctors, browser provider rule, and 20-shop read-only audit | verified |

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

## 2026-08-06 Missing specification-template surface recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Identify the actual shop 07 failure | Failed screenshot and live DOM show `商品规格/添加规格类型/规格预览` but no `规格模板` control; the final publish click was never attempted | Run `20260806-123037`, target `recvrqk61WtR3I/image-001/07/07`; read-only CDP inspection | verified |
| Use the user-verified recovery path | The dedicated `spec_template_surface_missing` class re-runs `runPublishFromSpuJob` without a create-page URL; `queryPlatformSpu` closes stale create pages, returns to 标品管理, re-enters brand/SPU and opens a new publish page | Rule regression and existing `runShopSpuAction/queryPlatformSpu` action contract | verified |
| Bound retries and preserve the target | The same canonical target gets at most three SPU-entry rebuilds; no final-submit/list verification path is used because the failure occurs before submit | `shouldRetryPublishFailure` regression at attempts 0, 2 and 3 | verified |
| Report the real failure | Hermes status gives the missing-template-surface recovery message before the generic price/inventory summary | Compact-status regression with the production error | verified |

## 2026-08-07 Post-submit list settlement and circuit closure

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Do not let an unrelated persistent spinner hide exact positive results | Exact query identity, a positive result count, and visible result rows settle the read-only lookup even if another page region retains a loading indicator | Red-before-green production-shaped regression with `count=2`, `rows=2`, `loading=1` | verified |
| Never advance past an inconclusive post-submit lookup | A lookup exception is converted to `submit_accepted_unconfirmed/final_publish_state_uncertain`, which opens the existing batch circuit before any later shop | Structural regression in `test-progress-state.mjs` | verified |
| Preserve the irreversible-boundary rule | Only a verified found product is marked `list_verified`; a confirmed negative result remains the sole gate for the one bounded explicit-rejection retry | Existing publish-state regressions | verified |

## 2026-08-07 Dependency audit closure

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Remove vulnerable transitive archive and development-server packages | Lock `tar` and `esbuild` to patched release lines through root overrides while retaining the current application dependency surface | `npm audit --omit=dev` reports 0 vulnerabilities | verified |
| Preserve native Chinese tokenization after dependency resolution | Load `nodejieba` and segment a production-shaped medical-device title | Native smoke output `医用\|疼痛\|凝胶`; full `rules:check` | verified |

## 2026-08-07 Committed brand gate before SPU query

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why brand-first code still issued an SPU-only query | Brand lookup climbed into a broad ancestor and could take the preceding 商品类目 combobox; the action then accepted clicked-option text despite an empty brand readback, so SPU entry proceeded without a committed brand and returned another brand with the same registration number | Run `20260807-084931`, shop 06 result and mismatch screenshot showing `葵花/晋械注准20242090092`; live DOM maps `rc_select_0` to 商品类目 and `rc_select_1` to 品牌 | verified |
| Bind the action to the actual brand field | Every brand availability, entry, option, and readback path resolves the unique visible combobox inside the nearest `.ecom-g-form-item` carrying the exact 品牌 label; broad ancestor climbing is prohibited | Red-before-green structural regression; live DOM readback | verified |
| Require a committed brand before SPU entry | Uncommitted search text and clicked-option text are excluded from acceptance; readback climbs to the exact Select root (never the inner `selection-search` span) and the selected display must match the Feishu brand twice consecutively | Red-before-green `test-platform-spu-query-page-rule.mjs`; production screenshot with visible selected brand exposed and closed the inner-container false negative | verified |
| Prevent SPU entry from silently clearing brand | Brand is read again after SPU entry and must still exactly match before the query button can be clicked | Production-shaped regression and structural ordering assertion | verified |
| Recover safely from a transient dropdown failure | Missing or lost brand commitment maps to `platform_page_not_ready`, receives the existing bounded page rebuild retries, and never reaches query or publish | Failure classification regression and full `rules:check` | verified |
| Verify the corrected control on the real page | Real keyboard input exposed exactly one `延草纲目` brand option and the selected display read back `延草纲目` twice; no query or publish click was issued | Headed CDP DOM check in the fixed browser profile | verified |

## 2026-08-08 Vanished shop-chooser recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Distinguish a transient page reload from a truly missing canonical shop | Target absence is terminal only while the chooser remains stably visible; a vanished chooser is classified as a transient navigation/loading state | Run `20260808-183053`, target 13 screenshot and zero-byte chooser DOM; production-shaped rule regression | verified |
| Retry without crossing the publish boundary | The action returns to the canonical SPU page and retries the same shop switch at most three times; the existing current-shop readback remains the success gate | Structural shop-switch regression; `publish-submit-attempt.json` remains `not_attempted`; live target-13 readback matched | verified |
| Prevent controller-child loops from resetting confirmed-rejection retry limits | One exact target/title/shop ledger is consumed before the controlled retry; a repeated confirmed rejection becomes `submit_rejected_exhausted`, is audited as a transparent deferred target, and is excluded from resume replay | `confirmed-rejection-retry.ts`; manifest/resume regressions in `test-progress-state-part-1.mjs`; live run `20260810-191157` deferred target 01 and advanced to target 03 without reopening the circuit | verified |
| Keep deep title auditing complete across a resume subset | The title audit unions the resume task folders with only the exact batch/record/task manifest scope, deduplicates canonical paths, and still requires the category's full title count, uniqueness, length, and fixed suffix | Red-before-green 6-of-20 resume regression in `test-deep-auto-listing-audit.mjs`; paused run `20260810-191157` audited `titles=20/20,unique=20`; unrelated-batch manifest entry excluded | verified |
| Make recovery a single derived state model instead of patching stale resume jobs | `resolveCanonicalResumeDecision` derives every launch from exact batch/record/task manifest coverage first and task artifacts second; `resume.generated.json` is write-only disposable execution input, the old `shouldResumeCurrentFailure` and three stale-job predicates are deleted, and supervisor regenerates the plan before every resume child | Pending-target and complete-20-target canonical resolver regressions; controller structure regression forbids old resume-job authority; live run `20260810-191157` now derives `startStep=cleaned` instead of `titles_generated` or another publish replay | verified |
| Converge terminal publish outcomes without stopping every completed product | `isPublishOutcomeAcceptedForBatchCompletion` and `resolveCanonicalRecoveryTask` jointly drive manifest completion, publish planning, task blocking, audit coverage, cleanup eligibility, recovery, and status; durable deferred/non-replay outcomes retain warnings but complete the product, while actionable or ambiguous failures still fail closed | Red-before-green terminal-outcome and stale-current-task regressions; full `rules:check`; eight-dimension audit on run `20260810-225345`; live Feishu API; 20/20 read-only shop audit `20260811-100505` | verified |
| Preserve fail-closed evidence | A stable chooser missing the exact shop still stops and saves DOM plus screenshot; the final unstable attempt uses its own evidence name | Rule regression for both transient and stable-missing branches; live check used no publish/form mutation | verified |

## 2026-08-12 Authoritative post-navigation shop readback

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Do not misclassify a successful full-page shop switch as a vanished-chooser failure | After the chooser disappears, the action waits for navigation and reads the current header shop before deciding whether to retry; an exact current-shop match is authoritative even if the click callback was lost | Real target 17 screenshot shows `延草纲目医疗保健专营店`; `publish-submit-attempt.json` is `not_attempted`; rule and structural regressions cover the lost-click-return branch | verified |
| Preserve fail-closed behavior | A stable chooser without the target still fails; a vanished chooser with neither click confirmation nor exact current-shop readback remains bounded-retry only | `test-progress-state-part-1.mjs`; `test-shop-switch-structure-rule.mjs` | verified |
| Preserve canonical coverage across repeated recovery | Publish-plan persistence merges by immutable target identity instead of overwriting the plan with only remaining folders; existing narrowed plans may recover only when their identity/path-verified union with the manifest covers exactly all 20 targets | Regression with manifest targets 1-17 plus narrowed plan targets 2-20; incomplete union and identity/path conflicts remain fail-closed | verified |

## 2026-09-01 Shop chooser loading-state recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Do not confuse a visible loading chooser with a missing dialog | The shop-switch action observes `ready`, `loading`, and `absent` independently; a large visible modal containing `加载中` is durable loading evidence | Headed delayed-ready, persistent-loading, and absent-surface regressions passed; structural rule passed | verified |
| Recover without replaying a publish side effect | A loading chooser waits up to 25 seconds, archives DOM/screenshot evidence, then returns to the canonical SPU page and retries the switch at most three rounds; this occurs before any create-form or publish mutation | Medical-device 20/20 live shop-access audit `20260901-092754` passed, including target 14; `publishAttempted=false`, `formMutationAttempted=false`; failed target submit boundary remains `not_attempted` | verified |

## 2026-08-12 Completed archive audit closure

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Keep completion cleanup and terminal audit on one artifact contract | A cleaned task recovers its five prompt groups from the durable `cleanupArtifact.archivedFiles` 01-20 slot manifest instead of depending on deleted task/shop intermediates | Red-before-green archive recovery regression; real completed run `20260812-204434` changed from `generated=4/20` to `20/20` without restoring deleted intermediates | verified |
| Fail closed on damaged archive evidence | Archive recovery requires exactly 20 unique, ordered, non-empty image files whose numeric filename suffix matches the durable slot; deep audit also reads every archived image dimension | Missing-slot and reordered-slot regressions; two independent eight-dimension audits on the completed run | verified |
| Preserve read-only Doudian verification | Category-scoped shop access audit uses only navigation, exact shop switching and DOM readback after the listing browser releases ownership | OTC audit `20260812-222405` passed 5/5 with `publishAttempted=false` and `formMutationAttempted=false` | verified |

## 2026-08-12 Continue semantics and durable completion evidence

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Never refresh or switch batches for “继续上架” | The controller resolves the locked cache first and returns `batch_complete` before cleanup, command selection or process launch when that batch is already complete; only `start-new` may refresh Feishu | Red-before-green launch-decision and controller-order regressions; real continue readback left both Feishu cache mtimes and the controller job unchanged | verified |
| Prevent a zero-task run from proving a completed batch | Deep audit requires substantive current-run tasks or exact durable completed-product evidence whenever the processed current batch is non-empty | Structural regression requires `completed_batch_evidence_missing`; the accidental zero-task run audits 20/20 only after durable evidence recovery | verified |
| Preserve terminal evidence outside disposable run history | Before committing the processed-image marker, the orchestrator atomically saves the completed task, canonical publish manifest scope and archived image paths under the batch/record identity | Persistence round-trip regression; current record recovery required 20 unique `publish_signal_confirmed` log entries and 20 archived files before writing evidence | verified |

## 2026-08-09 OTC five-shop publishing policy

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Keep 20 generated OTC images while reducing publishing to five ordered shops | Canonical OTC category plan now resolves shops 01–05 in the requested order with four targets per shop | `test-shop-category-rules.mjs`; `test-main-image-shop-distribution-rule.mjs`; representative simulation | verified |
| Do not change OTC category attributes after title and short title | Category mutation policy omits `modelSpec` from OTC basic metadata and removes the synthetic `盒装` fallback | `test-otc-publish-policy-rule.mjs`; full rule closure | verified |
| Select the OTC “买二送一” template without changing any specification value | Category policy independently enables the controlled template and disables every specification-value mutation; the template must generate the four price rows before price/stock entry | `test-otc-publish-policy-rule.mjs`; publish module sequence rules | verified |
| Clear platform-prefilled main and detail images before project image actions | Dedicated action module clears each required section and fails closed unless DOM readback is zero; detail order is clear → fill from main → confirm → Feishu qualification upload | `test-graphic-prefill-clear-rule.mjs`; DOM-click policy; full rule closure | verified |
| Prove the new shop order without image generation or publishing | Category-scoped shop-access audit accepts `--category 非处方药`, consumes the canonical plan, and forbids form/publish side effects | `test-shop-access-audit-rule.mjs`; live run `20260809-171908` passed shops 01–05 with zero form/publish attempts | verified |

## 2026-08-09 Category action isolation

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Prevent category behavior from drifting between publish modules | `publish-category-policy.ts` owns the complete executable action matrix; basic-info, specification, service and submit modules consume it without category-name branches | `test-publish-category-isolation-rule.mjs`; TypeScript build; full `rules:check` | verified |
| Keep medical-device-only and health-food-only actions mutually isolated | Policy startup assertions reject certificate/packaging overlap, partial health-food action chains and contradictory leave-unchanged policies before browser work begins | Category isolation, health-food sequence and medical-device certificate regressions | verified |
| Preserve OTC category isolation | OTC leaves category attributes unchanged, selects only the controlled “买二送一” specification template, retains the generic submit gate, and disables every medical-device/health-food-only mutation | OTC policy regression; category isolation regression | verified |
| Keep the long-term operating source aligned with repository rules | Project skill now records OTC five shops × four images, category-specific title/specification behavior and strict prefilled-image clearing | Skill and repository stale-rule search | verified |
| Audit the separation repeatedly without generating images or publishing | Full rule closure, representative simulation, all doctor modes, live Feishu 23-field readback, category-scoped shop switching and three independent eight-dimension deep audits | OTC shop audit `20260809-180026` passed 5/5; medical-device audit `20260809-180142` passed 20/20; both report zero publish/form mutation; three deep audits each report `ok=true` in all dimensions | verified |

## 2026-08-09 Obsolete and contradictory rule removal

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Remove duplicate Markdown rule authority | Delete the obsolete monolithic publish SOP; point AI and maintenance entry docs to the canonical step manual and category policy | `test-obsolete-rule-source-removal.mjs`; stale-reference search | verified |
| Remove unreachable identity compatibility behavior | Delete the dead legacy completed-result recovery branch; canonical publish identity remains mandatory before plan/resume decisions | Obsolete-rule regression; canonical identity regression | verified |
| Stop leaking medical-device attributes into other category artifacts | Generated title workbooks no longer prefill `型号规格=盒装`; publish metadata synthesizes it only when the centralized medical-device policy permits it; generic workbook preflight no longer requires it | OTC, health-food and category-isolation regressions | verified |
| Remove the unreachable product-info Excel compatibility path | Auto-listing config, types, metadata enrichment, preflight, Doctor, examples and step documentation now require the current Feishu product record; unused Excel/key-map/product examples are deleted | Obsolete-rule regression; Feishu field/API checks; representative simulation | verified |
| Reject identity-free historical processed state | Version 2 batch-scoped processed manifests are mandatory; automatic legacy-array migration and identity-free append behavior are removed from all launchers | Obsolete-rule regression; progress-state regression | verified |
| Remove display-name-derived cleanup fallback | Publish runtime cleanup only consumes canonical result-file parents and returns no deletion target when canonical evidence is absent | Cleanup regression; residue audit | verified |
| Remove display-name publish-progress grouping | Progress grouping now requires batch fingerprint, record ID and task ID; identity-incomplete entries are hidden instead of merged by product-folder display name | Progress-state regression; obsolete-rule regression | verified |
| Delete optional-slot mutation code | Remove dead white-background upload/delete/readback and 3:4 purge/readback helpers; these sections remain completely outside the publish flow | Obsolete-rule regression; graphic-flow and DOM-click regressions | verified |
| Remove inferred-shop dead fallback | Real distribution now requires an existing canonical shop-code directory; the unreachable simulated inferred-folder branch is deleted | Obsolete-rule regression; shop distribution and category-plan regressions | verified |
| Remove unbound image discovery fallback | Feishu orchestration creates tasks only from current-record attachments or an identity-verified explicit resume source; empty current selection no longer scans the image directory for arbitrary files | Obsolete-rule regression; Feishu cache and representative simulation | verified |

Final evidence: full `rules:check`, all Doctor modes, representative simulation, live Feishu 23-field readback and two independent eight-dimension audits passed. The final OTC read-only shop audit `20260809-193651` passed all five canonical shops with `publishAttempted=false` and `formMutationAttempted=false`.

## 2026-08-09 Module-size and responsibility-boundary audit

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Remove hidden large-file exemptions | Replace the former 3000-line controller and 2600-line main-image allowances with a uniform 1500-line production limit; retain only the stricter 120-line public-entry limit | `test-module-size-boundaries.mjs`; full source line-count scan | verified |
| Split the controller by responsibility | Separate shared contracts, runtime/process and artifact collection, status composition, and command/resume orchestration into four modules | TypeScript build; controller structure and progress regressions | verified |
| Split image-provider actions from asset orchestration | Move provider request, paid-slot recovery and download actions into `main-image-provider-action.ts`; keep watermark, shop assignment and product-folder assembly in `main-image-assets.ts` | Provider, reuse, square-image, prompt and distribution regressions | verified |
| Remove the 6338-line regression-test aggregate | Keep a thin test entry and divide assertions into three independently bounded suites; closure audits consume all suites | Progress-state regression; rule-closure audit; 3000-line test gate | verified |
| Keep future modules bounded without per-file escape hatches | Scan every TypeScript/MJS file under `src` and `scripts` on each `rules:check` run | Full `rules:check`; stale-exemption search | verified |

Final evidence: full `rules:check`, all Doctor modes, live Feishu 23-field readback, representative simulation and two independent eight-dimension audits passed. The largest production module is now 1482 lines and the largest test module is 2543 lines; neither production nor test gates contain a large-file exception.

## 2026-08-09 Hermes Python environment isolation

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Reproduce the real startup failure | The latest controller log stops before creating a run because Pillow is installed in the macOS user site while an inherited `PYTHONNOUSERSITE=1` hides it; the same poisoned environment reproduces `ModuleNotFoundError: PIL` | Controller log `20260809-212752`; poisoned-shell reproduction | verified |
| Remove upstream Python-environment contamination at the project boundary | `sanitizePythonRuntimeEnv` removes Python home/path, user-site suppression, foreign virtualenv/Conda and macOS launcher overrides; the controller applies it before spawning the real flow | `test-python-runtime-env-rule.mjs`; controller structural regression | verified |
| Keep Doctor and real image actions consistent | Base/auto-listing Doctor, watermarking, main-image square normalization and qualification-image normalization all consume the same sanitized environment | Poisoned-environment Doctor; Python action regressions | verified |
| Resume only the locked batch after delivery | Push the verified fix before invoking `auto-listing:hermes-continue`; preserve batch `3891df866b4e4781b1ec7816` and reuse its accepted image tasks | Git/remote equality; run `20260809-214041` reached 20/20 generated images and entered publish target 1/20 with shop progress 1/5 | verified |
| Keep runtime status aligned with category-specific shop rules | Current Feishu category now supplies the fallback shop count and images-per-shop; removed the obsolete two-targets-per-shop display inference and suppress publish progress before publishing begins | `test-shop-category-rules.mjs`; progress-state regression; live run `20260809-214041` diagnosis | verified |
| Clear platform-prefilled main and detail images against the current Doudian DOM | Main clearing hovers the exact material preview and clicks its semantic `#icon-shanchu` action. Detail clearing scopes to `商品详情`, targets the last sortable preview through semantic delete controls (class, accessible label, or title), is independent of heuristic image rectangles, waits for a bounded count decrease after every deletion, and retains strict zero-count readback | Failure evidence: run `20260829-231740`, target `44e58e4a27bad95d6bd9c70d__recvtvBqB6ID3M__image-002__04__04`, submit state `not_attempted`, stale rectangle-gated clear stopped at `remaining=1`; red/green `test-graphic-prefill-clear-rule.mjs`; resumed run produced the graphic-upload screenshot, safely published target 4, and advanced to target 5 | verified |
| Reconcile OTC price-row requirements without mutating template values | Root cause was the obsolete rule that skipped the specification template. The corrected category policy selects and verifies “买二送一”, preserves its specification values, and then consumes the four generated price rows exactly like the medical-device common flow | OTC/category-isolation regressions; live run `20260809-214041` produced the controlled four SKU combinations and filled four price/stock rows | verified |
| Verify the OTC SPU with the correct category field | Service-entry safety gate reads `药品批准文号` and parses `国药准字...` for OTC instead of searching medical-device registration labels | Service-fulfillment and category-isolation regressions; live continuation passed the SPU gate and reached service fulfillment | verified |
| Enforce OTC after-sales and freight settings without coordinates | OTC category policy selects and reads back `售后政策=不支持7天无理由退货`; all categories accept only a freight-template readback containing `延草运费`; actions use field-root/radio/dropdown DOM relationships only | Service-fulfillment regression; DOM-only and no-coordinate-click audits | implemented; live verification pending |
| Preserve actionable evidence for service-fulfillment failures | Failure evidence proved `售后政策` is a dropdown below a separate `售后服务` checkbox. A reusable labeled-select action now resolves the dropdown through field ancestry, selects one exact option and independently reads it back; failures retain a screenshot and bounded DOM summary | Screenshot `publish-page-fixed-settings-failed.png`; service-fulfillment, DOM-only, no-coordinate and module-size regressions | implemented; live verification pending |

## 2026-08-10 Operator-reviewed negative submit recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why OTC target 8 permanently stopped the batch | Initial and live read-only exact-title queries in shop 02 both returned stable `共0条` more than seven hours apart; ordinary resume correctly preserved the uncertain boundary but had no reviewed recovery path | Runtime result, attempt ledger, two `doudian-list-full-title-...-not-found.png` artifacts | verified |
| Keep normal resume non-idempotent | Existing uncertain results still stop unless an exact identity-bound manual recovery marker exists | Existing progress-state regressions plus recovery unit test | verified |
| Allow one reviewed recovery only on strong negative evidence | New recovery action requires an old attempted boundary, prior negative screenshot, exact shop/title identity and a second live `共0条`; it archives evidence before approval | `test-uncertain-publish-recovery.mjs`; live production recovery | implemented; live execution pending |
| Close verifier browser ownership | Exact-title verification closes its persistent context in `finally` | Build and live verifier process exit | implemented; live verification pending |

## 2026-08-12 Platform SPU publish-navigation state machine

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Select a publishable SPU identity instead of the first text match | The rule layer ranks only exact brand/SPU rows whose publish control is actionable, rejects ambiguity, and skips disabled rows such as `审核中` | Red-before-green actionable-row regression; live query selected the unique `已上线` row `7412804123768357147` instead of disabled row `7672595223100260659` | verified |
| Preserve one logical action across nested Doudian anchors | The action layer canonicalizes native controls, collapses invalid nested anchors to the leaf action, and requires exactly one marked control | DOM-structure regression; live DOM inspection; real query read back one exact row and entered its create page | verified |
| Use a real browser action and verify its outcome | The marked leaf control is clicked with Playwright; a bounded state machine observes same-tab URL changes, popup pages, and new context pages for `/ffa/g/create` | Regression forbids synthetic `HTMLElement.click()`; live create URL contained `spu_id=7412804123768357147`; create-page screenshot verified brand, certificate and category prefill | verified |
| Keep recovery safe and diagnosable | Pre-click ambiguity and post-click navigation failures save evidence and classify as `platform_spu_publish_navigation_failed`, which permits only bounded retry before any final-submit attempt | Failure-class regression; original target `publish-submit-attempt.json` remained `not_attempted`; live diagnostic did not click the final publish button | verified |
| Prevent a successful resume segment from self-locking the batch | Final-submit uncertainty is never counted as completed coverage; resume keeps that exact canonical target for read-only reconciliation. Unsafe manifest entries are grouped by `batchFingerprint + recordId + taskId + sourceImagePath`, and the controller reconstructs a missing task index from manifest identity when a later single-task resume has overwritten `result.tasks` | Red-before-green cross-task manifest regression in `test-progress-state-part-1.mjs`; current batch evidence contains independent product-2 review and product-3 pre-submit recovery targets | verified |
| Prevent one completed product from deleting another product's recovery inputs | Per-product cleanup deletes only the current task's explicit distribution folders, workbooks, runtime directories and exact source assets; it never sweeps children of batch-shared roots. If legacy cleanup already removed distribution folders but the same canonical task still has all 20 raw outputs, resume deterministically rebuilds from `main_images_generated`; otherwise it fails closed | Red-before-green cross-product cleanup preservation test; missing-distribution complete/incomplete raw-set regressions; live product-3 recovery rebuilt shops 16–20 and advanced beyond the original stop without paid generation | verified |

## 2026-08-12 Hermes HOME isolation for the Python runtime

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Reproduce the current pre-run stop | Run the Python boundary with `HOME=/foreign/hermes/home`; macOS Python redirects its user site-packages and cannot import Pillow, matching controller log `20260812-224555` | Red-before-green `test-python-runtime-env-rule.mjs`; direct poisoned-HOME reproduction | verified |
| Isolate the complete Python user-site boundary | `sanitizePythonRuntimeEnv` now restores the operating-system account home and removes `PYTHONUSERBASE` in addition to the existing Python/virtualenv overrides; the parent Hermes environment remains unchanged | Python runtime regression; poisoned-environment auto-listing Doctor | verified |
| Prevent another false-green environment test | The regression now poisons both `HOME` and `PYTHONUSERBASE`, asserts the restored account home, then imports Pillow with the exact sanitized environment | `test-python-runtime-env-rule.mjs` | verified |

Final evidence: clean build, pre-rules, full rules closure, all Doctor modes, representative simulation, live Feishu 23-field readback, two independent batch audits and the 20-shop read-only Doudian audit `20260812-225732` passed. The shop audit recorded `publishAttempted=false` and `formMutationAttempted=false`; batch `52e54a6038e5dd38cc64dc82` remained locked at 0/10 with 200 category-correct planned publish targets and no missing local attachments.

## 2026-08-19 Platform SPU single-identity action pipeline

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Reproduce the current shop-11 stop without touching final submit | The retained screenshot shows one visible `湘械注准20222141671` row while the old second DOM scan reported `matchingRows=2; actionableControls=1`; a browser regression recreates one visible row plus one hidden platform clone | Runtime `20260818-195102`; red-before-green `test-platform-spu-query-page-rule.mjs` | verified |
| Remove the divergent candidate/click identity models | Candidate collection now filters visible leaf rows with direct cells, canonicalizes one logical publish control and attaches its unique temporary DOM identity; the rule-selected candidate carries that exact identity to Playwright | TypeScript build; structural regression forbids `markExactPlatformSpuPublishAction` and requires `matched.publishActionSelector` | verified |
| Preserve fail-closed ambiguity handling | Multiple visible actionable exact rows still fail in the rule layer; hidden clones, nested parent rows and disabled controls cannot create a second logical target or become clickable | Candidate-selection ambiguity regression; hidden-clone browser regression | verified |
| Keep audit semantics aligned with the irreversible boundary | A failed target is pending only when `finalVerifyStatus=not_checked`, its error class is in the explicit pre-submit allowlist and the incomplete run permits recovery; final-submit uncertainty and unknown failures remain audit errors | Red-before-green `test-progress-state-part-3.mjs`; two fresh eight-dimension audits report `sideEffects: unconfirmed=0` and 10 pending targets | verified |
| Resume only the locked failed batch after verified delivery | Continue through `auto-listing:hermes-continue`, retain batch `b219f88e30a9fd9cc1b94113`, reuse 10 safely published targets for the current product and restart at shop 11 | Two deep audits and 20-shop read-only Doudian audit passed; Git remote equality and live continuation are delivery gates | implemented-unverified |

## 2026-08-12 OTC brand/SPU/specification identity

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Distinguish multiple same-name platform brands | Query actions freeze exact-name options by stable `standard_brand_id`, uniquely click that identity, verify stable brand text before and after SPU entry, and advance candidates only in that frozen order; the closed virtual dropdown is not treated as a durable identity readback source | Real `龙仕康` dropdown exposed three identities; regression covers ordering, deduplication, unique identity targeting and fail-closed observable readback | verified |
| Select the exact OTC specification | Central category policy requires `brand + SPU + specification` only for OTC; the rule layer extracts `规格：...`, normalizes separators and accepts one exact actionable row | Red-before-green four-row regression for `300丸 / 480丸 / 6g*12袋 / 6g*7袋`; real Feishu `规格=480丸` selected SPU ID `7538641052859171099` | verified |
| Preserve the complete query identity across recovery | Job, shop/SPU action and basic-info reopen paths pass one typed request containing brand, SPU, match policy and Feishu specification | Structural metadata-chain regression; TypeScript build | verified |
| Stop at the first valid brand identity | Empty results or specification mismatch receive three bounded fresh-page queries on the current frozen identity before advancing; an exact unique match enters the create page and terminates the search | Real query skipped the first exhausted brand identity and opened the `480丸` OTC create page with correct brand, approval number and specification prefill | verified |

## 2026-08-19 Feishu-driven specification template

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Make `规格模板` a mandatory source field for every category | `specTemplate` is part of the field map, normalized record, required-field contract, cache schema v3, field-map v3 and batch fingerprint | Feishu source/config/cache regressions; live 24-field API readback; 7 valid v3 records | verified |
| Select exactly the value written in the current Feishu row | Category policy exposes only `feishu_exact`; publish metadata carries the record value; the action layer rejects aliases, substring matches, title inference and category defaults | Spec-template, category-isolation, OTC-policy and representative-flow regressions; all 7 live values read `买一送一` | verified |
| Stop safely when Doudian has no exact option | Exact-option absence classifies as `spec_template_configuration_missing`, opens the immediate batch circuit before final submit, and keeps the target `not_checked` | Dedicated failure-class/circuit regression; full rule closure | verified |
| Keep Hermes output limited to the requested remediation message | Controller and continuation compaction consume a dedicated rule returning `没有对应的规格模板可选` | Dedicated Hermes status regression and progress-state suite | verified |

Final evidence: clean build; full rule/contradiction closure; all Doctor modes; representative simulation; two eight-dimension audits; live Feishu 24-field/v3-record verification; and the 20-shop read-only Doudian audit `20260819-234235` passed with `publishAttempted=false` and `formMutationAttempted=false`.

## 2026-08-20 Dynamic Feishu price-to-SKU cardinality

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Remove the fixed four-price assumption | `resolveFeishuPriceInventoryRows` accepts any non-empty descending list of positive Feishu prices and maps every value to stock 2000 | Two-price and four-price rule regressions; two-price representative simulation | verified |
| Bind prices one-to-one to template SKU rows | A centralized cardinality rule requires visible SKU row count to equal Feishu price count before filling and again before final readback | Price-action source regression, full browser-flow rule suite and contradiction audit | verified |
| Prevent partial writes | The action no longer uses `Math.min`; row-count mismatch returns a dedicated price/inventory failure before changing any price or stock | Negative cardinality regression and `price_inventory_not_ready` failure-class regression | verified |
| Resume the exact failed batch safely | Preserve batch `360004ca9f328d5fbf0161af`, reuse paid/generated artifacts and restart target 01 from its pre-submit boundary | Two deep audits prove exact batch/record/target identity, 20/20 paid images complete and `sideEffects: unconfirmed=0` | verified |

Final evidence before delivery: clean build; full rules and contradiction closure; all Doctor modes; two-price representative simulation; live Feishu 24-field API check; two passing eight-dimension audits; and 20-shop read-only Doudian audit `20260820-001207` with `publishAttempted=false` and `formMutationAttempted=false`.

## 2026-08-21 Accepted image-task upstream availability circuit

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain the current 18/20 stop from durable evidence | Fixed slots 09 and 10 each accumulated accepted tasks ending in `upstream_error` with `exit` or `Internet Error，请耐心等待！`; the supervisor misclassified them as ordinary provider failures and exhausted recovery 12/12 | Locked batch `6c747dd36f0c2a989d9ef69c`; paid-image slot ledgers; run `20260821-102344` | verified |
| Separate provider availability from business and safety failures | The rule layer recognizes only accepted-task `upstream_error` with the two explicit availability messages, while content policy, permission, balance and ambiguous-acceptance failures keep their existing fail-closed paths | Red-before-green controller regression plus existing negative provider classifications | verified |
| Stop burning retries and paid slots during an outage | The action layer routes these failures through the existing fixed-slot exponential circuit and the supervisor's independent `external_service_wait`; ordinary child recovery attempts are not consumed | Fixed-slot recovery regression and supervisor recovery-budget regression | verified |
| Do not stop a locked batch merely because an image-service outage outlasts twelve waits | Availability-only failures remain in the project-owned `external_service_wait` for the lifetime of the authorized task; the obsolete wait-attempt ceiling, environment override, terminal branch, and operator-renewed recovery episode are removed | Red/green exhausted-wait regression; supervisor source absence assertion; 2026-08-27 runtime evidence | verified |
| Preserve successful work on continuation | The persistent ledger remains at 18 completed slots and authorizes submission only for failed fixed slots 09 and 10; original prompt identity remains unchanged | Live ledger summary before continuation and paid-resume-plan regression | verified |

## 2026-08-23 Recharge-gated fixed-slot recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Resume after the user restores provider funds or removes an exhausted API Key quota ceiling without weakening financial fail-closed rules | Dedicated operator action accepts only `failed_before_acceptance + non_replayable + HTTP 403 insufficient_user_quota/用户额度不足/pre_consume_token_quota_failed`, with no provider task ID or response summary | Red-before-green paid-ledger regression for both wallet and API Key quota failures; production slot evidence | verified |
| Preserve paid identity and prevent whole-round replay | Approval keeps request/prompt digests and authorizes only the explicitly listed fixed slots; completed slots remain immutable | Paid-ledger action regression and post-approval ledger audit | verified |
| Make the financial override auditable | Controller must be stopped; product ledger and every target slot are validated together and archived before approval entries are appended | Recharge recovery CLI archive and approval manifest | verified |

## 2026-08-21 Paid-image materialization provenance and operator-approved completion

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why later run folders looked like full regeneration | Thirteen runtime folders contained 202 `generated-*` copies but SHA-256 grouped them into only 18 unique fixed-slot images; provider status readback proved all 26 slot-09/10 retry tasks failed without result URLs | Live filesystem hash audit and authenticated provider task readback | verified |
| Distinguish ledger reuse from provider generation | Every raw materialization now receives a provenance sidecar with fixed slot, digest and `providerSubmissionPerformed`; progress text says whether a provider submission occurred | Provider action regression and full rules closure | verified |
| Complete an explicitly accepted image set without another paid request | A centralized existing-result recovery validates all mappings before mutation, accepts only safe `failed_after_acceptance` targets and valid completed sources, and persists source-slot/digest/reason provenance | Paid-ledger red-before-green recovery regression; live 09:11 and 10:12 recovery produced 20/20 with no submitted slots | verified |
| Preserve both sides of recovery without watermarks | The archive action writes separate pre-recovery and post-recovery snapshots with slot-numbered raw files and manifests containing missing slots and recovery provenance | Archive snapshot regression; live `202608211339GYD凉感镇痛贴-恢复前原始无水印图` and `202608211339GYD凉感镇痛贴-恢复后完整无水印图` inspection | verified |

Final evidence: full rules and contradiction closure, all Doctor modes, representative simulation, live 24-field Feishu check, two passing eight-dimension audits with paid images `20/20` and `unconfirmed=0`, plus the 20-shop read-only Doudian audit `20260821-134147` with `publishAttempted=false` and `formMutationAttempted=false`.

## 2026-08-22 Bounded image-service recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain the apparent infinite image wait | Durable run history shows repeated `videos-base64 ... fetch failed` runs approximately every four minutes while the controller stayed `running`; the no-acceptance branch used a 10-second delay and bypassed the ordinary finite budget | Runtime timeline for batch `55c5cc41c894ec8eae59aa59` and controller log | verified |
| Route every image transport outage through one service-wait policy | No-acceptance `fetch failed` and `fail_to_fetch_task` now classify as external service availability and use the canonical three-minute wait | Progress-state rule regressions | verified |
| Guarantee controller convergence | External waits have an independent default 12-attempt budget; exhaustion refuses another child run and exits terminal failed while preserving the locked batch and paid-slot ledger | Supervisor recovery-budget regressions | verified |
| Stop the whole task at an unresolved final-submit boundary | The orchestrator now treats `submit_accepted_unconfirmed`, `needs_manual_review`, and `not_checked` outcomes as blocking even when the browser action result still carries `ok=true/status=published`; cleanup, completion evidence, and the next Feishu product cannot advance | Publish-result contract regression plus representative simulation | verified |
| Prevent false durable completion at the persistence boundary | `saveCompletedProductEvidence` independently recomputes complete identity-bound accepted coverage and rejects unsafe/incomplete manifests even if an upstream caller supplies `task.status=done` | Deep-audit completion-sink regression | verified |
| Recognize the shop-07 platform rejection instead of waiting indefinitely | Post-submit inline `规格值不能重复` is now a first-class deterministic rejection; exact-title absence converts it to terminal skipped coverage without another click, while the fixed medical-device template remains untouched | Submission-rule, result-state, resume, and completion-classification regressions; live screenshots for both affected shop-07 targets | verified |
| Continue the exact current batch after deployment | Paused at a safe publish boundary, restarted with `auto-listing:hermes-continue`, and resumed the same cached product at shop 08/20 with graphic-upload progress and no Feishu refresh or image regeneration | Real controller PID `70322`, run `20260822-094327` | verified |

## 2026-08-24 Fully decoded image-artifact boundary

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain the false 20/20 stop from durable evidence | Slot 06 and its runtime raw file had a valid PNG header and expected 1254×1254 metadata but only 81,170 bytes; Pillow full decode failed with `image file is truncated`, while the other 19 slot results decoded successfully | Locked batch `b7b661e2283acb9af5a66b19`, record `recvtcwDwSA4c6`, run `20260824-165214` | verified |
| Admit only complete provider bytes | Every URL/content response is written to an exclusive sibling file, fully decoded with Pillow, fsynced, then atomically renamed; invalid bytes cannot replace a prior valid artifact | Image-integrity regression covers valid, truncated and atomic-preservation cases | verified |
| Keep paid-task recovery single-identity | A completed ledger result must pass digest and full-decode checks. Corruption with a retained provider task ID resolves to `poll` for that same accepted task; successful same-task readback atomically refreshes only the invalid local evidence without another paid submission | Isolated paid-ledger corruption/re-poll/repair regression; production slot 06 resolves to `poll` with its original task ID | verified |
| Bind accepted tasks to the configured provider credential | Provider identity includes a one-way credential fingerprint. Legacy or rotated credentials can be rebound only after the current credential authenticates an exact completed task whose ID, model and size match a valid completed ledger result; the migration proof is retained in the product ledger | Credential-identity and authenticated-task-proof regressions; live current credential returned the exact completed task ID with HTTP 200 | verified |
| Prevent false reusable-image counts | Raw, staged, watermarked, final-upload, operator-mapped and audit artifacts all pass the centralized full-decode boundary; truncated filename-shaped files do not satisfy resume completeness or publish readiness | Mixed valid/truncated runtime and operator-recovery regressions; production run reports 19 verified raw images and an incomplete fixed round | verified |
| Recover through every delivery path before replacing a paid slot | A completed task whose CDN result fails full decode falls back to the authenticated content endpoint for the same task; both paths use full-decode validation, bounded transport retries and atomic replacement | Provider transport regressions plus production task `task_EgervNI0TcoSgKI0qLVPYGrLaWYTFDfU`, whose CDN and authenticated content repeatedly returned the same truncated PNG | verified |
| Replace only an irretrievable fixed slot | If both delivery paths for a completed task exhaust with invalid image bytes, the completed-but-invalid ledger record transitions to `failed_after_acceptance` with preserved evidence; recovery keeps the request/prompt identity and submits only that slot | Slot-transition, fixed-slot recovery and module-boundary regressions; production slot 06 audit history records the original completed task, dual-delivery failure, one replacement reservation and replacement task `task_o52ZJNQ57X75WE439ymJdjWpgNN9LO29` | verified |
| Close the live 20-image artifact gate before publishing | The replacement task completed, full-decode and atomic persistence succeeded, all five rounds staged exactly four images, and publishing resumed without refreshing or switching the locked Feishu batch | Deep audit on run `20260824-165214`: generation 20/20, paid ledger 20/20, batch fingerprint `b7b661e2283acb9af5a66b19`, controller running at publish target 1/20 | verified |

## 2026-09-04 Platform data-error action recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain the repeated first-shop stall | Runtime screenshots and DOM snapshots show both the SPU page and create page entering the explicit `数据异常请刷新重试` state; the old recovery only reloaded or revisited URLs and never used the platform-provided `立即刷新` action, so every bounded child attempt could recreate the same broken SPA state | Run `20260904-110841`; `platform-spu-query-no-rows.png`; publish-page-not-ready screenshots | verified |
| Use the platform recovery contract before navigation fallback | SPU and create readiness now locate exactly one visible button by role and exact name `立即刷新`, click it, and read back disappearance of the explicit data-error state before reevaluating readiness | `test-platform-spu-query-page-rule.mjs`; `test-publish-create-page-readiness-rule.mjs` | verified |
| Keep recovery bounded and fail closed | SPU recovery is capped at two action attempts; create recovery remains inside the existing bounded readiness loop. Missing/ambiguous controls or persistent errors fall through to the existing bounded navigation recovery and preserve the pre-submit checkpoint | TypeScript build; rule regressions; `publish-submit-attempt.json=not_attempted` | verified |

## 2026-09-05 Title-optimization advisory continuation

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain why the already-supported reminder stopped shop 20 | The post-submit handler already supported `不修改，继续发布`, but the earlier fill-check rule recognized `返回确认` only for `规格信息冲突`; the new `标题待优化` wording therefore failed before the publish button was clicked and caused the whole form to be rebuilt three times | Run `20260904-234337`; shop 20 result; `publish-submit-attempt.json=not_attempted` | verified |
| Preserve the title and dismiss only the advisory | Rule classification now treats exact `发布提醒 + 标题待优化 + 返回确认` as a non-blocking advisory. The action requires exactly one visible semantic button, clicks it, and waits until the dialog is hidden; no title mutation or regeneration is invoked | `test-progress-state-part-1.mjs`; TypeScript build | verified |
| Continue through the real publish boundary | After fill-check dismissal the normal readiness gate and original `发布商品` action run unchanged; a later `不修改，继续发布` dialog remains handled only after the durable publish-attempt marker | Fill-check advisory regression plus submit action ordering regression | verified |

## 2026-09-08 Visible main-image field identity and pre-submit recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain the current shop-18 stop without guessing | The retained publish screenshot shows an empty visible main-image field, while the action returned before file selection because the old exact resolver counted hidden duplicate field roots; the durable submit ledger remained `not_attempted` | Run `20260907-145437`, target 18, `publish-page-images-uploaded.png`, `publish-submit-attempt.json` | verified |
| Make the main-image field a single actionable identity | The shared resolver prefers semantic `attr-field-id=主图`, filters candidates by actual visibility and live image inputs, and uses the legacy structural class only as a compatibility fallback with the same uniqueness rule | Hidden-duplicate, visible-ambiguity and missing-input regressions | verified |
| Remove false-empty success | Main-image prefill clearing and file selection now fail explicitly when no unique visible upload root exists; a missing root can no longer read back as an empty section | `test-graphic-prefill-clear-rule.mjs`; TypeScript rule regression | verified |
| Recover only before the irreversible boundary | Main-image upload readiness has a dedicated class and three-attempt publish retry budget; supervisor recovery requires durable `publishAttemptState=not_attempted`, while attempted or unknown submit state remains blocked | Red-before-green classification, retry-budget and supervisor safety regressions | verified |

Final pre-delivery evidence: full rule closure exited 0; all Doctor modes and representative simulation passed; live Feishu API returned all 24 mapped fields; two independent eight-dimension audits retained batch `0ef2d10adc6f16d4c5fe22fb` with `unconfirmed=0`; and the 20-shop read-only Doudian audit `20260908-130044` passed with `publishAttempted=false` and `formMutationAttempted=false`.

## 2026-09-08 Same-name brand result refresh and OTC specification-source isolation

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain the current first-shop stop | The query already froze and tried both `圣迪` brand identities, but advanced after one empty result; the second identity returned exact approval-number rows while the record-level field resolver had aliased omitted `规格` to `规格模板=买二送一`, making every real dosage mismatch | Run `20260908-131546`, two stable brand identities, retained query screenshots and pre-submit ledger | verified |
| Keep Feishu fields independent | Configured field names remain exact when an optional cell is omitted from a record; normalized aliases are accepted only by exact alias name, never by containment such as `规格` → `规格模板` | Red-before-green omitted-cell regression | verified |
| Preserve exact OTC product identity | An explicit product specification remains authoritative; an old-cache specification equal to the template is rejected and may only be recovered from the exact Feishu title suffix after removing its exact generic-name prefix | `0.1g*24片`, `50mg*100片` and explicit `480丸` rule regressions | verified |
| Retry every same-name brand without looping | Each frozen `standard_brand_id` gets an initial query plus at most three fresh-page result retries for empty or specification-missing results, then advances; the last exhausted identity reports an error | Pure transition tests, browser action structural test and finite-stop test | verified |

Final pre-delivery evidence: full rule closure, all Doctor modes and representative simulation passed; live Feishu API exposed all 24 mapped fields; two independent eight-dimension audits retained locked batch `0ef2d10adc6f16d4c5fe22fb` with 15/17 records processed and `unconfirmed=0`; the five-shop OTC read-only Doudian audit `20260908-150928` passed with `publishAttempted=false` and `formMutationAttempted=false`.

## 2026-09-13 Oversized paid-image reference recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Expose the real failure instead of `Invalid string length` | Provider errors are recursively compacted, echoed Base64 request bodies are redacted before persistence, and every concurrent reason plus the aggregate message has a hard bound | Regression with twenty 14MB failure objects; retained provider payload shows `image_too_large` under the former 14.15MB wrapper | verified |
| Prevent oversized reference submissions | References over 5.5MB are fully decoded and deterministically converted to a maximum-2048px JPEG without modifying the Feishu source file | Current `6642×5329`, 7,955,434-byte PNG normalizes to `2048×1643`, 280,907 bytes | verified |
| Preserve paid-slot identity during recovery | Only an explicit `failed_before_acceptance` slot may adopt the normalized request digest, and only while its prompt digest is unchanged; accepted, completed and ambiguous slots retain the original safety boundary | Paid-ledger identity regression | verified |

## 2026-09-13 Paid-submit gateway-timeout root cause

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain the current 18/20 image stop | Fixed slots 11 and 19 each received nine HTTP 524 responses (the original paid POST plus eight old retries), never returned a task ID, and therefore remain acceptance-ambiguous | Current paid ledger plus both runs' `response-03-videos-submit-transient-1..8.json` and terminal response files | verified |
| Prevent repeated paid POSTs after an ambiguous gateway response | Paid submit now uses a dedicated policy: any HTTP response not explicitly proving no acceptance gets zero retries and is preserved as `ambiguous`; status polling and result download retain their separate transient retry behavior | `resolvePaidImageSubmitHttpRetryPolicy`; red-before-green 524 regression; provider action source assertion | verified |
| Keep operator-verified no-acceptance recovery independent of audit wording | Reconciliation persists the structured `replayable` disposition and the submit guard honors it before applying conservative free-text uncertainty detection. This prevents negated phrases such as `response ... not ambiguous` from being misclassified while preserving `non_replayable` precedence | paid-image ledger regression; provider action structural regression; recovery archive `paid-image-no-acceptance-20260913-140122` | verified |
| Preserve the current 18 completed slots | No current ledger slot or result file is mutated during root-cause repair; unknown-task reconciliation requires provider history or explicit operator acceptance of possible duplicate charging | Current product ledger audit | verified |

## 2026-09-12 OTC title-suffix specification identity

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Reuse the already-found exact Doudian OTC SPU row when the Feishu title suffix contains both generic name and brand | Exact fallback derivation removes the leading generic name and then the immediately following exact brand before comparing the remaining specification; explicit non-template `规格` still outranks suffix derivation | Run `20260911-230541` exposed the old `expected=圣迪0.1g*24片` mismatch; after the fix, live continuation selected the exact `0.1g*24片` row, completed target 1/20 with `publish_signal_confirmed`, and advanced to target 2/20; `platform-spu-query-rules.ts`; `test-platform-spu-query-page-rule.mjs` | verified |

## 2026-09-10 Category-modification publish interstitial

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Never change category when the publish prompt recommends it | The rule recognizes the post-click category advisory by its category-modification wording; the action only uses a unique close control or Escape and contains no click on any category-modification action | Pure rule regressions and source-level prohibition test | verified |
| Close the prompt and click publish again | The same create page must expose the full retained DOM chain `类目填写错误 + 商品类目填写有误 + 建议修改为 + 类目未开通 + 发布商品` with no visible dialog; the action clicks the unique visible `发布商品` once to advance the validation state, observes and dismisses a DOM/native prompt when exposed, then clicks the unique visible `发布商品` exactly once more. If Doudian or the browser clears the prompt before Playwright can observe it, the final click is allowed only when the complete inline evidence remains and the visible-dialog count is exactly zero | Run `20260910-143353`, target 12 final screenshot/result; `test-progress-state-part-1.mjs` | verified |
| Keep retries bounded and preserve the irreversible boundary | The category path is available only once inside the current submit action; all ambiguous/missing DOM states fail closed. The current detail-prefill clear failure remains `not_attempted` and is classified as a bounded pre-submit overlay recovery | Run `20260910-143353`, target 06 submit ledger; `test-graphic-prefill-clear-rule.mjs` | verified |
| Handle the real two-stage platform timing | The first exact inline category state advances through one publish click; if the actual category prompt appears only afterward, it is closed without mutation before one final publish click. Neither phase loops | Target 12 real retry log and source-order regressions | verified |
| Recover the already-consumed target without opening generic replay | A separate canonical-identity and remediation-revision ledger permits one recovery for the current category-validation fix only when the prior ordinary retry is consumed, retained result/screenshot prove `类目填写错误`, and a fresh full-title query is exactly `共0条`; a code-reviewed revision bump is required when a previous remediation missed a newly observed platform timing | `category-validation-retry.ts`; `test-uncertain-publish-recovery.mjs` | verified |
| Keep pre-submit failures retryable after controlled recovery | Immediately after consuming an identity-bound recovery authorization, persist `publish-submit-attempt=not_attempted` with the recovery reason. A new `attempted_or_unknown` boundary may only be written by the next real final-submit click, so a transient platform-SPU/readiness failure cannot inherit the previous attempt's unsafe boundary | Run `20260910-143353`, shop 12 at `2026-09-10T13:23:02Z`; `publish-attempt-state.ts`; `test-progress-state-part-1.mjs` | verified |
| Dismiss the real early category-advice modal before graphic actions | Recognize the exact modal, forbid confirmation, enter choices only to reselect the exact current category with selected-state readback, then require a bounded fresh SPU-page rebuild while submit state remains `not_attempted` | Retained shop-06 DOM evidence and run `20260911-112655`: one bounded `transient_overlay_blocked` rebuild followed by `publish_signal_confirmed` at `2026-09-11T06:27:49Z`; `category-advice-overlay-action.ts`; `test-graphic-prefill-clear-rule.mjs`; `test-progress-state-part-1.mjs` | verified |

## 2026-09-14 Zero-billed 524 paid-slot recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain the 17/20 stop | Fixed slots 1, 5 and 6 persisted Cloudflare 524 submit responses and had no task IDs, so the safe ledger correctly marked them acceptance-ambiguous; the project had only a manual no-task reconciliation command and could not consume the provider's own zero-billing logs | Locked batch `e9d0595d3c2aff55e28b6331`, record `recvuYhu3ucrot`, run `20260914-120046` | verified |
| Prove no acceptance without weakening the paid boundary | Automatic matching requires every raw Cloudflare 524 artifact to join a cardinality-equal one-to-one perfect match with provider error logs within 5 seconds; every log must have the same model, exact 524 content, `quota=0`, and no `upstream_request_id`. All slots are validated as one set before any ledger mutation. Five seconds covers the provider's asynchronous whole-second timestamp; extra, missing, or unmatchable logs still fail closed | Pure matcher positive, negative, concurrency and ambiguity regressions; provider token-log read-only audit | verified |
| Resume only the missing fixed slots | After strict proof, the action records provider log ID, clock skew and raw-response SHA-256, converts only the proven slots to replayable `failed_before_acceptance`, then reruns the existing fixed-slot recovery once; completed slots remain reused | `paid-image-provider-log-reconciliation-action.ts`; main-image recovery integration | verified |
| Fail closed when evidence is incomplete | Log lookup failure, wrong model/status/quota, any upstream request ID, missing raw response, time mismatch, cardinality mismatch or lack of a perfect matching preserves the safety block and requires manual intervention | Matcher rejection regressions and bounded single-recovery loop | verified |
| Recover delayed provider log persistence | Run `20260914-165309` persisted slot 14's 524 at `10:54:44.508Z`; the unique zero-billed no-upstream provider error was written at whole-second `10:54:47Z`, a 2.492-second delay that the original 2-second window incorrectly rejected. The bounded window is now 5 seconds without weakening uniqueness | Current slot ledger, raw Cloudflare timestamp, live provider token-log query, delayed-log regression | verified |
| Recover simultaneous zero-billed 524 clusters | Run `20260915-003802` produced slots 2/3 at the same response second and two qualifying provider errors at the same log second; slots 4/5 formed a second equivalent pair. Per-slot uniqueness incorrectly rejected two candidates even though each cluster had equal cardinality and every log independently proved no acceptance. Matching now resolves the complete bipartite set deterministically and refuses extra/missing logs | Current four slot ledgers and raw responses; live provider token-log query; 2-slot/2-log and 2-slot/3-log regressions | verified |
| Generalize strict no-acceptance proof beyond one observed gateway code | Run `20260915-141155`, task `image-002`, slot 16 persisted a Cloudflare 502 page at `07:38:03.403Z`; the provider's unique same-second error log reported exact 502, `quota=0`, and no upstream request ID. The matcher previously hard-coded 524 and therefore refused valid proof. Recovery now accepts only the bounded Cloudflare gateway set `502/503/504/520-524`, requires local title/error code and provider status/error code to agree exactly, and retains all model, billing, upstream-ID, time-window, cardinality and perfect-matching safeguards | Current slot ledger and raw response; sanitized live provider token-log query; 502 positive plus mismatched/unsupported status regressions | verified |
| Tolerate eventual consistency of the provider token-log endpoint | Run `20260915-184439`, record `recvvcJYgqPyFe`, produced seven Cloudflare 524 ambiguous slots (6/7/8/11/15/19/20). All seven later had unique exact 524, zero-quota, no-upstream logs with 0.25–1.64 second timestamp skew, but the first one-shot lookup did not yet expose slot 20's entry and rejected the whole set. Recovery now refreshes only the read-only log endpoint every 5 seconds for at most seven attempts while preserving the same strict full-set matcher; no ledger mutation or paid POST occurs before a complete proof | Current seven slot ledgers/raw responses; sanitized live provider token-log query; delayed-visibility success and bounded-exhaustion regressions | verified |
| Keep repeated proven gateway outages self-driven without a paid retry storm | The prior two-attempt loop reconciled only the first gateway wave; a second wave exited before log reconciliation and left replayable evidence trapped as `ambiguous`. The final bounded attempt now still performs strict full-set reconciliation, then emits the internal exact `provider_log_no_acceptance_reconciled` marker and defers replayable slots to the supervisor with a three-minute retry signal instead of immediately issuing a third paid POST. The marker prevents the already-proven raw submit text from being reclassified as unsafe while ordinary provider wording remains fail-closed | Source-order and unsafe-reason regressions; external-service wait contract; live retry-wave ledger | verified |

## 2026-09-15 Health-food shelf-life and storage source-of-truth migration

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Read the two new Feishu columns end to end | `保质期` and `储藏条件` are explicit field-map keys, normalized record properties, health-food-only required values, cache schema/field-map v4 inputs and batch-fingerprint members | Feishu config/source/cache regressions; live 26-field API schema and one valid health-food record (`保质期=2`, `储藏条件=常温`) | verified |
| Remove historical fixed values | The old `保质期=2` and `贮存条件=常温` constants are removed. Publish metadata carries the exact current record values and a dedicated health-food metadata contract blocks missing or invalid values before browser actions | Metadata provenance and preflight regressions; hard-coded-value source prohibition | verified |
| Fill and prove exact Doudian state | The action writes `String(metadata.shelfLife)` to “保质期”, selects the exact “贮存条件” option matching `metadata.storageCondition`, then requires stable exact DOM readback before advancing | Health-food DOM action and rule-readback regressions | verified |
| Preserve all other categories | The new values are required only by the health-food record contract and consumed only under the existing health-food action policy; medical-device and OTC records may leave both cells empty and their actions remain unchanged | Category-specific source validation and existing category-isolation suite | verified |
| Remove the live specification-editor race | The first real shop exposed asynchronous mount timing, while shops 3/4 proved that a readiness-only gate remained racy: native diagnostics already saw two writable inputs although the subsequent Playwright `:visible` child lookup returned zero. The action now gates controls at `1/1` then `2/2`; every quantity write re-discovers the current React node, stamps a temporary DOM identity and uses only that identity's Playwright Locator for fill/commit/readback, with bounded retries and structural diagnostics | Run `20260915-232414`; shops 1-3 safely published; shop 4 failure retained `not_attempted` and two visible writable inputs; DOM identity regression | verified |

## 2026-09-18 Billed gateway acceptance isolation

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain the 16/20 stop without authorizing a duplicate paid submit | Slots 3/4/18/20 retained Cloudflare 524 responses without public task IDs; the provider token log contains exactly 20 billed task acceptances, of which 16 correspond to completed ledger submissions and four remain for the blocked slots | Locked batch `bc78d342821fa2911eb95ed5`, record `recvvnf59p6fmu`, run `20260917-213004`; sanitized live provider token-log audit | verified |
| Separate known completed billing before mapping unknown acceptances | The reconciliation rule first requires a five-second, cardinality-equal perfect match between every completed provider-backed slot and its billed log, removes only those proven logs, then applies the existing five-minute perfect match to the remaining ambiguous slots | `excludeKnownAcceptedProviderLogs`; completed-plus-ambiguous and unsafe-extra-log regressions | verified |
| Preserve the irreversible paid boundary | The four residual billed records were resolved through the authenticated provider task log; each public `task_...` ID passed the formal ID, status, model and bounded-time checks before its original slot moved from `ambiguous` to `submitted`, with no paid POST replay | Slots 3/4/18/20 all verified `SUCCESS` and reconciled to `submitted`; reconciliation command output retained in the ledger audit | verified |
| Validate recovered tasks against the actual submit attempt | Task creation-time validation is anchored to the slot's persisted submit-response `updatedAt`, not the earlier batch reservation `createdAt`, so serially submitted late slots are accepted only inside the same bounded verification window | CLI source assertion rejects the reservation timestamp; slots 18/20 regression scenario | verified |

## 2026-09-18 Paid-submit circuit and automatic billed-task recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain why image generation repeatedly stopped | Five prompt rounds started together and a concurrency-2 gate released the next queued POST after each 524; ambiguity was evaluated only after all workers settled, so one provider outage accumulated 10 billed tasks whose response task IDs were lost | Batch `bc78d342821fa2911eb95ed5`, record `recvvnf59pA83R`, slots 1-10 raw 524 responses and exactly 20 billed acceptances | verified |
| Keep generation fast without widening the irreversible window | Only paid POST acceptance is single-flight. As soon as a task ID is durable the next POST is released, while accepted tasks continue server-side generation, polling and download concurrently | `resolveVideosBase64SubmitConcurrency`; shared gate/circuit regressions | verified |
| Stop an outage from cascading across queued slots | The first ambiguous HTTP, transport result or malformed success trips the product circuit before the gate releases; every queued not-yet-POST slot fails before acceptance, bounding a new outage to one ambiguous slot | `PaidImageSubmitCircuit`; source-order and classification regressions | verified |
| Recover billed tasks without paid replay | A persistent headed provider session retains the login page when authentication is needed, queries a bounded task window, matches task creation/billing within five seconds, verifies every public task ID/status against the API, then restores only the original slots | Current 10-slot recovery moved main images from 10/20 to 20/20 with no paid POST and publishing started at 01:37:38Z | verified |

## 2026-09-18 Mixed billed-524 and content-policy recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain the 11/20 stop without weakening paid safety | Single-flight admission bounded the outage to slot 13; slots 14-20 never POSTed. Slot 13's billed log appeared 264 seconds after the persisted 524. A separate known task in slot 2 had failed after acceptance with Chinese content-policy wording | Batch `721c16015ad1ae2919846bc6`, record `recvvxAWpdSwAf`, run `20260918-191534`; paid ledger and sanitized live token-log metadata | verified |
| Prevent new paid work before ambiguity is resolved | Resume now performs paid-ledger reconciliation before starting any concurrent prompt round; existing ambiguity blocks every new POST until zero-billed or billed-task proof completes | `paidReplayPreflightSummary`; source-order regression | verified |
| Match billed ambiguity when another known task failed | Billing exclusion now removes every ledger slot with a public task ID and submitted audit, including `failed_after_acceptance`, before mapping the remaining billed log to the unknown slot | Live set of 13 billed logs: 11 completed, one known content-policy failure and one unknown slot 13; action regression | verified |
| Recover Chinese content-policy failures by fixed slot | “提示可能违反内容政策” is explicit policy evidence; only slot 2 changes to the compatibility prompt and writes `request-02-policy-retry.json` | Slot 2 moved from failed task `task_ekKxm...` to compatible retry and completed; pure recovery regression | verified |
| Preserve queued slots that never POSTed | `paid_submit_circuit_open_before_post` is persisted as replayable and overrides legacy contradictory `non_replayable` metadata for the same project-owned before-POST event | Slots 14-20 retained no task IDs and were admitted for controlled fixed-slot submission after the correction | verified |

## 2026-09-19 Nested quality-warning reconciliation recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain why target 7 stopped after the final click | Doudian nested one visible `商品质量分优化预警` inside multiple matching modal wrappers; the old wrapper-first locator counted the same descendant `知道了` button repeatedly and made exact-title reconciliation inconclusive | Run `20260919-195611`, canonical target `...__image-003__07__07`, retained failure screenshot and controller log | verified |
| Resolve one physical acknowledgement control without weakening fail-closed behavior | The action enumerates distinct page-level exact `知道了` button elements, keeps only visible buttons whose ancestor chain contains the exact quality-warning text, requires one unique match, clicks it and verifies that the association disappears | Pure selection regressions plus source prohibition against wrapper-descendant counting; full `rules:check` | verified |
| Cross the irreversible submit boundary without replay | Read-only exact-title verification returned `共0条`; the retained publish result independently proved `规格值不能重复`, so resume classified target 7 as deterministic rejection and advanced to target 8 without another publish click | Controller `20260919-223531`: target 7 not found and deferred, then target 8 SPU query; deep audit `87/100` safe with no side-effect errors | verified |

## 2026-09-20 Health-food title-policy rejection recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain the repeated stop at health-food target 1/20 | The retained final screenshot showed the explicit platform error `商品标题描述“[\"关节养护\"]”不符合平台要求，请重新填写`, while the health-food packaging gate had reported `checkPassed=true`; post-click polling recognized only system and duplicate-spec rejections and therefore misclassified the explicit rejection as final-submit uncertainty | Run `20260920-100235`, target `fd135f1c40fb74e124af1360__recvvzYz7ynLGH__image-007__01__01`, retained publish screenshot/result | verified |
| Classify the platform response before uncertainty fallback | Submission rules extract quoted rejected title phrases from visible page/error text and return `title_policy_rejected`; polling returns immediately on that explicit rejection rather than waiting into the generic no-success path | `publish-rules.ts`; `test-progress-state-part-1.mjs`; full `rules:check` | verified |
| Recover with bounded Feishu-derived titles only | The action filters the existing three Feishu keyword-derived candidates, excluding current, duplicate and rejected-phrase-containing titles, then writes and submits each candidate at most once; no category or other form field is changed | `publish-submit-page-action.ts`; candidate-selection regression | verified |
| Resume the stopped canonical target without duplicate publication | The old exact title was verified twice as `共0条`; the identity-bound one-use recovery archived the old result before retry. Live continuation replaced the rejected title with `海斯莱福氨糖软骨素钙片官方正品蓝帽保健品氨糖软骨素钙片`, received `publish_signal_confirmed`, and advanced from target 1/20 to 2/20 | Recovery archive `2026-09-20T13-24-00-264Z`; controller `20260920-212620` | verified |

## 2026-09-21 Provider-log availability under paid ambiguity

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain why 杜仲保健茶 stopped at 18/20 | Fixed slot 09 received a persisted Cloudflare 524 without a task ID and correctly stayed `ambiguous`; strict token-log reconciliation then encountered one `fetch failed` and exited immediately, while the outer paid-safety guard correctly refused a new POST | Batch `fd135f1c40fb74e124af1360`, record `recvvzYz7yFNRO`, run `20260921-004631`, slot 09 ledger and controller `20260920-212620` | verified |
| Retry the read-only evidence source without weakening paid safety | Token-log lookup treats transport failures, 429 and 5xx as read-only availability failures, retries inside the existing 37-attempt/3-minute window, and never mutates the ledger or sends a paid POST before strict zero-billed or billed acceptance evidence is complete | `paid-image-provider-log-reconciliation-action.ts`; reconciliation source regressions | verified |
| Keep supervisor self-healing during a longer log outage | If the bounded window gets no successful log response, the child emits `provider_log_lookup_unavailable`; external-service rules allow supervisor recovery despite the retained `paid submission safety block`, wait the canonical three minutes, preserve `ambiguous`, and rerun only preflight reconciliation without consuming the ordinary recovery budget | Progress-state regressions for classification, continuation, budget and delay | verified |
| Keep gateway evidence stable across runtime selection | The paid ledger is product-scoped across runs, but the raw 524 had remained under the creating runtime; resume selected an older reusable task and therefore read an unrelated slot-09 response. New ambiguous HTTP responses are now content-addressed under the product ledger and bound to the slot. Existing records migrate once from the exact persisted owner identity, never from the selected resume task | Canonical-evidence ledger test; digest/readback validation; owner-bound migration and source-order regressions | verified |
| Exclude superseded accepted attempts before mapping the lost task | Slots 08/09 each had an earlier accepted task that later failed; fixed-slot retry cleared their current task IDs but retained immutable `submitted` audit entries. Excluding only the 18 current completed IDs left two historical billed logs in the candidate set. Reconciliation now matches every submitted audit attempt independently, including repeated slots, and uses a strict cardinality-equal 10-second known-acceptance window that covers the observed 7.136-second billing/ledger offset | Live read-only token-log audit: 20 historical attempts excluded one-to-one; repeated-slot and skew regressions | verified |
| Accept whole-second billing immediately before local gateway persistence | Slot 09's exact billed log is timestamped `16:57:11Z`; the canonical 524 was persisted at `16:57:11.738Z`. Billed recovery now permits only the existing five-second clock skew before the local response and the existing five-minute delayed-billing bound after it | Live strict matcher isolated one residual billed record with `responseLagMs=-738`; negative-skew regression | verified |
| Resume only after real provider evidence | Slot 09 stayed non-replayable until the live token log isolated one billed acceptance; authenticated task recovery restored the original completed task without a paid replay. Only proven no-acceptance slot 08 was resubmitted, completed, and the product advanced to 20/20 images and real Doudian publishing | Controller `20260921-102201`; slot 09 recovered at `02:22:19Z`; slot 08 completed and publishing target 1 started at `02:25:00Z` | verified |

## 2026-09-21 Stale same-batch Feishu prompt-cache recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain why the new batch stopped although the visible Feishu cell was complete | The cache locked after the previous batch contained a 596-character, four-paragraph intermediate value for record `recvvLMnjceYG3`. The supervisor then prematurely added `--skip-feishu-assets-refresh` without online identity evidence, so continuation repeatedly consumed that stale cache instead of comparing and refreshing mutable fields from the still-identical online batch | Locked batch `6608b189a23cae97b22650ce`; controller `20260921-102201`; stale cache preflight failure | verified |
| Make future truncation diagnostics actionable | When no parser strategy reaches the required count, `parseFeishuPosterPrompts` now reports the longest actual candidate count instead of replacing it with an empty list | Regression asserts a four-paragraph source reports `got 4`; full `rules:check` | verified |
| Let the safe layer decide whether same-batch mutable fields may refresh | The supervisor skips fetching only for a newly promoted batch that was already refreshed. Initial and same-batch continuation now reach the child, which first compares online and locked identity and refreshes only when they match; a changed batch remains locked out | Pure continuation-rule regressions plus supervisor source-boundary regression | verified |
| Avoid confusing API order with visible Feishu row numbers | Prompt preflight identifies failures as `cache item N` together with immutable `recordId` and product name; it no longer labels API array order as `row N` | Batch-preflight regression | verified |
| Preserve completed work while source provenance is reconciled | The resumed run was safely paused during product 1 after 6/20 confirmed publishes, before product 5 could consume the reconstructed prompt. Existing canonical publish checkpoints remain resumable | Controller `auto-listing-controller-20260921-150514.log`; pause acknowledgement | verified |
| Resume only with an explicit decision on the current online prompt | After the reconstructed-value limitation was disclosed, the user explicitly instructed the project to continue. A fresh read-only Feishu dump proved the online and locked batch identities match, all 11 records contain at least five prompt paragraphs, and record `recvvLMnjceYG3` exactly matches the current cache | User continuation instruction; fingerprint `6608b189a23cae97b22650ce`; controller `20260921-170142` resumed canonical target 08 after seven confirmed targets | verified |

## 2026-09-23 Reconciled 524 supervisor recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain why the project stopped with no unresolved paid submission | The image layer recovered both uncertain 524 acceptances through authenticated provider logs, but the supervisor still treated nested historical `did not return a proven task id` text as current ambiguity instead of honoring the final ledger state | Run `20260922-220703`; record `recvvXn6js0Lv0`; ledger summary `completed=2, submitted=1, failedBeforeAcceptance=17, ambiguous=0, reserved=0` | verified |
| Keep temporary provider outages self-driven after reconciliation | The image layer emits a machine-readable safe-ledger marker only when no ambiguous/reserved slot remains; the external-service classifier then uses the canonical three-minute wait without consuming normal recovery attempts | Supervisor and progress-state regressions | verified |
| Preserve fail-closed paid-submit safety | A raw HTTP 524 missing-task-id failure without the authoritative ledger marker remains non-retryable; true `ambiguous` or `reserved` ledger states still stop before any new paid POST | Negative regression plus paid-ledger and provider-log reconciliation suites | verified |

## 2026-09-24 Provider-log eventual-consistency recovery

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| Explain the stop without weakening paid safety | Slot 09 retained a canonical 524 response and correctly remained `ambiguous`; the token-log endpoint was readable but had no unique acceptance/no-acceptance entry during the bounded lookup, which the supervisor previously treated as terminal | Run `20260923-232907`; batch `3ac63a97d8b4194e5542f783`; record `recvvXoO2JcH3Q`; ledger `completed=8, failedBeforeAcceptance=11, ambiguous=1, reserved=0` | verified |
| Keep inconclusive provider evidence project-owned | Reconciliation emits `provider_log_outcome_pending`; the supervisor preserves the locked batch, waits three minutes, and reruns read-only reconciliation without consuming the normal recovery budget | Progress-state and reconciliation regressions | verified |
| Prevent duplicate paid generation while waiting | The ambiguous slot remains non-replayable and every continuation starts with strict provider-log reconciliation; only a unique billed task recovery or unique zero-billed gateway log can mutate its state | Paid-ledger safety block and exact one-to-one reconciliation contracts | verified |
| Keep read-only shop identity verification compatible with current Doudian header metadata | Shop-access audit strips only the known trailing account-type and `正常营业` metadata before exact comparison; misleading prefixes and different shop names still fail closed | Negative/positive rule regressions; live 20/20 shop-access audit `20260924-091006`, publish attempted=false, form mutation attempted=false | verified |
| Recover an accepted task when the provider omits its token-log row | For one and only one ambiguous slot, the authenticated task-list fallback requires a complete unpaginated window whose known IDs exactly equal the ledger and whose sole extra task passes independent ID/model/time/status verification | Live window `1790180914..1790181170`: `page=1`, `page_size=100`, `total=9`, eight known IDs plus completed task `task_GGu...`; strict positive and fail-closed regressions | verified |
| Stop evidence waits from refreshing the locked batch | `provider_log_lookup_unavailable` and `provider_log_outcome_pending` recover in exact `resume` mode rather than `full`, so only the current main-image checkpoint and paid ledger are revisited | Supervisor recovery-mode regression | verified |

## 2026-09-27 Provider token-log non-JSON recovery

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Keep a transient HTML gateway page from terminating paid reconciliation | Token-log reads parse bounded response text explicitly; a non-JSON response is classified as temporary provider-log unavailability and remains inside the existing read-only retry/backoff path | Red-before-green parser regression using an HTML fixture; live controller failure `Unexpected token '<'` | verified |
| Preserve duplicate-charge safety | Non-JSON responses never mutate paid ledgers or authorize a POST; the ambiguous slot remains blocked until unique billing and task evidence reconciles it | Slot 16 retained canonical 524 evidence and no provider task ID | verified |
| Eliminate the isolated provider-login session | Authenticated task recovery now reuses the canonical project browser workspace, rotates the provider's short-lived access token through its same-origin refresh endpoint, and fails with an explicit login checkpoint only when the long-lived refresh session is genuinely unavailable | Live refresh returned 200; exact bounded task list returned two known tasks plus one unique successful slot-16 task | verified |
| Recover when the gateway creates no task and emits no zero-billed token log | A complete first task-list page may prove no acceptance only when pagination is consistent, every ledger-owned task in the bounded submission window is present exactly once, and the unknown task set is exactly empty; only then is the ambiguous fixed slot changed to retryable | Red-before-green zero-unknown task-list regression; live slot 19 returned the exact known set and zero unknown tasks across repeated authenticated reads | verified |

## 2026-09-28 Orphan product-list mask recovery

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Explain why target 7 stopped although the list screenshot was normal | Doudian briefly mounted a modal mask after its dialog had already detached; Playwright still counted the orphan full-page node as visible, so the exact-title verifier exhausted its overlay wait with `maskObserved=true; dialogs=none` | Run `20260927-161422`, target `...__image-002__07__07`, retained list-verification failure screenshot and controller log | verified |
| Remove the false blocker without accepting unknown dialogs | After the bounded wait, a mask with zero visible dialog wrappers proceeds to the existing strict locator actionability checks; any unknown visible dialog still fails closed with count/text diagnostics | Pure overlay-decision regression, source contract regression, targeted recovery suite | verified |
| Continue without replaying the irreversible submit | Live exact-title verification returned `共0条`; the retained result proved `规格值不能重复`, so target 7 became terminal skipped coverage and target 8 started without another target-7 publish click | Controller `20260928-151134`; manifest status `submit_rejected_exhausted`, error class `spec_value_duplicate_rejected` | verified |

## 2026-09-29 Structured provider-availability reconciliation

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Explain why image generation stopped at 4/20 | Fixed slot 03 received HTTP 503 with nested `fail_to_fetch_task`, whose innermost error was `system_unavailable`, retryable, and carried a unique client request ID. The paid ledger correctly stayed `ambiguous`, but reconciliation rejected the JSON before querying billing/tasks because it accepted only Cloudflare HTML | Batch `86c0348317936cdc45aebde5`, record `recvwqtfQPadLA`, canonical slot-03 evidence digest `565c2b4d...` | verified |
| Admit only the exact structured availability shape to read-only reconciliation | A pure bounded parser requires supported 5xx status, nested `fail_to_fetch_task`, exact `system_unavailable`/`category=system`, both retryable flags, and a valid `client_request_...` ID; malformed, non-retryable, client-error and unrelated JSON remain blocked | `isProviderAmbiguousAvailabilityResponse`; positive and negative reconciliation regressions | verified |
| Prove no acceptance before retrying | The authenticated complete task window contained exactly the one ledger-known task and zero unknown tasks, so slot 03 was durably changed to `failed_before_acceptance` before its fixed-slot retry was reserved | Controller `20260929-094408`; slot audit `automatic authenticated provider task-list no-acceptance proof; known_tasks=1` | verified |

## 2026-09-29 Feedback/appeal label and active-image status clarity

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Explain “反馈申诉” without treating it as a publish blocker | Live Doudian DOM contains only the right-side generic `反馈` widget (`浮窗反馈入口`) and no visible dialog; `申诉--葡萄籽维生素E软胶囊` is the exact Feishu `用户认知名` value, not an appeal action issued by automation | Read-only CDP DOM inspection; locked Feishu cache record `reczz28GyewIZxIh`; its publish manifest has 20/20 `published` entries | verified |
| Never automate a platform appeal | Category-misplacement handling recognizes the full informational warning, then permits only Escape or one unique close control; it never clicks `使用推荐类目`, `反馈` or `发起申诉` | `product-list-verification-action.ts`; category-warning selection regressions | verified |
| Stop active generation from looking stalled | Accepted paid tasks that are actively polled retain controller status `running`; only a real supervisor wait file or current retryable service failure reports `external_service_wait`. The accepted-task count and latest query heartbeat remain in the progress summary | `paid-image-wait-rules.ts`; supervised/direct status regressions; live product advanced from 0/20 to 20/20 and entered publish target 1 | verified |
| Keep internal workflow markers out of operator-facing product names | Status formatting strips only exact leading `申诉--` / `反馈--` workflow markers for display; raw Feishu fields, canonical record identity, source files, generated titles and publish metadata remain unchanged | `normalizeAutoListingControllerDisplayProductName`; positive marker and ordinary-name preservation regressions | verified |
| Prevent future feedback/appeal click regressions | The publish-browser regression suite scans every action source and rejects any direct click locator targeting `反馈`, `发起申诉` or `使用推荐类目` | `test-uncertain-publish-recovery.mjs` | verified |

## 2026-09-30 Terminal failed provider-task gap recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain the permanent image-service wait on 甘草片 slot 20 | The paid POST returned `HTTP 503 / fail_to_fetch_task`, so the ledger correctly retained ambiguity; token logs never emitted a matching billing or zero-billing row, while the authenticated bounded task list consistently contained exactly one unknown terminal failed task | Live ledger, bound gateway evidence and 98 supervisor reconciliation rounds | verified |
| Close a unique accepted-then-failed task without risking duplicate billing | A complete authenticated task-list window must exactly cover every known task plus one unknown terminal failed task; the task detail endpoint must independently confirm its ID, timestamp and failed status before the ledger records the original task as accepted-then-failed | Terminal task-gap rule and detail-validation regressions | verified |
| Continue only through fixed-slot recovery | The recovered provider task ID is written first, then the slot transitions to `failed_after_acceptance`; existing bounded fixed-slot recovery decides when the same slot may retry, while zero, multiple, invalid or nonterminal gaps remain fail-closed | Paid reconciliation suite; live 甘草片 continuation completed and advanced the batch from 6/17 to 7/17 | verified |

## 2026-09-30 Structured upstream-request failure reconciliation

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Avoid terminating the next product before safe reconciliation | The exact nested `HTTP 500 → fail_to_fetch_task → do_request_failed → do request failed: upstream error: do request failed` shape is classified as submission ambiguity, not as proof of acceptance or non-acceptance | Live slot-02 gateway evidence for record `reczz28GyewIa1X8`; strict positive regression | verified |
| Reject lookalike HTTP 500 responses | Admission requires the exact nested codes, exact message, null data fields and HTTP 500; changed codes, messages, data or unsupported statuses stay blocked | Negative parser regressions | verified |
| Preserve paid safety while resuming | The newly admitted response can only trigger read-only token-log and authenticated complete task-window reconciliation; a paid retry still requires durable proof of no acceptance or an explicit accepted-then-failed task | Full `rules:check`; live slot 02 received authenticated no-acceptance proof, transitioned to replayable, and only then reserved the same fixed slot | verified |

## 2026-09-30 Empty authenticated task-window reconciliation

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain the 44-round slot-05 wait | The authenticated bounded task lookup had no accepted ledger task inside the incident window, so the former common normalizer rejected the evidence before it could recognize a complete zero-task response | Live record `reczz28GyewIa1X8`, slot 05 ledger and controller events | verified |
| Prove no acceptance without inventing an anchor | No-acceptance reconciliation permits an empty known-task set only when pagination is complete and the returned bounded task window is also empty | Positive empty-window regression; live slot 05 proof persisted `known_tasks=0` before retry | verified |
| Keep non-empty unanchored windows fail-closed | Acceptance and terminal-task recovery still require a non-empty exact known-task set; no-acceptance recovery rejects any unknown task when the known set is empty | Negative unanchored-task regression | verified |

## 2026-10-20 Target-shop login recovery and bounded browser probe

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why shop 2 repeatedly returned to login after recovery was announced | The recovery probe validated whichever Doudian shop was currently active. Shop 1 remained authenticated, so its generic SPU page produced a false-positive recovery even though the unresolved manifest target was shop 2 | Controller `20261019-224503`: shop-2 login failures at `15:04:29Z` and `15:12:44Z`, with a false recovery announcement between them; target submit state remained `not_attempted` | verified |
| Bind recovery to the canonical unresolved target | The supervisor resolves the latest unresolved manifest entry inside the locked batch and passes its exact `shopFolder`; the read-only probe must switch to that shop and revalidate the full platform-SPU page before resuming | `test-doudian-publish-session-preflight-rule.mjs`; live continuation entered `02延草纲目药品专营店` and resumed target 2 without replaying target 1 | verified |
| Prevent a browser Promise from holding the profile lease forever | The complete session probe has a hard timeout, always disconnects CDP in `finally`, and refreshes the login-wait heartbeat every ten seconds while the probe is running | Old PID `40494` retained `doudian-browser-owner.json` after its heartbeat stopped; hard-timeout, heartbeat, CDP-recovery and profile-lease regressions pass | verified |
| Continue the exact batch without refreshing Feishu or redoing paid work | The standard continue entrypoint recycled the inert supervisor and launched an exact manifest-backed `published`-stage resume for batch `4d84efb5d2430583950b3ffc` | Controller `20261020-133939`; Feishu remains `12/14`; runtime remains `20261019-225603`; shop 2 reached `publish_signal_confirmed` and the live flow advanced through shop 3 to shop 4 | verified, flow running |

## 2026-10-21 Completed-batch handoff race recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why the new 11-product batch stopped before doing work | The prior `092ea62d747f` batch completed 6/6 and the supervisor validly refreshed Feishu to `60a8f93bc268`; a concurrent status read observed the canonical-cache swap before controller ownership moved, misclassified that intentional handoff as external batch drift, and wrote `pause.requested` | Controller `20261020-174250`; pause timestamp `2026-10-20T18:06:51.083Z`; new run `20261021-020655` stopped at login preflight only because it consumed that signal | verified |
| Close both sides of the handoff race without weakening fail-closed protection | The supervisor writes a bounded same-PID old/new transition marker around cache activation and updates controller ownership before removing it; status also treats the live controller's current-batch ownership as authoritative while suppressing stale prior-run evidence | `controller-job-ownership-rules.ts`, `auto-listing-supervisor.ts`, `auto-listing-controller-status.ts` | verified |
| Reject forged or stale transitions | Suppression requires a running controller, matching supervisor PID, exact old/new fingerprints, and a marker no older than 60 seconds; missing, foreign, wrong-target, stale, or ordinary external cache changes still write the batch-mismatch pause | Red-before-green `test-controller-terminal-cleanup.mjs`; full `rules:check` | verified |

## 2026-10-24 Proxy/TUN provider reachability recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain the repeated apparent stall without blaming Doudian | Doudian login preflight remained healthy; all 20 paid-image slots were durably `failed_before_acceptance` after the first `fetch failed` opened the pre-submit circuit. The host uses Fake-IP/TUN resolution (`zexapi.com -> 198.18.0.6`) while the macOS system-proxy dictionary is empty; the same Node runtime returned HTTP 404 to a read-only endpoint probe after the network path recovered | Controller `20261023-145136`, runs `20261024-204101` and `20261024-204413`, live DNS/curl/Node probe | verified |
| Resume promptly after a proven zero-acceptance outage | Only an exact safe ledger summary (`ambiguous=0`, `reserved=0`, `submitted=0`) plus a main-image transport failure enables a bounded read-only HEAD probe every 10 seconds; any HTTP response proves reachability and resumes the locked batch immediately instead of blindly sleeping three minutes | `external-service-recovery-rules.ts`, `auto-listing-supervisor.ts`, progress-state regression | verified |
| Preserve duplicate-charge protection | Accepted tasks, ambiguous/reserved slots, and provider-log reconciliation waits cannot enter endpoint-probe relaunch; their existing exact-task or reconciliation recovery remains unchanged | Negative regression covering accepted, ambiguous, and reconciliation-only states | verified |
| Make the next outage diagnosable | Provider transport exceptions retain the nested cause code and message, such as `ENOTFOUND`, rather than collapsing every proxy/DNS/socket failure to bare `fetch failed` | `formatImageGenerationTransportError`; formatter regression | verified |

## 2026-10-25 Feishu empty-placeholder batch handoff recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why listing appeared stuck after the prior batch completed | The prior four-product batch completed all publish targets. The next refresh stopped fail-closed because Feishu record `reczz28RG64vrshr` contained only empty-object cells for `保质期` and `储藏条件`; normalization incorrectly defaulted its missing category to `医疗器械`, so the placeholder was treated as an invalid product | Completed controller log `auto-listing-controller-20261024-210224.log`; preserved refresh candidate; live read-only Feishu query | verified |
| Skip true placeholders without weakening product validation | Feishu normalization now leaves a missing source category undefined. A row whose source cells have no business content is classified as empty even when Feishu serializes empty cells as `{}`; any partially filled record without `产品类目` remains invalid and fail-closed | Red-before-green source-field regressions covering empty-object cells and a partial category-less product | verified |
| Unblock the next real batch | The live read-only query now reports `ok=true`, `count=10`, `skippedEmptyCount=1`, `invalidRecords=[]`, with batch fingerprint `b7d3cb5a56d25215c7f5708d` | `feishu-bitable --mode records --limit 0` against the configured table | verified |

## 2026-11-19 Structured selling-point and framed-image flow recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Make a Feishu control command start work even if its acknowledgement cannot be delivered | The Hermes router creates the controller task before sending its acknowledgement, and every operator reply has a ten-second bound; a stalled adapter can no longer gate or cancel the business action | `test-hermes-auto-listing-command-router.py` includes a forever-hanging adapter; installed profile verification and live channel doctor pass | verified |
| Consume the structurally updated product-information headers exactly as they exist in Feishu | The canonical field map now reads `主图主标题`, `主图副标题`, and `主图卖点`; title/subtitle select one candidate each and selling points select three, then reconstruct the complete fixed-format product-selling-point text before DeepSeek | Full live read-only query reports 11 valid records, no invalid records, schema/field-map version 5, batch fingerprint `58b15a92cc54728f5ee75a9f`; source/config rule regressions pass | verified |
| Preserve the fixed frame without modifying it or allowing generated content to cover it | Provider transport now handles only the two generation references; the fixed frame is applied only after the generated output exists and has been normalized to 800×800 | Frame rule regression; all 20 generated target images match every one of the reference frame's 67,254 opaque pixels | verified |
| Continue the same paid batch without refreshing Feishu or replaying completed work | The standard continue entrypoint resumed run `20261119-110859` on the same locked fingerprint; all 20 fixed slots completed, images were distributed, and the first Doudian target published successfully | Controller log `auto-listing-controller-20261119-111111.log`; live status advanced to target 2/20 | verified, flow running |

## 2026-11-19 Image-quality hold and post-generation frame composition

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Stop publishing while image quality is being corrected | The original operator pause prevented further publishing; after quality acceptance, incompatible run and ledger state was moved into a recoverable fresh-rerun archive | Pause evidence plus `fresh-rerun-2026-11-19T04-50-16-848Z-58b15a92cc54` | superseded safely |
| Give the model the real spatial relationship without allowing it to own the final frame pixels | Provider requests contain exactly one generated layout-guide reference combining the current white-background product and immutable frame; local post-processing overlays the source frame again and verifies its opaque pixels | `test-main-image-frame-rule.mjs` source contract | verified |
| Reserve composition space through adaptive full-canvas composition | `full-bleed-layout-guide-v2` tells the provider to redesign the complete poster around the occupied top-left region while keeping the canvas visually full; it does not reserve an empty outer margin | Accepted quality test `ad846d1c103544e1f12e3021` | verified |
| Keep a reviewable provider result without shrinking the poster | The 800×800 provider output is preserved as `.unframed.png`; frame-ready processing keeps every provider pixel unchanged, then overlays and protects the immutable frame | Frame-ready/unframed pixel-equality regression; legacy `safe-inset-v1` is rejected | verified |

## 2026-11-19 Canonical raw-image archive recovery

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Explain why cleanup stopped after all 20 shops had published | Every slot correctly contained one canonical `generated-NN.png` plus `.frame-ready.png` and `.unframed.png` process derivatives. The recursive recovery predicate matched every basename beginning with `generated-NN`, so it counted 60 files instead of the required 20 | Run `20261119-152843`; publish manifest 20/20 `published`; archive guard `expected 20 ... got 60`; filesystem classification 20 canonical + 40 derivatives | verified |
| Archive only the durable unwatermarked main-image contract | Recursive recovery now requires the complete basename `generated-<digits>.(png|jpg|jpeg|webp)` and explicitly excludes suffix-bearing frame intermediates and backups | Red-before-green archive regression reports 15 rather than 45 for an incomplete fixture and archives exactly 20 canonical files for a complete fixture | verified |
| Resume without replaying already published shops | The failure remains at the `cleaned` boundary; canonical publish manifest coverage stays 20/20 and the standard locked-batch continuation resumes cleanup rather than generation or publication | Resume started with `startStep=cleaned`; run `20261119-152843` completed immediately, archived exactly 20 files under `202611191813SNIME头部皮炎护理乳`, advanced the processed batch from 0/11 to 1/11, removed the old run, and began product 2 without replaying product 1 publication | verified |
