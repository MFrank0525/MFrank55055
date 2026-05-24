# 步骤 01：卖点上下文就绪

## 目标

从飞书多维表格导出的产品记录中读取后续流程需要的商品基础信息和卖点上下文。

## 固定规则

1. 卖点必须来自飞书 `产品卖点` 字段。
2. job 必须配置 `feishuProductDataFile`。
3. 自动上架主流程不允许调用豆包分析产品卖点。
4. 飞书记录缺少 `产品卖点`、`导购短标题`、`品牌`、`SPU`、`资质图片`、`白底图` 时必须停止。
5. 白底图和资质图应先通过 `npm run feishu:assets` 下载到本地标准目录。
6. 飞书导出产物不得保留附件临时 URL、下载 URL 或非必要 token；运行数据只保留业务字段、附件文件名、`fileToken` 和本地路径。
7. 附件下载遇到瞬时网络错误必须先重试，重试失败后停止，不允许缺图继续。
8. `sellingPointText` 必须严格等于飞书 `产品卖点` 字段去除首尾空白后的内容；动作层不得在前面自动追加 `用户认知名`、`品牌+产品通用名称`、SPU 或其他结构化字段。

## 动作脚本

- [feishu-products.ts](src/autolist/feishu-products.ts)
- [product-records.ts](src/feishu/product-records.ts)
- [assets.ts](src/feishu/assets.ts)

## 输入

- `data/feishu/products.json`
- 当前白底图路径

## 输出

- `sellingPointText`
- `userCognitionName`
- `brandedGenericName`
- `brand`
- `spu`
- `shortTitle`
- `productCategory`
- 本地白底图和资质图路径

## 成功条件

1. 当前白底图能匹配到唯一飞书商品记录。
2. 商品记录能提供完整的上架字段。
3. `sellingPointText` 来自飞书 `产品卖点` 字段。
4. 后续图片提示词、主图生成、标题生成、商品信息回填都复用这份飞书记录。

## 失败条件

- 未配置 `feishuProductDataFile`
- 当前白底图匹配不到飞书记录
- 飞书记录关键字段为空
- 资质图或白底图没有下载到本地
- 飞书导出产物包含未脱敏附件 URL 或敏感 token
