# Shop 11 Shipping Rejection Root Fix

## Requirement trace

| Requirement | Evidence | Implementation | Verification |
| --- | --- | --- | --- |
| Determine whether concurrent projects caused the stop. | The failed result contains a platform business rejection, `校验发货模式失败`, and no browser-close, CDP, lease, or port error. The listing, coupon, and link projects resolve separate absolute browser-profile directories and project-owned locks. Listing CDP additionally validates the listening PID's exact `--user-data-dir` before connecting or terminating it. | Preserve the existing project-local profile/lease ownership checks and test them in the full rule suite. | Browser profile lease, CDP probe/recovery, workspace provider, and controller isolation rules. |
| Make the platform form model persist shipping mode before final publish. | The screenshot shows `现货` and `48小时` selected, but the backend rejected shipping mode. Re-clicking an already selected radio can leave the React form model unchanged. | Near the final submit boundary, require an exact radio target, transition to a different option, transition back to the configured option, and pass two stable readbacks. | `scripts/test-service-fulfillment-rule.mjs` plus representative simulation. |
| Retry an explicit platform rejection without risking duplicate products. | The final click was issued, so a generic retry would cross a non-idempotent boundary. The platform explicitly rejected the request, but the result still requires an external negative check. | Classify the exact shipping rejection as `submit_rejected_confirmed`. Permit one controlled retry only after read-only `全部商品` exact-title verification returns no product. | `scripts/test-progress-state.mjs`; publish manifest/deep audit rules. |
| Do not let a permanent empty-list scroll spinner block a proven negative lookup. | The live query showed the exact title in the URL, `共0条`, and the visible empty state for 30 seconds, while a mounted `.ecom-g-spin-spinning` below the empty table remained visible. | Accept an exact zero-count plus visible empty state only after three consecutive structural snapshots; retain the no-loading requirement for positive row results and cap the preliminary `networkidle` wait at five seconds. | Live failure screenshot and `scripts/test-progress-state.mjs`. |
| Never replay a genuinely uncertain final submit. | A timeout, navigation race, or missing success signal does not prove rejection. | Keep `submit_accepted_unconfirmed` fail-closed; a negative list lookup alone still preserves uncertainty and stops the batch. | Existing final-submit uncertainty and no-replay tests. |

## Root cause

This stop was not caused by the coupon or link-modification project running concurrently. The browser session remained alive and the Doudian backend returned an explicit shipping-mode validation failure. The page visually showed the configured values because they were SPU-prefilled, but the automation's final reassertion clicked the already selected options. That can produce stable DOM readback without producing a value transition in the platform's internal form model, so the backend received an invalid or absent shipping-mode value.

## Recovery boundary

The existing shop-11 result is not discarded. Continue first performs the existing read-only exact-title product-list lookup. If the product exists, it records list-verified success and skips mutation. If no product exists and the prior response is the exact platform shipping rejection, it performs one controlled fresh publish attempt with forced shipping-radio transitions. Any other unresolved final-submit state remains blocked.

The first post-fix recovery exposed a second fail-closed issue before any republish: Doudian's empty product table keeps a scroll spinner mounted even after the exact query has settled to `共0条`. The verifier now distinguishes stable structural empty evidence from positive-row loading instead of treating that permanent spinner as unfinished network work.
