# Publish Rule And Action Separation

## Goal

Browser automation actions and business rules must be stored separately.

The action layer may click, type, upload, read page text, take screenshots, and return structured action results. It must not decide long-term business meaning beyond whether the browser action itself ran.

The rule layer decides whether the observed state satisfies publish requirements, such as submission success, blocking validation, forbidden image slots, title format, shop match, and duplicate-publish protection.

## Current Split

- Action implementation: `src/business/publish-from-spu.ts`
- Health-food action implementation: `src/business/publish-from-spu/health-food-actions.ts`
- Shared action result structure: `src/business/publish-from-spu/publish-actions.ts`
- Rule implementation: `src/business/publish-from-spu/publish-rules.ts`
- Rule constants that are configuration-like: `src/business/publish-from-spu/constants.ts`
- Watermark-level run manifest: `src/autolist/publish-manifest.ts`

## Category-Specific Orchestration

`runPublishFlow` resolves the normalized product category once at the beginning of the flow, then orchestrates category-specific modules from that decision.

健康食品动作由 `src/business/publish-from-spu/health-food-actions.ts` 提供，`runPublishFlow` 只负责编排这些动作的顺序、读取 readback 结果并在失败时停止。医疗器械注册证动作只允许在医疗器械分支运行；健康食品的食品安全、类目属性、规格替换、外包装图和包装标签图动作只允许在保健食品分支运行。

## Runtime Records

Every publish run must write two structured files under the run runtime directory:

- `publish-plan.json`: the exact product folders that will be skipped or published before browser side effects begin.
- `publish-manifest.json`: one record per watermark product folder, including shop, watermark number, result file, status, final verification status, and error class.

These files are rules-facing records. Browser actions may produce raw screenshots and `result.json`, but resume decisions must use the plan and manifest rather than ad hoc folder guesses.

## Required Practice

1. When a Doudian page changes, update rule functions first if the meaning changed.
2. Update browser actions only when selectors, clicking, uploads, or navigation behavior changed.
3. Do not bury rule text inside `page.evaluate` blocks.
4. A publish submit can only be considered successful when a rule function returns success.
5. If the publish button was clicked and Doudian returns to a fresh empty `/ffa/g/create` page, treat that as submitted only through the publish submission rule.
6. If the publish button was not clicked, a fresh empty create page must not be treated as submitted.
7. All resume jobs must narrow `resumeProductFolderNames` to the intended remaining product folders.
8. A product folder may be skipped only when `publish-manifest.json` or a compatible `result.json` has a safe published decision from `publish-rules.ts`.
9. Failed entries must keep an `errorClass` so the next optimization can target the failure category instead of replaying the whole flow.
10. Doudian backend page readiness failures such as platform SPU query page still loading, browser context loss, or target page loss are retryable system failures. Store that classification in `publish-rules.ts`; action code may wait, reload, and retry, but it must not mark the product safely published.
11. Business validation failures such as missing required fields, image slot validation, shop mismatch, or SPU row mismatch are not retryable system failures unless a rule explicitly classifies them as such.

## Root Cause First

Do not add temporary patches that only bypass the current failed run. Every publish failure must be handled in this order:

1. Classify the failure category and root cause.
2. Decide whether the fix belongs to the rule layer, action layer, runtime state/resume layer, or input data layer.
3. Store the long-term rule in `publish-rules.ts`, step docs, or related rule docs.
4. Store browser implementation changes only in action code.
5. Add or update runtime records such as `publish-plan.json` and `publish-manifest.json` when the issue affects resume or duplicate-publish safety.

If a change cannot be explained as a root-cause fix, do not keep it.

## Current Rule Ownership

These rule decisions are owned by `src/business/publish-from-spu/publish-rules.ts`:

1. Forbidden image slot rules for `主图3:4` and `白底图`.
2. Detail image upload completion rules for `从主图填入` plus Feishu qualification images.
3. Price and inventory completion rules.
4. Freight template and service fulfillment state rules.
5. Shop context and SPU match readiness rules.
6. Retryable browser/system failure classification.

Health-food business decisions are owned by `src/business/publish-from-spu/health-food-rules.ts`. Health-food browser operations are owned by `src/business/publish-from-spu/health-food-actions.ts`.

## Remaining Refactor Backlog

Move these next, in order:

1. Extract generic Doudian browser action groups out of `src/business/publish-from-spu.ts` by module: shop/SPU page, basic info, graphic info, spec/price, service commitment, and final submit.
2. Keep rule classifications in `publish-rules.ts` and `health-food-rules.ts`; extracted action modules may return readback structures but must not decide business pass/fail meaning.
3. Add product-list verification rules when the 商品管理 list page is stable enough to query by title/SPU.
4. Replace regex-based source-structure tests with exported pure rule contracts where possible.
