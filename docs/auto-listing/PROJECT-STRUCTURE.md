# 项目结构

## 核心原则

这个项目只分两层：

1. 动作脚本  
脚本只负责执行动作。

2. 操作说明  
凡是动作脚本以外的要求、规则、固定对话、固定提示词、失败条件、人工检查点，都写在步骤 `md` 里。

## 你应该先看哪里

### 先看总览

- [README.md](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/docs/auto-listing/README.md)
- [PROJECT-STRUCTURE.md](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/docs/auto-listing/PROJECT-STRUCTURE.md)

### 再看步骤说明

- [steps](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/docs/auto-listing/steps)

### 最后看脚本

- 总调度入口：[auto-listing.ts](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/src/cli/auto-listing.ts)
- 总调度核心：[orchestrator.ts](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/src/autolist/orchestrator.ts)
- 发布入口：[publish-from-spu.ts](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/src/cli/publish-from-spu.ts)
- 发布核心：[publish-from-spu.ts](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/src/business/publish-from-spu.ts)

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

```powershell
npm run rules:check
```

## 当前三个核心规则源

### 豆包卖点

[01-doubao-selling-points.md](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/docs/auto-listing/steps/01-doubao-selling-points.md)

### DeepSeek 提示词

[02-deepseek-prompts.md](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/docs/auto-listing/steps/02-deepseek-prompts.md)

### Dreamina 指令1模板

[03-dreamina-generation.md](C:/Users/ffc/.openclaw/workspace/douyin-title-generator/docs/auto-listing/steps/03-dreamina-generation.md)

## 不允许再发生的情况

1. 在多个脚本里各自保存一份中文规则正文。
2. 只改脚本，不改对应步骤说明。
3. 不读步骤 `md` 就直接执行。
4. 新规则已经更新，但流程还在跑旧规则。
