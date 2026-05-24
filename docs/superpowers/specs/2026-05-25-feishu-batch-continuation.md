# Feishu Batch Continuation And Duplicate Product Rule

## Root Cause

旧流程把 `processed-images.json` 当作全局历史去判断源图是否处理过。这个规则只能防止同一批中断恢复后重复上架，但不适合飞书表格按批次更新的业务：新批次可能出现和旧批次相同的产品、SPU、白底图文件名或本地路径，不能因此跳过。

## Rules

1. 上架进度以飞书当前批次为单位判断，不以历史产品是否出现过为单位判断。
2. 同一批次内，已完成产品必须继续防重复，避免中断恢复后重复发布。
3. 不同批次之间，即使产品、SPU、白底图文件名或本地路径相同，也必须当作新任务继续执行。
4. Hermes 在一批产品全部完成后，必须刷新飞书表格素材；如果刷新后批次指纹变化且存在待处理产品，就继续启动完整上架流程。
5. Hermes 只有在当前批次已完成、刷新飞书后没有发现新批次待处理产品时，才停止上架项目。

## Actions

- `src/autolist/feishu-batch-rules.ts` 生成飞书批次指纹，指纹来自表格行顺序、recordId、核心字段和附件身份。
- `src/autolist/file-batch.ts` 将 processed manifest 升级为按批次保存；旧数组格式仍可读取，但新写入按批次隔离。
- `src/autolist/orchestrator.ts` 发现待处理源图和写入完成记录时，都传入当前飞书批次指纹。
- `src/cli/hermes-auto-listing-supervisor.ts` 在一批完成后刷新飞书素材，发现新批次就继续 full flow。
- `src/cli/hermes-auto-listing-runner.ts` 和 `src/cli/audit-auto-listing.ts` 的状态/审计读取当前批次的 processed 记录，不再用全局历史误判。
