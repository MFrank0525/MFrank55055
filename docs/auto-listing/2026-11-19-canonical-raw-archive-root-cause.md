# 2026-11-19 主图归档卡住根因与根治

## 现象

运行 `20261119-152843` 已完成当前产品 20 个店铺目标的发布，canonical publish manifest 中 20 条记录均为 `published`，但流程在 `cleaned` 阶段失败：

```text
Archive guard failed: expected 20 current unwatermarked main image(s), got 60.
```

## 根因

固定边框后处理会为每个正式 raw 主图保留三个文件：

- `generated-NN.png`：最终用于分发、且在店铺水印前的正式无水印主图；
- `generated-NN.frame-ready.png`：边框合成过程文件；
- `generated-NN.unframed.png`：供应商原始结果备份。

归档断点恢复原先用 basename 前缀 `^generated-\d+` 扫描 raw 目录。该表达式没有约束文件名结尾，因此三个文件都被当成正式主图，20 个槽位被错误统计为 60 张。数量门禁按设计失败关闭，保护了运行目录，没有造成重复生成、重复付费或重复发布。

## 根治

归档恢复只接受 basename 完整匹配 `generated-<序号>.(png|jpg|jpeg|webp)` 的 canonical 文件。任何带附加后缀的过程文件都不能计数或进入归档。

回归测试为每个槽位同时创建 canonical、`.frame-ready` 和 `.unframed` 三类文件，并验证：

- 15 个 canonical 槽位必须报告 `got 15`，不能报告 45；
- 20 个 canonical 槽位必须恰好归档 20 张；
- 归档内容不得来自两类过程衍生文件。

真实失败目录的只读模拟扫描也必须返回 20，之后才允许从原锁定批次的 cleanup 断点续跑。

## 安全边界

- 不刷新飞书批次，继续使用指纹 `58b15a92cc54728f5ee75a9f`；
- 不清空或重建 publish manifest；
- 不回退到图片生成、店铺分发或发布步骤；
- 只有 20 张 canonical 无水印主图归档成功后，才执行当前产品中间产物的永久清理并推进下一条飞书产品。
