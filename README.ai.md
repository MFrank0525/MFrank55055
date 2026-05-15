# AI Execution Notes

默认不要使用统一 `task` 入口。

## Business Entrypoints

豆包业务：

```powershell
npm run business:doubao -- --job "C:\Users\ffc\.openclaw\workspace\douyin-title-generator\input\doubao-job.example.json"
```

SPU 发布业务：

```powershell
npm run business:publish -- --job "C:\Users\ffc\.openclaw\workspace\douyin-title-generator\input\publish-from-spu.job.example.json"
```

旧兼容入口：

```powershell
npm run task:legacy -- --taskFile ".\input\legacy\task.publish-from-spu.flow.inspect.json"
```

## Publish SOP

发布业务统一执行规范见：

- [docs/PUBLISH_FLOW_SOP.md](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/docs/PUBLISH_FLOW_SOP.md)

AI 助手执行 `business:publish` 时，必须优先遵守这份 SOP，不允许自创字段名、步骤顺序、输入值或兜底动作。

补充：

- 最新稳定入口先走 `平台标品` 查询页，再从结果行点 `发布商品` 进入 `/ffa/g/create`
- 如果点击 `填写检查` 或 `发布商品` 后平台关闭当前页或切到新页，必须先恢复到当前存活的发布页，再继续后续确认
