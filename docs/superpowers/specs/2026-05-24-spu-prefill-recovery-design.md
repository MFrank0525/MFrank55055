# SPU Prefill Recovery Design

日期：2026-05-24

## 根因

第三个飞书产品发布到第 12 个商品时，抖店创建页显示 `spu信息填充失败`。旧动作层只在当前坏创建页上 reload/goto，无法让平台重新注入 SPU 信息。旧规则层又把包含店铺路径的错误误判为 `shop_context_mismatch`，导致外层发布重试提前停止。

## 规则层

`src/business/publish-from-spu/publish-rules.ts`：

- `evaluatePublishCreatePageReadiness` 负责把创建页健康状态转成动作决策。
- `spu信息填充失败`、`spu填充失败`、`信息填充失败`、短文本且 0 个发布模块的创建页，判定为 `reopen_from_platform_spu`。
- `classifyPublishFailure` 把创建页未就绪错误归类为 `platform_spu_prefill_failed`。
- `shouldRetryPublishFailure` 允许 `platform_spu_prefill_failed` 进入发布任务级重试。

## 动作层

`src/business/publish-from-spu.ts`：

- 创建页健康检查返回页面正文摘要，便于规则层判断。
- 遇到 `reopen_from_platform_spu` 时抛出专用错误。
- `runPublishFlow` 捕获该错误后关闭旧创建页，重新从标品管理查询 SPU 并打开新的创建页。
- 不再把坏创建页当作可修复页面反复 reload。

## 验证

- 回归测试覆盖真实失败文案：`Publish create page did not become ready... body=spu信息填充失败`。
- 回归测试覆盖创建页健康决策：0 发布模块 + `spu信息填充失败` 必须返回 `reopen_from_platform_spu`。
