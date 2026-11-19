# Reconciled 524 supervisor stop

## Incident

Run `20260922-220703` stopped at `main_images_generated` for Feishu record `recvvXn6js0Lv0` after the provider returned Cloudflare HTTP 524 responses. The paid-image ledger retained 2 completed slots, 1 submitted task recovered from authenticated provider logs, 17 proven before-POST circuit failures, and no ambiguous or reserved slots.

## Root cause

The image layer safely reconciled the uncertain 524 responses, but the supervisor classified only the nested aggregate error text. The historical phrase `did not return a proven task id` therefore overrode the ledger's later authoritative result and converted a temporary provider outage into a terminal project failure.

## Permanent correction

- When a prompt round fails, the image layer now appends a machine-readable ledger summary only if `ambiguous=0` and `reserved=0`.
- The supervisor treats that marker as authoritative only when the same failure also contains an external-availability signal such as HTTP 524 or timeout.
- Raw 524 submit failures without the safe-ledger marker remain blocked, so unresolved paid submissions cannot be replayed.
- The existing completed files and recovered provider task IDs remain fixed-slot inputs on continuation; the Feishu batch is not refreshed or replaced.

## Regression evidence

`scripts/test-progress-state-part-3.mjs` covers both sides of the boundary: a reconciled 524 aggregate stays in the project-owned external-service wait, while the same raw missing-task-id failure without ledger proof remains non-retryable. Paid ledger, provider reconciliation, and videos-base64 provider regressions also pass.
