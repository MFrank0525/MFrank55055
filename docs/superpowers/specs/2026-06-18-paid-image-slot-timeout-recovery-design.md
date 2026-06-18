# Paid Image Slot Timeout Recovery Design

## Context

During the incident, the current Feishu product had 19 of 20 paid image slots completed. Slot 17 repeatedly reached the provider, remained accepted for about 15 minutes, and then failed with the same upstream timeout. The existing slot circuit opened for 30 minutes, but the supervisor woke on a generic 10-minute schedule. The controller also preferred stale image progress over the active external-service wait summary, so a self-driven cooldown appeared stalled. Slot 17 later completed through the existing recovery path; this change must not alter that path's prompt behavior.

No secondary image provider is currently configured. The design must therefore improve recovery within the existing provider without claiming that an external outage can be eliminated.

## Goals

- Preserve and reuse all verified completed slots.
- Prevent duplicate or ambiguous paid submissions.
- Schedule recovery at the exact slot cooldown boundary.
- Make cooldown and automatic retry timing visible in project status.
- Keep the supervisor alive and self-driven while the current Feishu batch remains pending.

## Non-goals

- Adding or configuring a second paid image provider.
- Re-generating completed slots.
- Adding any new prompt fallback or changing existing prompt content.
- Weakening the product-reference, packaging-consistency, or required-information rules.
- Treating an uncertain submission result as safe to resubmit.

## Rule-layer Design

### Exact retry deadline

Circuit errors must carry a machine-readable retry delay. The supervisor recovery-delay rule will extract that delay and use the greater of the slot delay and the normal external-service backoff. Delays from one second through six hours are accepted; malformed or out-of-range values are ignored in favor of the normal backoff. A valid active slot cooldown is never shortened.

### Prompt and ledger invariance

This change does not add a prompt recovery stage and does not modify prompt construction, request digests, or slot retry eligibility. Existing paid-slot ledger rules remain authoritative. The scheduling layer only honors a cooldown that the image action has already calculated.

### Safety invariants

- Completed slots are immutable and must pass file/digest verification before reuse.
- `reserved`, `submitted`, or `ambiguous` slots block new paid submission until reconciled.
- Provider task IDs must remain unique across active slots.
- Existing retry eligibility remains unchanged; scheduling must not create a new retry path.
- Transport uncertainty or unknown submission outcome never permits automatic resubmission.

## Action-layer Design

### Image generation

The image action keeps its current prompt and ledger behavior. When an existing cooldown remains, its circuit error continues to carry the exact retry delay without calling the provider.

### Supervisor

The supervisor parses the exact retry delay from the child failure, writes that deadline to `auto-listing-wait.json`, sleeps until the deadline, and then resumes from the same locked Feishu batch and paid-image ledger. It does not run generic 10-minute wakeups inside a longer slot cooldown.

### Status

While `external_service_wait` is active, compact status prioritizes the wait summary over stale image progress and reports:

- completed main-image count;
- blocked fixed slot;
- cooldown reason;
- exact next automatic retry time.

## Verification

### Focused regression tests

- Slot retry delay overrides the generic 10-minute wait.
- Malformed retry-delay text falls back safely.
- Compact status shows the active wait deadline instead of stale progress.
- Existing uncertain-submission and ambiguous-ledger safety tests remain green.

### Deep audit pass 1

- Run build, full rule closure, project doctors, and project audit.
- Read all 20 slot files directly.
- Verify completed result files against stored SHA-256 digests.
- Check slot-state counts, provider-task-ID uniqueness, and absence of ambiguous/reserved states.
- Verify only the incomplete slot is eligible for the next action.

### Deep audit pass 2

- Re-read all artifacts independently after the first pass.
- Confirm the ledger did not mutate during audit.
- Re-run the focused tests and project audit.
- Check Git diff/staging boundaries and confirm no runtime data, credentials, attachments, or generated images are staged.

## Delivery and Resume

After both audit passes succeed, commit and push only code, tests, and rule documentation. Do not restart or interrupt an active publishing flow solely to load this observability change. Verify exact scheduling and countdown behavior through focused regression tests; the next natural supervisor start will load the change.
