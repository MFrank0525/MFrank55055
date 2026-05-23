# 抖音全自动上架连续性审计实施计划

## 目标

新增一个只读审计能力，防止“飞书表格多个产品，但流程只跑完第一个产品后停止”这类问题再次变成运行时事故。

## 步骤

1. 写失败用例
   - 在现有测试脚本中导入即将新增的审计规则。
   - 覆盖完整批次、缺失待处理白底图、运行发现数量不足三类情况。

2. 实现纯规则
   - 新增 `src/autolist/audit-rules.ts`。
   - 提供飞书附件本地文件收集、待处理记录计算、连续性审计函数。
   - 不读写磁盘，不启动外部流程。

3. 实现只读动作入口
   - 新增 `src/cli/audit-auto-listing.ts`。
   - 读取 job、飞书缓存、已处理清单、素材目录和最新运行状态。
   - 支持默认文本输出和 `--json` 输出。

4. 接入 npm 脚本和文档
   - 在 `package.json` 增加 `audit:auto-listing`。
   - 更新稳定性清单和飞书说明，要求每次真实运行前先审计。

5. 验证
   - `npm run build`
   - `node scripts/test-progress-state.mjs`
   - `npm run rules:check`
   - `npm run doctor:auto-listing`
   - `npm run audit:auto-listing`
   - `npm run auto-listing:hermes-status -- --text`

6. 交付
   - 检查 git 状态，只提交源码、测试和文档。
   - commit 后 push 到 GitHub。
