# AI Execution Notes

默认不要发明入口，也不要使用历史任务接口。自动上架只把 Hermes 当启动器。

## Business Entrypoints

Hermes / 飞书触发自动上架：

```bash
npm run auto-listing:hermes-start
```

Hermes 不要直接同步执行底层流程脚本；真实流程可能超过终端工具超时和调用预算。后台入口会快速返回，并通过 `npm run auto-listing:hermes-status` 查看运行状态。

豆包业务：

```bash
npm run business:doubao -- --job ./input/doubao-job.example.json
```

SPU 发布业务：

```bash
npm run business:publish -- --job ./input/publish-from-spu.job.example.json
```

## Publish SOP

发布业务统一执行规范见：

- [docs/PUBLISH_FLOW_SOP.md](docs/PUBLISH_FLOW_SOP.md)

AI 助手执行 `business:publish` 时，必须优先遵守这份 SOP，不允许自创字段名、步骤顺序、输入值或兜底动作。

补充：

- 最新稳定入口先走 `平台标品` 查询页，再从结果行点 `发布商品` 进入 `/ffa/g/create`
- 如果点击 `填写检查` 或 `发布商品` 后平台关闭当前页或切到新页，必须先恢复到当前存活的发布页，再继续后续确认
