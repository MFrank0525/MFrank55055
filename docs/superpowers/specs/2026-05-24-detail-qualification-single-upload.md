# 2026-05-24 详情页资质图单次上传

## 根因

第三个产品重新上架时，详情页显示 `商品详情图片 (13/50)`。当前产品详情图规则应为：先 `从主图填入` 生成 5 张详情图，再上传飞书资质图 4 张，最终应为 9 张。

13 张正好等于 `5 + 4 + 4`。代码中 `ensureDetailImagesFromMainThenQualifications` 在第一次资质图上传后，如果抖店页面计数没有在等待窗口内及时达到预期，会进入第二轮重试；第二轮重试不是上传缺失图片，而是把同一批 4 张资质图全部再次上传，导致详情页资质图重复。

## 规则

1. 商品详情图必须先点击 `从主图填入`。
2. 飞书资质图每个商品只允许上传一批。
3. 最终详情图数量必须刚好等于 `从主图填入后的数量 + 飞书资质图数量`。
4. 最终详情图数量少于预期时失败并保留断点。
5. 最终详情图数量大于预期时视为重复上传，必须失败并保留断点，禁止继续填写检查和发布。

## 动作

1. 发布动作层只执行一次资质图批量上传。
2. 上传后延长等待页面计数稳定的时间，不用第二轮整批重传弥补页面延迟。
3. 详情图完成判断调用规则层 `evaluateDetailImageCompletion`。
4. 失败时保存 `publish-page-detail-qualification-upload-failed.png`，用于确认是少传、重复传还是页面计数异常。

## 验证

1. 回归测试覆盖 `finalDetailCount === expectedDetailCount` 通过。
2. 回归测试覆盖 `finalDetailCount > expectedDetailCount` 失败。
3. `npm run build && node scripts/test-progress-state.mjs` 必须通过。
