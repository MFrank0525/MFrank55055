# 项目结构

## 核心原则

这个项目分五层：

1. 项目控制面
`auto-listing-controller` 负责幂等开始/继续、断点选择和状态；`auto-listing-supervisor` 负责子流程接力、等待和进程监管。Hermes/飞书只是兼容触发入口，不拥有项目执行逻辑。

2. 固定业务主流程
主流程只描述上架必须完成的业务节点，不绑定具体工具：产品数据、卖点上下文、图片提示词、主图生成、标题生成、商品信息回填、资质图、店铺分发、发布、清理。

3. 可替换 provider
飞书、中转站图片模型、抖店浏览器或其他 provider 可以按节点切换，但不能改变主流程节点顺序。

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
- 发布核心：[publish-from-spu.ts](src/business/publish-from-spu.ts)

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

Hermes/飞书只允许调用 `auto-listing:hermes-start` 和 `auto-listing:hermes-status` 兼容命令。这些命令薄转发到项目控制器；恢复、飞书刷新、流程脚本和发布动作全部由项目自身完成。

状态汇报同样由项目控制器负责生成，Hermes 只转发。发布进度必须按当前商品的 20 个待上架产品为一组展示，突出当前上架商品、组内第几个产品、当前第几个店铺和飞书批次进度；禁止把多个商品或多个续跑清单的发布条目累加成 `60/60` 这类跨商品累计数字。店铺总数必须来自完整发布计划或类目固定计划，不能用当前 `publish-manifest.json` 已触达的店铺数量当分母，否则续跑中途会误报 `店铺 4/4`、`店铺 5/5`。状态文本必须按当前业务阶段选择单一进度源：生图阶段展示生图进度；进入发布/上架阶段后只展示发布心跳或发布清单进度，禁止继续夹带 `Main images ready` 等已完成生图信息。

## 不允许再发生的情况

1. 在多个脚本里各自保存一份中文规则正文。
2. 把 provider 名称当成主流程节点新增或改名。
3. 为了切换工具而改变“上架前必须完成主图、标题、SPU、导购短标题、品牌名称”的业务顺序。
4. 只改脚本，不改对应步骤说明。
5. 不读步骤 `md` 就直接执行。
6. 新规则已经更新，但流程还在跑旧规则。
