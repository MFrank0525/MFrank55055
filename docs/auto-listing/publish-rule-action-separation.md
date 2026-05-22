# Publish Rule And Action Separation

## Goal

Browser automation actions and business rules must be stored separately.

The action layer may click, type, upload, read page text, take screenshots, and return structured action results. It must not decide long-term business meaning beyond whether the browser action itself ran.

The rule layer decides whether the observed state satisfies publish requirements, such as submission success, blocking validation, forbidden image slots, title format, shop match, and duplicate-publish protection.

## Current Split

- Action implementation: `src/business/publish-from-spu.ts`
- Shared action result structure: `src/business/publish-from-spu/publish-actions.ts`
- Rule implementation: `src/business/publish-from-spu/publish-rules.ts`
- Rule constants that are configuration-like: `src/business/publish-from-spu/constants.ts`

## Required Practice

1. When a Doudian page changes, update rule functions first if the meaning changed.
2. Update browser actions only when selectors, clicking, uploads, or navigation behavior changed.
3. Do not bury rule text inside `page.evaluate` blocks.
4. A publish submit can only be considered successful when a rule function returns success.
5. If the publish button was clicked and Doudian returns to a fresh empty `/ffa/g/create` page, treat that as submitted only through the publish submission rule.
6. If the publish button was not clicked, a fresh empty create page must not be treated as submitted.
7. All resume jobs must narrow `resumeProductFolderNames` to the intended remaining product folders.

## Expansion Plan

Move these next, in order:

1. Forbidden image slot rules for `主图3:4` and `白底图`.
2. Detail image completion rules for `从主图填入` plus Feishu qualification images.
3. Price and inventory verification rules.
4. Freight template and service fulfillment rules.
5. Shop context and SPU match rules.
