# 自动上架项目总览

## 项目目标

把这条链路做成一套可重复执行、可分步测试、失败即停的本地自动化流程：

白底图 -> 豆包卖点 -> DeepSeek 提示词 -> Word 提示词 -> Dreamina 生图 -> 本地水印 -> 产品图片文件夹 -> 标题 -> 商品信息回填 -> 资质图 -> 上架

## 最重要的维护原则

1. 脚本和操作说明分离  
动作脚本只负责执行。  
业务规则、固定对话、固定提示词、失败条件、人工检查点统一写在 `docs/auto-listing/steps/*.md`。

2. 每步执行前先读说明  
调度器会在每个步骤开始前读取对应 `md`。

3. 规则只有一个来源  
豆包卖点、DeepSeek 指令、Dreamina 指令1模板，统一从步骤 `md` 读取，不允许在多个执行脚本里长期复制第二份正文。

4. 断点续跑，不重跑已完成步骤  
如果全流程卡在某一步，先只修这一步。修完后从这一步继续跑，不重复执行前面已经完成且没有问题的步骤。

5. 积分产物优先复用，不允许浪费  
Dreamina 等需要消耗积分生成的图片，失败后优先复用已成功产物，只补缺失部分，不允许无必要重复生成。

## 主链路步骤

1. `doubao_generated`
2. `deepseek_generated`
3. `jimeng_generated`
4. `product_folders_built`
5. `titles_generated`
6. `titles_distributed`
7. `metadata_enriched`
8. `qualifications_attached`
9. `shop_distributed`
10. `published`
11. `cleaned`

## 先看哪里

### 总体结构

- [PROJECT-STRUCTURE.md](docs/auto-listing/PROJECT-STRUCTURE.md)

### 分步骤说明

- [steps](docs/auto-listing/steps)

### 稳定性问题

- [stability-checklist.md](docs/auto-listing/stability-checklist.md)

## 关键入口

- 总调度入口：[auto-listing.ts](src/cli/auto-listing.ts)
- 总调度核心：[orchestrator.ts](src/autolist/orchestrator.ts)
- 发布入口：[publish-from-spu.ts](src/cli/publish-from-spu.ts)
- 发布核心：[publish-from-spu.ts](src/business/publish-from-spu.ts)

## 修改规则的正确方式

1. 先改对应步骤 `md`
2. 再检查动作脚本是否仍然只是执行动作
3. 运行前先做规则完整性检查

命令：

```bash
npm run rules:check
```

## 运行痕迹

每次运行都会记录：

- `state.json`
- `result.json`
- `events.ndjson`
- `manuals-read.json`

这样可以看到本轮实际读取了哪些步骤说明文件。
