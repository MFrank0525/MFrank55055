# 2026-05-24 Hermes 自动接力剩余产品

## 根因

失败恢复任务使用 `resume-real-job`，只恢复一个失败产品。该单品恢复成功后，旧启动器只会根据飞书批次进度显示 `pending_products`，不会自动重新进入 `full-real-flow`。因此第一款产品完成后，如果仍有飞书待处理记录，就需要人工再次执行 `auto-listing:hermes-start` 才会继续。

## 规则

1. 一个 Hermes 子流程正常退出，只代表该子流程完成，不代表飞书批次完成。
2. 子流程退出码为 0 且飞书批次仍有待处理产品时，必须自动继续 `full-real-flow`。
3. 子流程失败时不能自动跳过错误进入下一产品。
4. 飞书批次已全部处理时，才允许停止接力。

## 动作

1. `hermes-auto-listing-runner` 只负责选择初始模式和启动 supervisor。
2. `hermes-auto-listing-supervisor` 执行初始 `resume-real-job` 或 `full-real-flow`。
3. 每个子流程退出后，supervisor 读取飞书产品缓存和 processed manifest。
4. 如果规则要求继续，supervisor 自动启动 `full-real-flow` 处理剩余产品。

## 验证

1. 单元测试覆盖：退出码 0 且批次未完成时必须继续。
2. 单元测试覆盖：退出码非 0 时不能继续。
3. 单元测试覆盖：批次已完成时不能继续。
