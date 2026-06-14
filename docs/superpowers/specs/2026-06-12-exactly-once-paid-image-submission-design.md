# Exactly-Once Paid Image Submission Design

## Goal

Keep the current `videos-base64` efficiency target: submit all 20 image-generation tasks for one product concurrently.

Prevent duplicate paid submissions across:

- failures inside one child process;
- supervisor recovery;
- child-process restarts;
- creation of a new runtime directory;
- repeated Hermes start commands;
- process termination between provider acceptance and local artifact completion.

The required safety invariant is:

> For one Feishu batch, one product record, and one image slot, automation may acquire paid-submit permission at most once. After that, automation may only resume polling or reuse a completed result. An uncertain submission must pause instead of being automatically submitted again.

## Scope

This design applies only to asynchronous `videos-base64` paid image generation.

Other providers retain their current serial or provider-specific behavior. Historical completed products and later Feishu batches must not reuse results from an earlier batch.

## Identity

Each paid image slot receives a stable identity independent of `runtimeDir`:

```text
batchFingerprint + recordId + imageSlot
```

- `batchFingerprint` separates later Feishu batches, including batches containing the same product.
- `recordId` identifies the product row inside the batch.
- `imageSlot` is the stable absolute output slot, `01` through `20`.

The ledger also records source-image identity and prompt identity for validation, but they do not replace the primary identity.

If `batchFingerprint` or `recordId` is unavailable, paid `videos-base64` submission must stop before creating provider tasks.

## Persistent Ledger

The paid-submission ledger lives outside individual runtime directories:

```text
data/auto-listing/paid-image-submissions/<batchFingerprint>/<recordId>/
  product.json
  slots/
    01.json
    ...
    20.json
  results/
    01.png
    ...
    20.png
```

`product.json` records the expected slot count, product identity, provider endpoint identity, model, source-image digest, and timestamps.

Each slot file records:

- stable identity;
- state;
- provider task ID when known;
- request digest;
- prompt digest;
- source-image digest;
- submit-attempt timestamp;
- provider response summary;
- result path and digest when complete;
- originating run and task IDs for audit only.

Secrets, authorization headers, and Base64 image payloads must never be written to the ledger.

## Slot State Machine

Allowed states:

```text
reserved
submitted
completed
failed_before_acceptance
ambiguous
```

Transitions:

```text
missing -> reserved
reserved -> submitted
reserved -> failed_before_acceptance
reserved -> ambiguous
ambiguous(no task id, no provider response, submit transport failure) -> failed_before_acceptance
submitted -> completed
submitted -> ambiguous
```

Terminal automatic behavior:

- `completed`: reuse the validated result.
- `submitted`: poll the same provider task ID; never submit again.
- `reserved`: treat as uncertain after owner-process loss; never automatically submit again.
- `ambiguous`: pause and require explicit reconciliation when the slot has a provider task ID, a provider response summary, or any other evidence that the provider may have accepted or charged the request.
- no-task submit transport `ambiguous`: if there is no task ID, no provider response summary, and the reason is a submit-stage transport failure such as `fetch failed`, connection failure, DNS/proxy failure, hard request deadline, or abort, automatically record no-acceptance evidence and retry the same fixed slot.
- `failed_before_acceptance`: a new submission may occur only when the provider explicitly proved that no paid task was accepted or when the project has no provider task/response evidence because the submit transport failed before any acceptance response.

No automatic transition may delete a slot record or return it to `missing`.

## Atomic Reservation

Before concurrent provider calls begin, the process initializes and validates the product ledger.

Each of the 20 workers atomically creates its slot file using exclusive file creation. Only the worker that successfully creates the missing slot receives permission to submit.

If the slot already exists, the worker follows its recorded state:

- poll `submitted`;
- reuse `completed`;
- stop on `reserved` or true acceptance-risk `ambiguous`;
- auto-reconcile no-task submit transport `ambiguous` to `failed_before_acceptance`;
- retry only `failed_before_acceptance`.

The product-level ledger enforces the hard maximum of 20 distinct slot reservations. No execution path may submit an unrecognized slot or create a twenty-first paid task for the product identity.

## Concurrent Execution

All 20 slot workers may run concurrently after ledger validation.

Concurrency is retained for:

- atomic reservation;
- first paid submission;
- provider task polling;
- result download.

The implementation must use all-settled coordination so one worker failure does not allow the parent flow to exit while other paid workers continue without being observed. The product step succeeds only after all expected slots reach `completed`.

## Crash And Ambiguity Handling

There is an unavoidable crash window when the provider accepts a paid request but the local process has not yet persisted the provider task ID.

Without provider-supported idempotency, the safe response is:

- leave the slot as `reserved`, or atomically mark it `ambiguous`;
- stop automatic continuation for the product;
- never resubmit that slot automatically.

If the provider supports an `Idempotency-Key` or stable client request ID, the implementation sends a deterministic key derived from the stable slot identity. Provider idempotency is an additional defense; the local ledger remains mandatory.

Transport timeout, connection reset, invalid response JSON, process termination, or any other uncertain submit result becomes `ambiguous`.

Only an explicit provider rejection that proves the task was not accepted may become `failed_before_acceptance`.

## Runtime Integration

Runtime directories remain the execution and audit workspace. The shared ledger is the paid-submission authority.

On every run:

1. Resolve the stable batch and product identities.
2. Validate or initialize the shared product ledger.
3. For each slot, resolve ledger state before any provider submission.
4. Copy or link completed ledger results into the current runtime task directory.
5. Poll known submitted task IDs.
6. Submit only slots whose ledger state grants first-submit permission.
7. Persist completed results in the ledger before staging, watermarking, or publishing.

Supervisor recovery must classify `reserved` and `ambiguous` slots as a paid-submission safety pause, not as a retryable provider availability failure.

Hermes status must report completed, submitted, ambiguous, and blocked slot counts.

## Cleanup And Retention

Normal runtime cleanup must not delete the shared paid-submission ledger.

After the product is safely published and archived, its ledger remains as an audit record for the current Feishu batch. A later batch receives a different `batchFingerprint` and therefore a separate ledger.

Ledger removal is a maintenance action, not part of automatic product cleanup.

## Failure Behavior

The image-generation step stops before paid submission when:

- stable batch or product identity is missing;
- an existing ledger conflicts with the current product, source image, prompt, provider, or expected slot count;
- the ledger already contains an unknown or invalid slot;
- any slot is `reserved` without a live owner;
- any slot is `ambiguous`;
- the product has already acquired all 20 submit permissions and an execution path requests another submission.

Error messages must identify the affected slot and state without exposing secrets.

## Verification

Focused tests must prove:

1. Twenty missing slots can be reserved and submitted concurrently.
2. Two processes racing for the same slot produce one reservation winner.
3. A new runtime directory resumes `submitted` slots instead of submitting again.
4. A completed slot reuses its result.
5. A submit timeout becomes `ambiguous` and cannot be automatically retried.
6. A stale `reserved` slot blocks automatic submission.
7. An explicit pre-acceptance rejection may be retried.
8. A twenty-first submission is rejected.
9. A later Feishu batch receives a separate ledger.
10. Product, prompt, source-image, slot-count, and provider identity conflicts fail closed.
11. One concurrent worker failure is collected while the process observes all other workers settling.
12. Runtime cleanup preserves the ledger.

Full verification must include build, rule checks, doctors, and a simulated auto-listing flow.
