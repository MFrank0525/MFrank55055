# Paid Image Slot Timeout Recovery Design

## Context

The current Feishu product has 19 of 20 paid image slots completed. Slot 17 repeatedly reaches the provider, remains accepted for about 15 minutes, and then fails with the same upstream timeout. The existing slot circuit opens for 30 minutes, but the supervisor wakes on a generic 10-minute schedule. The controller also prefers stale image progress over the active external-service wait summary, so a self-driven cooldown appears stalled.

No secondary image provider is currently configured. The design must therefore improve recovery within the existing provider without claiming that an external outage can be eliminated.

## Goals

- Preserve and reuse all verified completed slots.
- Prevent duplicate or ambiguous paid submissions.
- Schedule recovery at the exact slot cooldown boundary.
- Make cooldown and automatic retry timing visible in project status.
- Give one bounded, safer prompt fallback a chance before entering long provider cooldown.
- Keep the supervisor alive and self-driven while the current Feishu batch remains pending.

## Non-goals

- Adding or configuring a second paid image provider.
- Re-generating completed slots.
- Weakening the product-reference, packaging-consistency, or required-information rules.
- Treating an uncertain submission result as safe to resubmit.

## Rule-layer Design

### Exact retry deadline

Circuit errors must carry a machine-readable retry delay. The supervisor recovery-delay rule will extract that delay and use the greater of the slot delay and the normal external-service backoff. Delays from one second through six hours are accepted; malformed or out-of-range values are ignored in favor of the normal backoff. A valid active slot cooldown is never shortened.

### Bounded prompt recovery ladder

Each fixed slot follows this identity-preserving sequence:

1. Original curated prompt.
2. Existing policy-compatible/stability prompt after the configured repeated-timeout threshold.
3. One ultra-stable prompt after the stability prompt itself receives an accepted-task timeout.
4. Slot-level long cooldown after an ultra-stable timeout.

The ultra-stable prompt remains an image-edit request using the original Feishu white-background image. It must retain the product subject, packaging, title identity, necessary use-part/use-step information, and per-slot visual variation. It removes decorative complexity, dense badges, and optional scene instructions only.

Every allowed prompt transition is explicit in the paid-slot ledger audit. Prompt and request digest changes are allowed only for that failed fixed slot and only for a recognized recovery-stage transition.

### Long cooldown and probing

After the ultra-stable prompt times out, the slot enters a 60-minute provider cooldown. The supervisor performs one probe after the deadline. Further identical accepted-task timeouts reopen the 60-minute cooldown; they do not trigger immediate resubmission or consume the generic supervisor recovery budget.

### Safety invariants

- Completed slots are immutable and must pass file/digest verification before reuse.
- `reserved`, `submitted`, or `ambiguous` slots block new paid submission until reconciled.
- Provider task IDs must remain unique across active slots.
- Only explicit provider failure after acceptance permits the bounded retry ladder.
- Transport uncertainty or unknown submission outcome never permits automatic resubmission.

## Action-layer Design

### Image generation

The image action resolves the recovery stage from the slot audit and recorded prompt digest. It generates the matching prompt, authorizes only the required digest transition, and writes the recovery stage into request/audit artifacts. If cooldown remains, it exits with the exact retry delay without calling the provider.

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
- Stability timeout selects the ultra-stable prompt exactly once.
- Ultra-stable timeout opens the long cooldown.
- Digest changes are authorized only for recognized recovery transitions.
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

After both audit passes succeed, commit and push only code, tests, and rule documentation. Start through `npm run auto-listing:hermes-start`. Verify that the controller resumes the locked batch, reports 19/20, and either submits only slot 17 at its valid deadline or remains in a clearly reported exact cooldown without touching completed slots.
