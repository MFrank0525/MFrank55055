# 恢复任务后继续飞书批次规格

日期：2026-05-24

## 根因

失败恢复任务只针对单个失败商品生成 `resumeSourceImagePath`，并设置 `maxImagesPerRun=1`。第二个产品发布完成后，恢复 run 自身写入 `ok=true`，Hermes 状态只看恢复 run 和发布 manifest，于是误报 `completed`。但飞书表格还有第三个产品未处理，`processed-images.json` 只记录了 2/3 个飞书产品。

## 目标

1. `completed` 只能表示整张飞书表格的产品都处理完成。
2. 恢复 run 完成后，如果飞书仍有待处理产品，Hermes 状态必须显示 `pending_products`。
3. 已成功完成的 resume job 属于过时动作文件，必须在下一次启动前清掉，不能继续影响启动路径。
4. 下一次 `auto-listing:hermes-start` 必须启动正常 full-real-flow，继续处理剩余飞书产品。

## 规则层

`src/autolist/audit-rules.ts` 新增 `summarizeFeishuBatchProgress`：

- 输入飞书记录和 processed manifest。
- 输出总记录数、已处理记录数、待处理记录数、待处理源图和 `batchComplete`。

## 动作层

`src/cli/hermes-auto-listing-runner.ts`：

- 读取飞书缓存和 processed manifest。
- 状态判断中，只有 `batchComplete=true` 才允许显示 `completed`。
- 如果 run 已完成但 `batchComplete=false`，状态显示 `pending_products`。
- 启动时如果发现当前 resume job 对应结果已经成功，删除该 resume job，让启动器回到 full-real-flow。

## 验证

- 回归脚本覆盖 3 条飞书记录、2 条 processed 时 `batchComplete=false`。
- 当前真实状态应显示 `pending_products`，而不是 `completed`。
