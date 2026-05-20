---
name: douyin-auto-listing-project
description: Use when continuing the Douyin full-flow listing automation project in /Users/mfrank/MFrank55055, including Feishu product intake, image generation, title generation, Doudian publishing, category-specific rules, cleanup, and GitHub delivery.
---

# Douyin Auto Listing Project

## Project Root

Work in `/Users/mfrank/MFrank55055`.

The user may refer to this as `抖音全流程上架项目`, `抖音自动上架`, `飞书多维表格上架`, or `抖音商品上架项目`.

## Hard Boundaries

- Do not commit secrets, tokens, cookies, browser profiles, generated run data, or `input/feishu-bitable.config.json`.
- Treat `/Users/mfrank/Desktop/FFC的文件夹/工作/001电商/2026AI主图` as the preserved final-main-image archive root.
- Prefer fixing workflow rules in code and docs instead of relying on manual browser habits.
- If Doudian image upload fields are unreliable, keep the invariant: upload only required image slots, clear optional auto-filled white-background/3:4 slots when required by the current rule, and validate before moving to the next module.
- Avoid touching the Doudian AI assistant. If it opens, close it with the top-right close button before continuing.
- Keep only one active Doudian publishing page per shop/product flow. Close failed or stale publish tabs before opening replacements.

## Core Flow

1. Read products from Feishu Bitable in table order.
2. For each product, read required fields: `用户认知名`, `产品通用名称`, `品牌`, `SPU信息`, `产品卖点`, `导购短标题`, `资质图片`, `产品白底图`, `产品类目`.
3. Generate poster prompt Word files according to the category plan.
4. Generate unwatermarked main images from the Feishu white-background product image using the configured image edit provider.
5. Generate titles according to the category plan.
6. Distribute images and titles to the configured shop folders.
7. Publish to Doudian shop pages.
8. After each product finishes, archive only unwatermarked main images, then clean all intermediate generated files.
9. Continue with the next Feishu row until all products are processed, then stop.

## Category Plan

`医疗器械` is the default legacy flow.

| 产品类目 | 店铺范围 | Word 提示词 | 主图数量 | 标题数量 | 标题规则 |
| --- | --- | ---: | ---: | ---: | --- |
| 医疗器械 | 01/02/03/04/05 | 5 | 20 | 20 | 58 字，前缀三选一，后缀 `产品通用名称延草纲目` |
| 非处方药 | 03/04/05 | 3 | 12 | 12 | 58 字，前缀三选一，后缀仅 `产品通用名称` |
| 保健食品 | 01/02/03/04/05 | 5 | 20 | 20 | 28 字，取消固定前缀和固定后缀 |

If `产品类目` is empty, treat it as `医疗器械`. If it is not one of the three accepted values, fail fast and ask the user to fix Feishu data.

## Image Rules

- The image generation provider must use image edit when the configured gateway supports it.
- Product subject must come from the input white-background reference image.
- Product packaging, text, shape, count, and combination form must remain consistent with the reference image.
- Background, lighting, scene, title layout, and poster atmosphere may change.
- Do not filter or rewrite the curated prompt content except replacing structured variables such as `用户认知名` and `产品通用名称`.
- Do not render explanatory variable labels such as `用户认知名` or `产品通用名称` into the image.
- Negative wording such as “不要展示批文注册号” is an instruction, not text to render.
- Required visual content such as product use parts and use steps should be shown when the prompt asks for it.
- For every Word prompt document, generate 4 visually related but meaningfully different images.

## Doudian Image Upload Rules

- Prioritize required `1:1 主图` and auxiliary images.
- `3:4 主图` and `白底图` are not required in the current rule. If Doudian auto-fills them, clear them before continuing.
- 商品详情: click `从主图填入`, then upload Feishu `资质图片`.
- Do not repeatedly append detail images once the detail module has already been completed for the current product.
- Before final submit, validate that the white-background slot is empty. If not empty, clear it and validate again.

## Cleanup And Archive

After each product completes publishing:

- Preserve only unwatermarked main images.
- Copy preserved images into `/Users/mfrank/Desktop/FFC的文件夹/工作/001电商/2026AI主图/<yyyyMMddHHmm><用户认知名>/`; for example `202605201106宝元堂筋骨康凝胶`.
- Name preserved images with a clear no-watermark sequence such as `<用户认知名>无水印主图01.png`.
- Remove intermediate Word files, generated watermarked files, shop distribution folders, run publish artifacts, local Feishu attachment copies, temporary source images, and stale generated files.
- Do not delete the final archive folder.

## Useful Commands

```bash
npm run build
npm run doctor
npm run rules:check
npm run doctor:feishu
npm run doctor:auto-listing
npm run feishu:fields -- --config ./input/feishu-bitable.config.json
npm run feishu:assets -- --config ./input/feishu-bitable.config.json --out ./data/feishu/products.json
npm run business:auto-listing -- --job ./input/auto-listing.job.mac-feishu-flow.json
```

For real browser publishing, use:

```bash
npm run flow:mac-feishu:real
```

## Main Code Areas

- `src/autolist/orchestrator.ts`: full task chain.
- `src/autolist/product-category.ts`: category-specific shop/title/image counts.
- `src/autolist/jimeng-assets.ts`: image generation and shop-folder main-image output.
- `src/autolist/title-sheets.ts`: Doubao title prompt rules.
- `src/autolist/qualifications.ts`: Feishu qualification image attachment.
- `src/autolist/archive-main-images.ts`: no-watermark image archive.
- `src/autolist/cleanup.ts`: post-publish cleanup.
- `src/feishu/*`: Feishu Bitable config, records, and asset downloads.
- `src/business/publish-from-spu/*`: Doudian publishing automation.

## Troubleshooting Notes

- If Feishu reports missing wiki scopes even though the visible app has `wiki:wiki` or `wiki:wiki:readonly` enabled, check for machine-wide `FEISHU_APP_ID`/`FEISHU_APP_SECRET` pointing to a different app. This project should prefer `input/feishu-bitable.config.json` credentials over global env vars.
- In Hermes/agent shells on macOS, `python3` may resolve to the agent venv instead of `/usr/bin/python3`; the project expects the interpreter with Pillow installed for image processing.

## Verification Before Handoff

Run at least:

```bash
npm run build
npm run doctor
npm run rules:check
npm run doctor:feishu
npm run doctor:auto-listing
```

For workflow changes, also run the simulated flow:

```bash
npm run business:auto-listing -- --job ./input/auto-listing.job.mac-feishu-flow.json
```

Check `git status --short` and confirm no ignored secret/config/runtime files are staged before committing.
