# 2026-05-24 图片生成卡顿与状态误导修复

## 根因

当前运行不是停在“一个产品完成后没有进入下一个产品”。状态文件显示第二个待处理产品已经开始，卡点在 `main_images_generated`：`Prompt 3/5: Image 3` 的图片生成返回空数据并重试。

状态汇报层同时存在误导：运行中仍优先展示上一产品留下的 `publish-manifest 20/20`，导致用户看到像是上一产品完成后没有继续。

图片生成动作层还有缺口：生成请求本身有超时，但生成结果为 URL 时，后续下载图片 URL 的 `fetch` 没有超时，网络连接挂起时会让整个后台进程长时间无进度。

本次失败最终落在空数据重试分支：重试返回 `content_policy_violation`，旧代码只在初始请求阶段触发合规降级，空数据重试阶段没有复用同一 policy retry 动作。

## 规则

1. Hermes 运行中，如果 state 存在当前 active task，状态摘要必须优先展示当前 task 的最新进度。
2. 发布 manifest 只能说明发布阶段进度，不能覆盖运行中正在执行的生成阶段进度。
3. 图片生成请求和图片 URL 下载都必须有超时边界。
4. 图片生成服务返回空数据或网络超时，只能按既定重试规则重试；超过上限必须失败并保留断点，不能无限等待。
5. 任意生成请求阶段返回内容策略拦截，都必须使用统一合规降级提示词重试；不能只覆盖初始请求。

## 动作

1. `hermes-auto-listing-runner` 运行中优先用 state/events 生成摘要。
2. `jimeng-assets` 下载生成图片 URL 时使用 AbortController 超时。
3. `image-generation-rules` 保存图片下载超时规则。
4. `image-generation-rules` 保存内容策略重试判定规则。
5. `jimeng-assets` 在初始请求和空数据重试分支共用合规降级动作。

## 验证

1. 回归测试覆盖运行中状态摘要优先 active task。
2. 回归测试覆盖图片下载超时下限为 30 秒，并继承请求超时时间。
3. 回归测试覆盖内容策略错误会触发 policy prompt retry。
4. `npm run build && node scripts/test-progress-state.mjs`
5. `npm run rules:check`
6. `npm run doctor:auto-listing`
