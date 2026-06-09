# 自动上架脚本映射

本文档只描述“每一步由哪些脚本负责”，不写业务规则。业务规则统一写在 `steps/*.md`。

## 1. 调度入口

- CLI 入口：`src/cli/auto-listing.ts`
- 总调度：`src/autolist/orchestrator.ts`
- Job 解析：`src/autolist/config.ts`
- 状态机：`src/autolist/state-machine.ts`
- 类型定义：`src/autolist/types.ts`

## 2. 分步骤脚本映射

### `selling_points_loaded`

- `src/autolist/feishu-products.ts`

### `poster_prompts_generated`

- `src/autolist/deepseek-prompts.ts`
- `src/autolist/deepseek-word-docs.ts`
- `src/autolist/docx-lite.ts`

### `main_images_generated`

- `src/autolist/jimeng-assets.ts`（历史文件名，当前职责是主图生成）
- `src/autolist/local-watermark.ts`
- `src/autolist/local-watermark.py`

### `product_folders_built`

- `src/autolist/jimeng-assets.ts`
- `src/autolist/orchestrator.ts`

### `titles_generated`

- `src/autolist/title-sheets.ts`
- `src/autolist/xlsx-lite.ts`
- `src/autolist/title-rules.ts`

### `titles_distributed`

- `src/autolist/title-sheets.ts`

### `metadata_enriched`

- `src/autolist/metadata.ts`
- `src/autolist/xlsx-lite.ts`

### `qualifications_attached`

- `src/autolist/qualifications.ts`

### `shop_distributed`

- `src/autolist/shop-distribution.ts`

### `published`

- `src/autolist/publish.ts`
- `src/business/publish-from-spu.ts`

### `cleaned`

- `src/autolist/cleanup.ts`
- `src/autolist/prepare-test-run.ts`
