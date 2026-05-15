# 自动上架脚本映射

本文档只描述“每一步由哪些脚本负责”，不写业务规则。业务规则统一写在 `steps/*.md`。

## 1. 调度入口

- CLI 入口：`src/cli/auto-listing.ts`
- 总调度：`src/autolist/orchestrator.ts`
- Job 解析：`src/autolist/config.ts`
- 状态机：`src/autolist/state-machine.ts`
- 类型定义：`src/autolist/types.ts`

## 2. 分步骤脚本映射

### `doubao_generated`

- `src/autolist/doubao-selling-points.ts`
- `src/doubao/submit.ts`
- `src/doubao/capture.ts`
- `src/doubao/save.ts`

### `deepseek_generated`

- `src/autolist/deepseek-prompts.ts`
- `src/autolist/deepseek-word-docs.ts`
- `src/autolist/docx-lite.ts`

### `jimeng_generated`

- `src/autolist/jimeng-assets.ts`
- `src/autolist/local-watermark.ts`
- `src/autolist/local-watermark.py`

### `product_folders_built`

- `src/autolist/jimeng-assets.ts`
- `src/autolist/orchestrator.ts`

### `titles_generated`

- `src/autolist/title-sheets.ts`
- `src/autolist/xlsx-lite.ts`
- `src/doubao/run.ts`

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
