# 自动上架项目总览

## 项目目标

把这条链路做成一套可重复执行、可分步测试、失败即停的本地自动化流程：

产品数据就绪 -> 卖点上下文就绪 -> 图片提示词就绪 -> 主图生成完成 -> 标题生成完成 -> 商品信息回填完成 -> 资质图就绪 -> 店铺分发完成 -> 上架发布 -> 清理归档

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
中转站生图、Dreamina 等需要消耗额度生成的图片，失败后优先复用已成功产物，只补缺失部分，不允许无必要重复生成。

6. 主流程固定，工具可替换  
上架前必须完成主图生成、标题生成、SPU 信息、导购短标题、品牌名称等业务节点。豆包、DeepSeek、Dreamina、中转站 `gpt-image-2` 或后续其他模型，只是完成节点目标的工具 provider。优化 provider 时不改变主流程顺序，不把工具名当成新的主流程节点。

## 主链路步骤

1. 产品数据就绪：获取白底图、SPU、导购短标题、品牌名称、产品卖点、资质图。
2. 卖点上下文就绪：从飞书或 provider 获取可用于后续提示词和标题的卖点上下文。
3. 图片提示词就绪：把卖点上下文转成主图/海报生图提示词。
4. 主图生成完成：调用当前生图 provider 生成主图，并完成本地水印与产品文件夹整理。
5. 标题生成完成：调用当前标题 provider 生成电商标题并落成标题表格。
6. 商品信息回填完成：写入 SPU、品牌、导购短标题等发布所需信息。
7. 资质图就绪：把资质图复制到发布商品文件夹。
8. 店铺分发完成：按 5 个店铺目录分发产物。
9. 上架发布完成：按发布 SOP 完成抖店发布。
10. 清理归档完成：清理临时目录，保留运行记录。

当前代码里的 step id 仍兼容旧命名，如 `doubao_generated`、`deepseek_generated`、`jimeng_generated`。这些 id 只是历史兼容标识，语义以本节业务节点为准。

## 先看哪里

### 总体结构

- [PROJECT-STRUCTURE.md](docs/auto-listing/PROJECT-STRUCTURE.md)
- [FLOW_NODE_CONTRACT.md](docs/auto-listing/FLOW_NODE_CONTRACT.md)

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
