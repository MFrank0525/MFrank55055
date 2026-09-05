# Title-optimization advisory root-cause audit — 2026-09-05

## Incident

Run `20260904-234337` reached shop 20/20 for the current product and stopped during the fill-check stage. The visible dialog was `发布提醒 / 标题待优化`, with actions `去修改` and `返回确认`. The durable submit marker was still `not_attempted`.

## Root cause

Two visually related platform prompts occur at different boundaries. The post-submit path already recognizes `不修改，继续发布`, but the pre-submit fill-check path allowed `返回确认` only when the body contained `规格信息冲突`. It did not classify the platform's newer `标题待优化` wording, so it failed closed before clicking `发布商品`. Generic publish retry then rebuilt the complete form and encountered the same deterministic advisory again.

## Systemic correction

- One rule now classifies both known non-blocking fill-check advisories: `规格信息冲突` and `标题待优化`.
- Classification requires the exact dialog title `发布提醒` and the exact visible action `返回确认`; unrelated dialogs remain blocking.
- The action requires one unique visible semantic `返回确认` button and reads back that the dialog is hidden.
- No title field, title generator, product field, or form module is touched by this recovery.
- Only after the dialog is dismissed does the unchanged normal readiness gate lead to the original `发布商品` click. Any subsequent `不修改，继续发布` remains a post-submit confirmation and is handled inside the already-marked submit boundary.

## Continuation safety

The failed target is safe to resume from its canonical shop-20 identity because `publish-submit-attempt.json` records `not_attempted`. The previous 19 shop targets have confirmed manifest evidence and must not be replayed.
