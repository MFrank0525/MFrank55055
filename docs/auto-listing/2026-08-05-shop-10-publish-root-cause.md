# Shop 10 publish root-cause audit

Date: 2026-08-05

## Incident

Target `090d6abc04bba3c3348a3289__recvrkk5zdVjRC__image-001__10__10` for `10延草纲目营养膳食专卖店` did not appear in Doudian after the final publish click.

The runtime recorded `publishClickAttempted=true`, `publishClicked=false`, and the platform error `校验发货模式失败`. A fresh read-only exact-title query in the target shop returned `共0条`, proving that the product was not persisted.

## Root causes

1. The shipping controls were visually selected, but the final service step used an `ensure` helper that returned immediately for an already-selected SPU-prefilled radio. It therefore did not emit an explicit click/change event near final submit. The screenshot showed `现货` and `48小时`, while the backend rejected the shipping mode, exposing a DOM-state versus platform-form-model gap.
2. Read-only product-list verification recognized only the `属性自动优化` overlay. A new `商品质量分优化预警` dialog blocked the exact-title query, converting a diagnosable non-publish into `needs_manual_review`.
3. An unresolved final-submit result did not always stop later shop targets. A `needs_manual_review` entry classified as `validation_blocked` could continue until the generic two-failure circuit opened.
4. The old recovery path allowed one automatic replay after a negative list lookup. This crossed a non-idempotent boundary and contradicted the project recovery contract.

## Permanent controls

- Re-click the exact `现货` and `48小时` radios during the final service step and require two consecutive selected-state readbacks. Failure blocks before the publish click.
- Dismiss `商品质量分优化预警` only through the unique `知道了` button and verify that the dialog becomes hidden.
- Never replay a publish merely because a post-submit exact-title query returns zero rows.
- Stop the batch immediately for `not_checked`, `submit_accepted_unconfirmed`, or `needs_manual_review`; later shops cannot continue past unresolved final-submit state.
- Resume first performs read-only reconciliation of existing uncertain targets. It may mark an exact-title match `list_verified`; otherwise it stops without another publish mutation.

## Evidence

- Original publish result: `data/auto-listing/runs/20260805-110349/publish/090d6abc04bba3c3348a3289__recvrkk5zdVjRC__image-001__10__10/result.json`
- Original verification screenshot: `screenshots/doudian-list-verification-failed-10延草纲目营养膳食专卖店.png`
- Fresh read-only verification: target shop matched, exact title query settled, `共0条`, no matching row.
