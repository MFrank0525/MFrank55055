# 生成与发布审计优化规格

日期：2026-05-23

## 背景

当前 `audit:auto-listing` 已能审计飞书产品连续性，防止多产品批次只跑完第一个产品。但生图侧和发布侧还缺少同等级的只读审计：主图生成是否满足类目计划、每个提示词是否生成 4 张、输出路径是否重复、每个已进入发布阶段的店铺产品文件夹是否有安全发布信号，都需要从规则层统一判断。

## 目标

1. 生图审计必须校验每个已完成生图阶段的任务：
   - 生成总数等于 `类目 promptCount * 每个 prompt 目标张数`。
   - 每个 prompt 的生成张数等于目标张数。
   - `imageFile` 不允许重复；`productFolder` 可被同一店铺多张主图复用，但声明过的文件夹必须存在。
   - 真实模式下已声明的 `imageFile`、`productFolder` 必须存在。
2. 发布审计必须校验每个已进入发布阶段的任务：
   - 每个分发出的店铺产品文件夹必须有安全发布信号。
   - 安全信号只能来自 `publishArtifact.results` 或 `publish-manifest.json` 中的 `published + publish_signal_confirmed/list_verified`。
   - `failed`、`needs_manual_review`、缺失结果都必须作为 error。
3. 规则和动作继续分离：
   - `src/autolist/audit-rules.ts` 只做纯判断。
   - `src/cli/audit-auto-listing.ts` 只读文件并打印结果。
4. 审计命令仍然只读，不启动 Hermes、不调用飞书、不发布商品。

## 设计

新增规则函数：

- `auditMainImageGeneration`
  - 输入任务列表、文件存在集合、每个 prompt 目标张数、是否模拟模式。
  - 输出 generation summary、errors、warnings。

- `auditPublishCoverage`
  - 输入任务列表、publish manifest entries。
  - 输出 publish summary、errors、warnings。

`audit:auto-listing` 汇总三层结果：

1. Feishu batch continuity。
2. Main image generation。
3. Publish coverage。

只要任一层有 error，命令退出码为 1。warning 不阻断。
