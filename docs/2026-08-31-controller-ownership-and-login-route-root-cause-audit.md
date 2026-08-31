# 2026-08-31 控制权与登录页身份根因审计

## 现场证据

- 当前飞书缓存和运行清单绑定批次 `21a53425746de97ae01f9a02`，已完成 13/20 个产品，第 14 个产品保留了精确发布检查点和 0 条不确定发布边界。
- 历史监督器 PID `80371` 仍绑定旧批次 `03147ef995925ec11667b3e8`，且处于无子进程的 `doudian_login_wait`。深审计正确报告 `controller_process_batch_fingerprint_mismatch`。
- 项目固定 Chrome 的实际页面 URL 为 `https://fxg.jinritemai.com/login/common?...`，但当登录正文尚未渲染或位于 iframe 时，页面身份判定器仅根据正文关键词检测登录，因而将明确登录 URL 误分类为 `Platform SPU query page URL is not active`。

## 系统性整改

| 要求 | 实现/处置 | 验证 | 状态 |
| --- | --- | --- | --- |
| 不允许旧批次监督器继续驱动当前批次 | 使用控制器已有的 wait-only 所有权移交，终止旧 PID，新 PID `26744` 绑定 `21a53425746de97ae01f9a02` | controller job + deep audit | verified |
| 明确 `/login` / `/passport` 路由必须直接归类为需登录，不依赖页面正文是否已渲染 | `src/business/publish-from-spu/publish-rules.ts` | `scripts/test-platform-spu-query-page-rule.mjs` | verified |
| 需登录必须进入专用无限等待边界，恢复后只续跑同批次清单 | `assertDoudianPublishSessionReady` + supervisor login recovery | preflight regression | verified |
| 不重放已发布目标或不确定提交 | canonical manifest/checkpoint + controller ownership handoff | deep audit sideEffects `unconfirmed=0` | verified |

## 说明

平台服务端登录过期无法从脚本内消除；项目的根治边界是：精确识别登录页、不消耗普通重试预算、不重放副作用、保留固定浏览器和精确批次检查点，并在人工完成平台登录后自动恢复。
