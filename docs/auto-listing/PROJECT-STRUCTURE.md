# 项目结构

## 核心原则

这个项目只分三层：

1. 固定业务主流程  
主流程只描述上架必须完成的业务节点，不绑定具体工具：产品数据、卖点上下文、图片提示词、主图生成、标题生成、商品信息回填、资质图、店铺分发、发布、清理。

2. 可替换 provider  
豆包、DeepSeek、Dreamina、中转站图片模型或其他模型都只是 provider。provider 可以按节点切换，但不能改变主流程节点顺序。

3. 动作脚本  
脚本只负责执行动作。

4. 操作说明  
凡是动作脚本以外的要求、规则、固定对话、固定提示词、失败条件、人工检查点，都写在步骤 `md` 里。

## 你应该先看哪里

### 先看总览

- [README.md](docs/auto-listing/README.md)
- [PROJECT-STRUCTURE.md](docs/auto-listing/PROJECT-STRUCTURE.md)

### 再看步骤说明

- [steps](docs/auto-listing/steps)

### 最后看脚本

- 总调度入口：[auto-listing.ts](src/cli/auto-listing.ts)
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

## 当前三个核心规则源

### 卖点上下文

[01-doubao-selling-points.md](docs/auto-listing/steps/01-doubao-selling-points.md)

### 图片提示词

[02-deepseek-prompts.md](docs/auto-listing/steps/02-deepseek-prompts.md)

### 主图生成指令模板

[03-dreamina-generation.md](docs/auto-listing/steps/03-dreamina-generation.md)

## 不允许再发生的情况

1. 在多个脚本里各自保存一份中文规则正文。
2. 把 provider 名称当成主流程节点新增或改名。
3. 为了切换工具而改变“上架前必须完成主图、标题、SPU、导购短标题、品牌名称”的业务顺序。
4. 只改脚本，不改对应步骤说明。
5. 不读步骤 `md` 就直接执行。
6. 新规则已经更新，但流程还在跑旧规则。
