# Platform data-error refresh root-cause audit — 2026-09-04

## Incident

Run `20260904-110841` stopped on shop 01 while publishing the third Feishu product. The durable submit marker remained `not_attempted`, so no publish side effect had occurred.

## Root cause

The platform-SPU page and product-create page can render an explicit `数据异常请刷新重试` surface with a unique `立即刷新` action. Readiness correctly classified the surface as unavailable, but recovery only reloaded or revisited the URL. That bypassed the platform application's own state-reset action and repeatedly reconstructed the same unhealthy SPA state until both the child and supervisor recovery budgets were exhausted.

This was a recovery-state-machine defect, not a login failure and not a reason to restart the batch.

## Systemic correction

- Both SPU-page activation and create-page readiness use the same observable recovery contract: explicit error text, exactly one visible semantic button named `立即刷新`, click, then read back that the error surface disappeared.
- Recovery remains bounded. The SPU surface permits at most two action attempts; the create surface runs only within its existing bounded readiness loop.
- A missing, duplicated, hidden, or ineffective action never becomes a guessed click. The workflow falls back to its bounded navigation recovery and ultimately fails closed with evidence.
- No product fields or final-publish controls are touched until the normal readiness gate passes again.

## Regression and continuation safety

The source-contract regressions cover both entry points, while the existing readiness suites continue to enforce loading, blank-page, login, and pre-submit behavior. Continuation must reuse the locked manifest and existing run directory because the durable submit marker proves that this target is still before the publish boundary.
