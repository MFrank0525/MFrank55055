# 项目自驱自动上架控制面设计

日期：2026-06-13

## 目标

Hermes 只保留用户身份定位、接收“开始上架/继续上架/查询状态”以及调用项目命令的职责。自动上架项目独立负责启动、幂等续跑、失败恢复、批次接力、外部服务等待、进程监管和状态汇总。

## 边界

### Hermes 兼容入口

- `npm run auto-listing:hermes-start`
- `npm run auto-listing:hermes-continue`
- `npm run auto-listing:hermes-status`
- `npm run auto-listing:hermes-rerun-current-batch`

这些命令只薄转发到项目控制器，不包含业务判断、恢复判断、飞书刷新或脚本编排。

### 项目控制面

- `src/cli/auto-listing-controller.ts`
  - 提供 `start`、`status`、`pause` 和确认重跑入口。
  - “开始上架”调用 refresh-first `start-new`；“继续上架/恢复上架”调用 cached-batch `continue`。
  - 选择当前批次的安全恢复点，启动后台项目 supervisor。
  - 汇总项目状态文件，不依赖 Hermes 进程持续在线。
- `src/cli/auto-listing-supervisor.ts`
  - 执行恢复任务或完整流程。
  - 同批次仍有待处理产品时自动接力。
  - 当前批次完成后刷新飞书；发现新批次继续运行。
  - 管理 watchdog、外部服务长退避和子进程组。

### 项目级付费图片控制状态

- `videos-base64` 的 20 个固定 slot 使用 `data/auto-listing/paid-image-submissions` 下的共享账本。
- 账本身份为 `飞书批次指纹 + recordId + 固定 slot`，不属于任何 runtimeDir。
- controller/supervisor 只允许轮询已提交 task、复用已完成结果或提交从未获得权限的 slot。
- `reserved`、`ambiguous` 属于安全阻断，项目停止自动恢复；Hermes 不参与判断或修补。

## 规则层与动作层

- 业务决策继续放在 `src/autolist/*-rules.ts`。
- 文件、进程、网络、飞书刷新和子流程启动属于控制器或 supervisor 动作。
- Hermes 兼容入口不得读取运行产物、生成 resume job、调用飞书、选择恢复点或直接执行全流程脚本。
- 新增规则闭包检查，阻止 Hermes 入口重新承担项目执行职责。

## 续跑语义

“开始上架”和“继续上架”必须保持不同意图：

1. 已有项目 supervisor 正在运行时，返回 `already_running`。
2. “开始上架”先刷新飞书，禁止选择历史断点，只处理刷新后锁定的批次。
3. “继续上架/恢复上架”不刷新飞书，从锁定批次的安全断点继续。
4. 当前批次完成时刷新飞书；新批次自动开始。
5. 没有新批次时停止；旧批次重跑必须走确认入口。

“暂停上架”调用 `auto-listing:hermes-pause` 薄入口，由项目控制器写入暂停状态。暂停不杀死或遗弃已经提交的付费图片 task；项目先完成原 task ID 的落账，在下一个安全步骤边界停止。

## 迁移兼容

- 外部调用命令名保持不变，避免破坏飞书/Hermes 指令映射。
- 控制文件迁移为项目命名；读取时兼容历史 Hermes 控制文件，写入只使用项目控制文件。
- 旧 Hermes runner/supervisor 实现删除，避免形成第二套执行路径。

## 验证

- 规则检查证明 Hermes 命令只调用项目控制器。
- 规则检查证明 Hermes 名称的 CLI 不再包含执行逻辑。
- 现有进度、恢复、接力、状态测试改为验证项目控制器。
- `build`、`rules:check`、`doctor`、`doctor:feishu`、`doctor:auto-listing` 和模拟流程全部通过。
