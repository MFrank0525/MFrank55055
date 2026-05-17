# Real Flow Issues

用于记录真实全流程实操时遇到的问题、根因和后续优化动作。

## 2026-05-16 实操记录

### 运行入口

```bash
npm run flow:mac-feishu:real
```

### 问题记录

#### RF-001：一键真实流程参数解析错误

- 现象：运行 `npm run flow:mac-feishu:real` 时，Feishu CLI 收到 `--config --real`，导致配置路径被解析为 `--real`。
- 根因：`src/cli/flow-mac-feishu.ts` 在未传 `--config` 时仍读取 `argv[0]` 作为配置路径。
- 处理：已修复参数解析，只有显式传入 `--config` 时才读取后一个参数，否则使用 `./input/feishu-bitable.config.json`。

#### RF-002：DeepSeek 固定 URL 被标题校验误判

- 现象：真实流程进入自动上架后失败，报错 `DeepSeek specified conversation not found: 日式医用贴膏海报设计`。
- 根因：job 已配置固定 DeepSeek 会话 URL，但代码进入 URL 后仍要求浏览器标题包含固定会话名；DeepSeek 页面标题不稳定，导致误判。
- 处理：已改为优先信任 job 的固定 URL；只要 URL 是 `/a/chat/s/` 且输入框存在，就视为进入目标会话。标题/历史搜索仅作为没有固定 URL 时的兜底。
- 关联运行：`data/auto-listing/runs/20260516-180650/result.json`

#### RF-003：Dreamina 账号可登录但无 CLI 出图权限

- 现象：真实流程已通过 `doctor:auto-listing`，但进入 Dreamina `image2image` 提交时报错 `当前账号没有 dreamina_cli 使用权限: current account is not maestro vip`。
- 根因：原体检只校验 Dreamina CLI 可执行、可登录、可查询积分；没有校验当前账号是否具备 `image2image` 的 maestro 权限。
- 处理：真实一键流程已改为在 `doctor:auto-listing` 阶段强制校验 Dreamina 出图权限；如果账号不是 maestro vip，会在进入自动上架前失败，不再先跑 DeepSeek 和浏览器链路。Dreamina 生图步骤自身也增加同样的权限硬校验。
- 关联运行：`data/auto-listing/runs/20260516-181131/result.json`

#### RF-004：Dreamina CLI 不再作为真实生图主链路

- 现象：Dreamina CLI 权限不可用，真实流程不能继续依赖 Dreamina `image2image`。
- 根因：当前账号与 CLI 权限体系不匹配，且后续真实生图要改为中转站计费模型。
- 处理：真实 Mac 飞书 job 已切换到 OpenAI-compatible 中转站 `gpt-image-2`，本地配置文件为 `input/image-generation.config.json`。真实流程体检改为检查中转站生图配置；如接口返回余额、额度、计费不足，会明确提示充值中转站账号。
