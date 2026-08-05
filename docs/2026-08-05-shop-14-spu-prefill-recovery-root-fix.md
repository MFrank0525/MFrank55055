# 2026-08-05 店铺 14 SPU 预填失败恢复根治审计

## 现象与证据

- 运行目录：`data/auto-listing/runs/20260805-175125`
- 失败目标：店铺 14（`14延草纲目中医保健`），商品 `延草纲目生物膜创面面膜`
- 页面证据 `platform-spu-query-result.png` 明确显示“spu信息填充失败”。
- `publish-submit-attempt.json` 为 `not_attempted`，说明故障发生在最终提交前，可以安全重开和重试。
- 相同 SPU `湘械注准20212140518` 已在店铺 1–13 成功发布，因此不是商品元数据或 SPU 本身持续无效，也没有证据指向其他项目并行运行造成资源互扰。

## 根因

`runPublishFlow` 已设计了针对 `PublishCreatePageReopenRequiredError` 的有界恢复，但首次 `runShopSpuAction` 调用位于 `try/catch` 之外。该调用内部本身会检查发布页就绪状态，所以平台第一次返回“SPU 信息填充失败”时，异常在进入恢复边界之前就向上逃逸，已有的页面重开逻辑实际无法处理这条真实路径。

同时，就绪检查把中文页面状态转换成标准错误 `Publish create page reported SPU prefill failure.` 后，外层分类器没有覆盖该标准错误文本，会将其降级成一般 `spu_query_or_match_failed`，导致任务级安全重试也未启动。

## 修复

1. 将首次 `runShopSpuAction` 及其二次就绪确认整体纳入同一个恢复边界。
2. 仅对 `PublishCreatePageReopenRequiredError` 执行最多两次从标品页重新进入发布页的有界恢复。
3. 将标准错误 `Publish create page reported SPU prefill failure.` 明确分类为 `platform_spu_prefill_failed`，恢复外层已有的有界任务重试。
4. 保持提交安全边界不变：最终提交不确定、已点击但未确认等状态不会走这条提交前重放路径。

## 回归保护

- 模块顺序规则要求首次 Shop/SPU 动作必须位于有界恢复捕获范围内。
- 分类规则验证标准英文错误与页面中文提示均映射为 `platform_spu_prefill_failed`。
- 继续保留最终提交状态审计，避免对不确定提交进行盲目重放。

