# Provider-log outcome pending recovery

## Incident

Run `20260923-232907` stopped at `main_images_generated` for Feishu record `recvvXoO2JcH3Q` after fixed slot 09 received a persisted Cloudflare HTTP 524 response without a public task ID. The ledger retained 8 completed slots, 11 proven before-POST circuit failures, 1 ambiguous slot, and 0 reserved slots.

## Root cause

Strict provider-log reconciliation correctly refused to replay slot 09, but after its bounded three-minute read-only lookup returned no unique billed or zero-billed match, it emitted an ordinary reconciliation error. The supervisor consequently treated provider-log eventual consistency as a terminal business failure instead of continuing project-owned evidence polling.

## Permanent correction

- A successful but inconclusive bounded provider-log lookup now emits `provider_log_outcome_pending`.
- The supervisor classifies both an unavailable log endpoint and a pending log outcome as external evidence availability states.
- These states preserve every ambiguous slot, consume no ordinary recovery attempts, wait three minutes, and rerun only the reconciliation preflight.
- No new paid POST is allowed until strict one-to-one billed acceptance or zero-billed no-acceptance evidence resolves the slot.

## Regression evidence

The progress-state suite proves that `provider_log_outcome_pending` remains recoverable after the normal retry budget is exhausted, uses the canonical external-service delay, and does not consume recovery attempts. The reconciliation source contract proves that successful but inconclusive reads emit the durable marker rather than terminally stopping the batch.

The required read-only Doudian audit also exposed a new header rendering that appends account type and `正常营业` to the exact shop name. Audit normalization now removes only that known trailing metadata and still rejects arbitrary prefixes or different shop names. A fresh live audit verified all 20 shops with no publish or form mutation.

## Deeper provider evidence discovered after prolonged waiting

After 74 safe wait cycles, the token log still had no unique record. An authenticated, read-only provider task-list query over slot 09's bounded submission window returned a complete unpaginated set (`page=1`, `page_size=100`, `total=9`): all eight task IDs already owned by the ledger plus exactly one unknown `gpt-image-2` task. The task API independently verified that unique task as `completed`, created 43 seconds after the persisted 524 response. The provider therefore accepted the request but omitted the corresponding token-log evidence.

The automatic reconciliation fallback now requires that same exact-set proof before restoring the task ID. Any incomplete page, missing known task, multiple unknown tasks, failed task, time-window violation, or model mismatch remains blocked. Provider-evidence retries also use the exact resume checkpoint so the locked Feishu batch is no longer refreshed on every wait cycle.
