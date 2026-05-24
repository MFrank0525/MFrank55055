# 2026-05-24 DeepSeek 卖点字段禁止自动加前缀

## 根因

DeepSeek 指令中出现了飞书 `产品卖点` 字段之外的内容：

```text
医用芦荟凝胶,延草纲目医用聚乙二醇护创敷料,
```

该内容不是 DeepSeek 生成，也不是历史对话污染，而是动作层 `src/autolist/feishu-products.ts` 在构造 `sellingPointText` 时自动把 `用户认知名` 和 `品牌+产品通用名称` 拼到了飞书 `产品卖点` 前面。

## 规则

1. `sellingPointText` 必须严格等于飞书 `产品卖点` 字段去除首尾空白后的原文。
2. 动作层不得在 `sellingPointText` 前面自动追加 `用户认知名`、`品牌+产品通用名称`、SPU 或其他结构化字段。
3. DeepSeek 发送内容只由 `指令1 + 飞书产品卖点原文 + 指令2 + 本次数量要求` 构成。
4. Word 文档第二段只保存飞书 `产品卖点` 字段原文。
5. 如果运营需要用户认知名、通用名称或品牌出现在卖点段落，必须先写入飞书 `产品卖点` 字段，由表格成为唯一来源。

## 动作

1. 新增规则函数 `buildFeishuSellingPointText`，只返回飞书 `产品卖点` 字段原文。
2. `feishu-products` 动作层调用规则函数，不再自行拼接卖点上下文。
3. DeepSeek prompt 仍由 `deepseek-prompts` 负责发送，不改变固定对话、指令1、指令2和返回解析流程。

## 验证

1. 回归测试覆盖：输入 `用户认知名` 和 `品牌+产品通用名称` 时，输出仍只等于飞书 `产品卖点`。
2. `npm run build && node scripts/test-progress-state.mjs` 必须通过。
3. `npm run rules:check` 必须通过。
