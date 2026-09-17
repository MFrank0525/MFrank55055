# Billed Task-ID Recovery Root-Cause Audit

## Incident

The locked Feishu batch stopped on product 17/21 with 16/20 main-image slots complete. Slots 3, 4, 18 and 20 stored genuine Cloudflare 524 submit responses and therefore correctly refused automatic paid replay.

## Root Cause

The provider accepted and billed all four missing submissions but the gateway response omitted their public task IDs. The token-log endpoint later exposed four billed task records with request and upstream request IDs. The prior billed-acceptance matcher evaluated those records together with the 16 billing records already represented by completed slots, so its cardinality safety check rejected the whole set as non-unique and status fell back to a generic ambiguous message.

## Systemic Fix

Reconciliation now proves and removes known completed billing records first. Every exclusion requires the same model, positive quota, task semantics, request IDs, and a five-second one-to-one match with a completed slot's persisted `submitted` timestamp. Only the remaining set may be matched against gateway-blocked slots. Missing, extra, overlapping or malformed evidence remains fail-closed.

This identifies slots 3, 4, 18 and 20 as accepted and billed without weakening the no-replay rule. Their exact provider request IDs are retained in the diagnostic output. The authenticated provider task log then supplied the corresponding public `task_...` IDs, and the existing reconciliation command verified each task before polling resumed.

A second recovery defect was found before ledger mutation: task creation-time validation used the slot's batch reservation `createdAt`. Because the provider submissions are serial, later slots can be created more than ten minutes after reservation and be falsely rejected. The validator now uses the persisted submit-response `updatedAt`, while retaining the bounded time, task ID, status and model checks.

## Verification

- Targeted matcher regression passes.
- Live provider token-log matching identifies exactly four residual billed acceptances.
- No paid POST was sent during diagnosis or repair.
- The authenticated supplier task log resolved all four public task IDs as `SUCCESS`.
- The formal reconciliation command validated and restored slots 3, 4, 18 and 20 to `submitted` without sending a paid POST.
- Continuation polled and materialized the original four successful tasks, bringing the ledger to 20/20 completed and resuming Doudian publication.
- Build, the full rule suite, all doctor modes, representative simulation and two deep-audit snapshots pass.
