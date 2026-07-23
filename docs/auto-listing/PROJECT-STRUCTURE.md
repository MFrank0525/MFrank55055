# 项目结构

## 核心原则

这个项目分五层：

1. 项目控制面
`auto-listing-controller` 负责幂等开始/继续、断点选择和状态；`auto-listing-supervisor` 负责子流程接力、等待和进程监管。Hermes/飞书只是兼容触发入口，不拥有项目执行逻辑。

2. 固定业务主流程
主流程只描述上架必须完成的业务节点，不绑定具体工具：产品数据、卖点上下文、图片提示词、主图生成、标题生成、商品信息回填、资质图、店铺分发、发布、清理。

3. 固定主图 provider contract
主图生成只允许使用当前唯一 canonical 路径：OpenAI-compatible `gpt-image-2`、`videos-base64`、精确接口 `/v1/videos`，并通过 Base64 data URL 元数据传入白底参考图。该节点没有其他 provider、模型、模式或兼容入口；飞书数据读取和抖店浏览器仍是各自业务节点的固定实现边界。

4. 动作脚本
脚本只负责执行动作。

5. 操作说明
凡是动作脚本以外的要求、规则、固定对话、固定提示词、失败条件、人工检查点，都写在步骤 `md` 里。

## 你应该先看哪里

### 先看总览

- [README.md](docs/auto-listing/README.md)
- [PROJECT-STRUCTURE.md](docs/auto-listing/PROJECT-STRUCTURE.md)

### 再看步骤说明

- [steps](docs/auto-listing/steps)

### 最后看脚本

- 总调度入口：[auto-listing.ts](src/cli/auto-listing.ts)
- 项目控制入口：[auto-listing-controller.ts](src/cli/auto-listing-controller.ts)
- 项目进程监管：[auto-listing-supervisor.ts](src/cli/auto-listing-supervisor.ts)
- 总调度核心：[orchestrator.ts](src/autolist/orchestrator.ts)
- 发布入口：[publish-from-spu.ts](src/cli/publish-from-spu.ts)
- 发布业务入口：[publish-from-spu.ts](src/business/publish-from-spu.ts)
- 发布流程编排：[publish-flow.ts](src/business/publish-from-spu/publish-flow.ts)
- 发布模块动作：[actions/](src/business/publish-from-spu/actions)

## 目录怎么理解

### `src/autolist`

自动上架主链路脚本。

### `src/business`

抖店发布侧动作脚本。

### `docs/auto-listing/steps`

每一步的操作说明。  
后续改规则，优先改这里。

## 怎么维护

### 改规则

先改步骤 `md`。

### 改动作

再改脚本。

### 正式运行前

先检查规则完整性：

```bash
npm run rules:check
```

## 当前规则源

### 主规则源

[steps](docs/auto-listing/steps) 是自动上架 11 个业务节点的唯一 Markdown 规则源。卖点、海报提示词、生图护栏、标题、店铺分发、发布、清理等业务规则都优先写在对应步骤文件里。

### 规则模块

`src/**/*-rules.ts` 和 `src/**/publish-rule-text.ts` 只能保存结构化判断、分类函数、Markdown 规则读取逻辑和小型常量，不保存长段中文业务规则正文。

### 动作模块

浏览器点击、上传、文件复制、截图、日志写入等动作保存在动作模块。动作模块可以调用规则模块，但不能自己发明业务成功/失败条件。

### 外部触发边界

Hermes/飞书只允许调用 `auto-listing:hermes-start`、`auto-listing:hermes-continue` 和 `auto-listing:hermes-status` 兼容命令。start 表示先刷新飞书再开始刷新后的批次；continue 表示不刷新、只恢复锁定批次。命令只薄转发到项目控制器；恢复、飞书刷新、流程脚本和发布动作全部由项目自身完成。

Hermes gateway 在执行 start、continue 或 status 时必须记录该命令的精确消息 origin（平台、chat、thread 和触发消息），后续 watcher 通知只投递到这个 origin。飞书通知必须拿到非空 `message_id` 回执才允许更新去重状态；没有回执的通知保持待发送并在下一轮重试，不能用 API 调用未报错冒充用户已收到。

状态汇报同样由项目控制器负责生成，Hermes 只转发。发布进度必须按 canonical `batchFingerprint + recordId + taskId` 对当前商品的 20 个待上架目标分组，禁止按可能重复的展示名或通用名聚合；完成数、当前目标序号、当前店铺序号、飞书 processed 完成数和当前飞书 record 序号必须分别标注，禁止把多个商品或多个续跑清单的发布条目累加后截断成 `20/20`，也禁止把“当前第5/6”冒充“已完成5/6”。店铺总数必须来自完整发布计划或类目固定计划，不能用当前 `publish-manifest.json` 已触达的店铺数量当分母。状态文本必须按当前业务阶段选择单一进度源：生图阶段展示生图进度；进入发布/上架阶段后只展示发布心跳或发布清单进度，暂停后的有效发布断点也不得退回已完成生图信息。JSON 状态面向 Hermes 的唯一自动反馈入口是 `hermesProgress`；发布阶段不得在顶层暴露 `imageProgress`。`hermesProgress.key` 必须包含当前 recordId、商品组和店铺组进度，不能再写入原始累计值；`hermesProgress.message` 必须携带飞书批次完成数、当前 record 序号、当前商品安全完成数和当前目标/店铺，并优先显示飞书用户认知名。Hermes gateway 的自动 watcher 必须记录完整 key 作为心跳、按稳定消息 key 去重，并在暂停/停止通知中直接播报 `hermesProgress.message`；禁止回退到隐藏字段显示 `0/?`，也禁止用历史商品名或跨 run watcher key 压制当前商品新进度。控制器终态原因仍必须优先覆盖普通进度。

发布动作越过最终提交边界后是非幂等操作。只要结果属于 `final_publish_state_uncertain`，包括发布按钮可能已点击但成功信号未确认、最终提交后页面上下文丢失、返回空白创建页等，项目不得自动重跑同一店铺商品目录；发布计划必须进入 `review` 状态并要求确认平台结果，避免重复上架。

## 不允许再发生的情况

1. 在多个脚本里各自保存一份中文规则正文。
2. 把 provider 名称当成主流程节点新增或改名。
3. 为了切换工具而改变“上架前必须完成主图、标题、SPU、导购短标题、品牌名称”的业务顺序。
4. 只改脚本，不改对应步骤说明。
5. 不读步骤 `md` 就直接执行。
6. 新规则已经更新，但流程还在跑旧规则。
