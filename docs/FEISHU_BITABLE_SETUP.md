# Feishu Bitable Setup

目标：从飞书多维表格读取产品数据，替代原先“豆包生成卖点 + 本地 Excel 回填”的数据来源。

## 需要的授权信息

不要把密钥写入 Git。运行前用环境变量提供：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

本机也可以把密钥写到被 `.gitignore` 忽略的 `input/feishu-bitable.config.json`：

```json
{
  "auth": {
    "appId": "cli_xxx",
    "appSecret": "xxx"
  }
}
```

不要把 `auth` 写进示例配置或提交到 Git。

也可以直接提供已有 token：

```bash
export FEISHU_TENANT_ACCESS_TOKEN="t-xxx"
```

飞书应用需要具备：

- 多维表格记录读取权限
- 多维表格字段读取权限
- 对目标多维表格的访问权限

如果运行时报 `Feishu authorization is required` 或权限错误，就需要在飞书开放平台给应用授权，并让应用能访问目标多维表格。

## 配置多维表格

复制配置模板：

```bash
cp input/feishu-bitable.config.example.json input/feishu-bitable.config.json
```

填写：

- `bitableUrl`：可选，直接填飞书多维表格 URL，程序会尝试自动解析
- `appToken`：多维表格 URL 里的 base/app token
- `tableId`：数据表 ID，通常以 `tbl` 开头
- `viewId`：可选，只读取指定视图时填写
- `fieldMap`：项目字段和飞书字段名的映射

也可以用环境变量覆盖：

```bash
export FEISHU_BITABLE_APP_TOKEN="base_or_app_token"
export FEISHU_BITABLE_TABLE_ID="tbl_xxx"
export FEISHU_BITABLE_VIEW_ID="vew_xxx"
```

也可以只配置：

```bash
export FEISHU_BITABLE_URL="https://..."
```

## 当前要求的飞书字段

默认字段名：

- `用户认知名`
- `通用名称`
- `品牌`
- `SPU信息`
- `产品卖点`
- `导购短标题`
- `资质图片`
- `产品白底图`

如果你的飞书字段名不同，只改 `input/feishu-bitable.config.json` 里的 `fieldMap`。

## 检查命令

校验授权和字段映射：

```bash
npm run feishu:check -- --config ./input/feishu-bitable.config.json
```

列出飞书字段：

```bash
npm run feishu:fields -- --config ./input/feishu-bitable.config.json
```

预览记录：

```bash
npm run feishu:records -- --config ./input/feishu-bitable.config.json --limit 3
```

导出规范化产品数据：

```bash
npm run feishu:dump -- --config ./input/feishu-bitable.config.json --out ./data/feishu/products.json
```

导出产品数据并下载附件：

```bash
npm run feishu:assets -- --config ./input/feishu-bitable.config.json --out ./data/feishu/products.json
```

默认会把附件落到：

- 白底图：`input/auto-listing/feishu-images`
- 资质图片：`input/auto-listing/qualifications`

导出的结构会包含：

- `userCognitionName`
- `genericName`
- `brand`
- `spu`
- `sellingPointText`
- `shortTitle`
- `qualificationImages`
- `whiteBackgroundImages`

## 接入自动上架

Mac 版本优先使用：

```bash
npm run business:auto-listing -- --job ./input/auto-listing.job.mac-feishu-flow.json
```

一键模拟流程：

```bash
npm run flow:mac-feishu
```

一键真实流程：

```bash
npm run flow:mac-feishu:real
```

这个 job 通过 `feishuProductDataFile` 读取 `data/feishu/products.json`。配置后，自动上架流程里的卖点上下文会来自飞书字段 `产品卖点`，不再调用豆包生成产品卖点。

该 Mac Feishu job 默认设置 `cleanupSourceImageAfterPublish=false`，避免真实发布清理时删除从飞书下载的白底图源文件。

真实流程仍然保留豆包生成电商标题，因为标题质量以抖音电商实战转化为优先。

真实流程的生图 provider 已切换为 OpenAI-compatible 中转站 `gpt-image-2`。本地密钥和接口配置放在 `input/image-generation.config.json`，该文件被 `.gitignore` 忽略；仓库只提交 `input/image-generation.config.example.json`。如果运行时报余额、额度或计费不足，需要先给中转站账号充值。

运行全流程前先检查：

```bash
npm run doctor:feishu
npm run doctor:auto-listing -- --require-image-generation --image-generation-provider openai-compatible --image-generation-config ./input/image-generation.config.json
```

如果 `doctor:feishu` 报 `invalidRecords`，需要先补齐飞书表格里的缺失字段或附件。
