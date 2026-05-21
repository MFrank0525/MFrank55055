# Legacy Task Interface

旧统一任务入口已经移除，不再提供：

```bash
npm run task:legacy -- --taskFile ./input/legacy/task.json
```

这类入口容易绕开独立 CLI 里的 doctor、dry-run、checkpoint 和真实发布保护，所以不再作为兼容层保留。

默认请改用：

- `npm run business:doubao -- --job <doubao-job.json>`
- `npm run business:publish -- --job <publish-from-spu.job.json>`
- `npm run business:auto-listing -- --job <auto-listing-job.json>`

## 已移除的旧任务类型

- `doubao.run`
- `publish_from_spu`

## 迁移方式

旧：

```bash
npm run task:legacy -- --taskFile ./input/legacy/task.doubao.example.json
```

新：

```bash
npm run business:doubao -- --job ./input/doubao-job.example.json
```

旧：

```bash
npm run task:legacy -- --taskFile ./input/legacy/task.publish-from-spu.flow.inspect.json
```

新：

```bash
npm run business:publish -- --job ./input/publish-from-spu.job.example.json
```

旧任务文件不要继续扩展新的 `taskType`。需要组合流程时，请使用 `business:auto-listing` 的 job 配置和 checkpoint/resume 能力。
