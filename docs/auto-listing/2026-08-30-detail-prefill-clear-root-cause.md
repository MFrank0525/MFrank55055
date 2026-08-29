# Detail-prefill clearing root-cause audit — 2026-08-30

## Incident

- Batch: `44e58e4a27bad95d6bd9c70d`
- Run: `20260829-231740`
- Product record: `recvtvBqB6ID3M`
- Failed target: `44e58e4a27bad95d6bd9c70d__recvtvBqB6ID3M__image-002__04__04`
- Shop: `04延草纲目康复理疗专营店`
- Terminal evidence: `Detail image prefill clear was not confirmed by DOM readback. remaining=1`
- Submit evidence: `publish-submit-attempt.json` is `not_attempted`; resuming this target cannot duplicate an external publish.

## Root cause

The exact `商品详情` deletion action was incorrectly gated by a heuristic screen-rectangle scan. When the platform indicator reported one remaining detail image but the layout heuristic returned no preview rectangle, the loop stopped before it attempted the structurally scoped delete control. After a click, the flow also used one fixed delay instead of waiting for the authoritative DOM count to decrease. The delete-control selector recognized only the historical `iconDelete` class.

These were three coupled assumptions in the core clearing state machine, not an isolated bad product or login failure.

## Permanent contract

1. The exact `商品详情` field owns detail-image deletion; heuristic rectangles never authorize or block it.
2. The last sortable preview is the structural target.
3. Delete controls may be identified by the platform class or accessible `删除` label/title, but the visible target must be unique inside that preview.
4. Every deletion waits for a bounded authoritative count decrease.
5. Uploading project detail images remains blocked until the final DOM readback is exactly zero.
6. Final publish uncertainty remains non-idempotent; no automatic resubmission is allowed after a submit attempt.

## Verification

- Red regression: `node scripts/test-graphic-prefill-clear-rule.mjs` failed against the prior implementation.
- Green regression, build, complete rule checks, doctors, and representative simulation passed fresh.
- The resumed live target produced the graphic-upload screenshot, safely published shop target 4, and advanced to target 5 without replaying targets 1–3.
- Two independent deep audits must pass before delivery.
