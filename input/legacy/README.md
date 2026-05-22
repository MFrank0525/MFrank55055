# Legacy Task Archive

旧统一任务入口已经移除，本目录仅作为旧任务结构的只读归档。

默认不要使用这些文件。默认请改用：

- `../doubao-job.example.json`
- `../publish-from-spu.job.example.json`
- `../auto-listing.job.example.json`

保留这些旧文件的目的只有一个：

- 方便回溯旧任务结构

不要继续新增或运行旧 `taskType` 文件。需要组合流程时，请使用 `business:auto-listing`
的 job 配置和 checkpoint/resume 能力。
