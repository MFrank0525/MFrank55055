# Shop 17 platform system-rejection root fix

## Incident evidence

- Batch fingerprint: `d645bc3d9b407046e8d6ad19`
- Record/task: `recvrqjuolaXBp / image-003`
- Target: shop 17, watermark 17, `延草纲目美体器械专卖店`
- Before the click, every module and the publish check passed.
- After the click, Doudian kept the publish form open and displayed operation ID `2026080611514994A2BEE931106AF92453` followed by `系统异常,请重试`.
- The original immediate exact-full-title query returned `共0条` in the target shop's `全部` tab.
- A delayed read-only repeat at `2026-08-06T04:04:49Z` again returned `共0条`, proving the rejected request did not later create the product.

## Root cause

The post-submit poll dismissed transient overlays before reading the page, so Doudian's short-lived system-error toast disappeared and the stored issue fell back to unrelated static text such as `必填项进度100%`. Failure classification then resolved to `validation_blocked`. Even after the classifier and controlled-retry path were added, the old checkpoint remained uncertain because its persisted JSON no longer contained the toast visible in the screenshot. The safety layer correctly refused a blind replay, but the target consequently remained stopped despite conclusive absence checks.

## Permanent correction

1. An explicit `系统异常` combined with `请重试`, `稍后重试`, or `操作ID` is classified before generic form text as `final_publish_submit_transient`.
2. Both page and browser-context pollers now read the submission state before any overlay dismissal. A system rejection returns immediately with its operation ID, preserving the strongest evidence instead of overwriting it with static page copy.
3. Once the final click was attempted, this class is persisted as `submit_rejected_confirmed`, never sent through the generic retry loop.
4. The existing stable, target-shop, full-title `全部`-tab query remains mandatory. A found product becomes `list_verified`; only an explicit zero result permits one controlled rebuild and retry of the same canonical target.
5. The single retry ceiling remains unchanged. A second rejection, ambiguous list state, identity mismatch, or any unknown submit result fails closed and prevents later targets.

## Acceptance evidence

- Production-shaped error text first failed the regression as `validation_blocked`.
- After the correction it resolves to `final_publish_submit_transient` and `submit_rejected_confirmed`.
- Generic retry eligibility is false for this post-click class.
- The manifest-backed list verification path owns the only authorized retry.
