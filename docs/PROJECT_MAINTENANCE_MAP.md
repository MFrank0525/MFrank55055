# Project Maintenance Map

这份文档用于约束后续优化位置，避免同类问题反复出现。

## 1. 平台适配

只允许放在：

- `src/utils/platform.ts`
- `src/utils/clipboard.ts`
- `src/browser/launch.ts`
- `src/cli/doctor.ts`

规则：

- 不在业务脚本里硬编码 macOS、Windows、Linux 差异。
- 不在 job example 里写个人电脑绝对路径。
- 新增基础外部工具时，必须同步加入 `npm run doctor` 检查。
- 新增业务专项依赖时，放入对应专项检查，例如 `doctor:publish` 或 `doctor:auto-listing`。

## 2. 自动上架规则

只允许优先放在：

- `docs/auto-listing/steps/*.md`
- `src/autolist/rule-contracts.ts`

规则：

- 提示词、固定对话、固定命名、失败条件先写步骤文档。
- TypeScript 脚本只读取规则并执行动作。
- 规则完整性校验标记放 `rule-contracts.ts`，不和读取逻辑混在一起。

## 3. 自动上架动作脚本

按步骤维护：

- 豆包卖点：`src/autolist/doubao-selling-points.ts`
- DeepSeek 提示词：`src/autolist/deepseek-prompts.ts`
- Dreamina / 水印 / 产品文件夹：`src/autolist/jimeng-assets.ts`
- 标题表：`src/autolist/title-sheets.ts`
- 商品信息回填：`src/autolist/metadata.ts`
- 资质图：`src/autolist/qualifications.ts`
- 店铺分发：`src/autolist/shop-distribution.ts`
- 发布调用：`src/autolist/publish.ts`
- 清理：`src/autolist/cleanup.ts`

总调度顺序只在 `src/autolist/orchestrator.ts` 调整。

## 4. SPU 发布业务

公开入口保持：

- `src/business/publish-from-spu.ts`

内部边界：

- 类型：`src/business/publish-from-spu/types.ts`
- 固定发布规则和常量：`src/business/publish-from-spu/constants.ts`
- 产品素材识别：`src/business/publish-from-spu/assets.ts`
- 标题工作簿读取：`src/business/publish-from-spu/workbook.ts`

规则：

- 发布顺序和禁止事项以 `docs/PUBLISH_FLOW_SOP.md` 为最高优先级。
- 不能把素材识别、工作簿解析、固定常量重新写回 `publish-from-spu.ts`。
- 后续继续拆浏览器自动化时，按 SOP 模块拆：标品检索、基础信息、图文信息、价格库存、服务履约、发布检查。

## 5. 检查命令

每次优化后必须至少运行：

```bash
npm run build
npm run doctor
npm run rules:check
```

涉及真实发布数据时额外运行：

```bash
npm run doctor:publish
```

涉及自动上架和 Dreamina 时额外运行：

```bash
npm run doctor:auto-listing
```
