# Feishu Bitable Setup

目标：从飞书多维表格读取自动上架所需的全部产品字段和附件。

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
- `SPU`
- `产品卖点`
- `DeepSeek提示词`
- `主图指令`
- `正向提示词`
- `反向提示词`
- `标题关键词`
- `标题固定后缀`
- `产品价格`
- `导购短标题`
- `产品类目`
- `资质图片`
- `白底图`

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
- `productCategory`
- `qualificationImages`
- `whiteBackgroundImages`

安全边界：

- 导出文件会脱敏飞书附件临时 URL、下载 URL 和非文件级 token 字段；`data/feishu/products.json` 只保留必要业务字段、附件文件名、`fileToken` 和本地附件路径。
- `data/feishu/products.json` 仍属于运行数据，不提交 Git。
- `input/feishu-bitable.config.json` 可放本机密钥，但必须保持 `.gitignore` 忽略，不要复制到示例配置。
- 附件下载遇到 408、429、5xx 或瞬时网络错误会自动重试 3 次；仍失败时整批停止，避免带缺图数据进入上架。

## 接入自动上架

Hermes / 飞书触发自动上架时只使用兼容入口；该入口只转发给项目控制器：

```bash
npm run auto-listing:hermes-start
```

“开始上架”会先刷新飞书并锁定刷新后的批次。“继续上架/恢复上架”使用 `npm run auto-listing:hermes-continue`，只恢复当前锁定批次且不刷新飞书。

查询状态：

```bash
npm run auto-listing:hermes-status
```

Hermes 收到“暂停上架”时只使用：

```bash
npm run auto-listing:hermes-pause
```

暂停、继续和状态都由项目控制器管理；Hermes 不直接写暂停文件、不终止子进程、不处理付费图片任务。

状态文本由项目控制器按当前商品组生成：每个商品固定按 20 个待上架产品为一组，展示“当前商品、产品 x/20、店铺 y/10、飞书批次 x/y”。如果同一个运行清单里包含多个商品，状态不得把发布条目累加成 `60/60`、`80/80` 这类跨商品累计值。店铺总数必须以完整 `publish-plan.json` 或类目固定计划为准，不能用当前 `publish-manifest.json` 已触达的店铺数当分母。状态文本必须按当前业务阶段选择单一进度源：生图阶段才展示生图进度；进入上架发布阶段后只展示发布心跳或发布清单进度，禁止夹带已完成的生图 ready 信息。JSON 状态给 Hermes 自动反馈只使用 `hermesProgress`，发布阶段不得在顶层暴露 `imageProgress`。`hermesProgress.key` 和 `hermesProgress.message` 同样必须使用当前商品组进度和最新发布模块，禁止把原始清单累计数写成 `39/40`、`60/60` 这类跨商品表达。Hermes gateway 自动进度汇报必须记录完整 `hermesProgress.key` 作为实时心跳，但对外播报必须以 `hermesProgress.message` 级别的稳定 key 去重；不得因为 key 里的时间戳或最新产物变化每分钟重复播同一模块，也不得用 `last_safely_published` 或旧商品残留状态判断当前商品是否有新进度。

同一店铺出现 2 次上架是当前 20 张主图计划的正常分配：医疗器械/保健食品每店 2 个水印商品目录。真正的重复上架风险是最终提交后的不确定重试；这类 `final_publish_state_uncertain` 必须进入人工确认/平台结果查询，不允许自动重新提交同一商品。

这个 job 通过 `feishuProductDataFile` 读取 `data/feishu/products.json`。自动上架流程里的卖点上下文唯一来自飞书字段 `产品卖点`。

飞书产品执行顺序：

- 自动上架严格按照 `data/feishu/products.json` 的记录顺序执行，也就是飞书视图导出的产品顺序。
- 默认 Mac Feishu job 的 `maxImagesPerRun=0`，表示飞书当前批次里有多少条产品记录就上架多少条。
- 每条记录使用它绑定的第一张已下载 `产品白底图` 作为图生图参考源；如果缺失或本地文件不存在，流程会直接报配置缺口。
- 飞书附件本地文件必须是记录级唯一：文件名必须包含 `recordId` 和附件身份摘要。同批文、同通用名称、同用户认知名只能说明医疗器械注册信息相同，不能说明包装相同；不同飞书记录不得共享同一个白底图或资质图 `localFile`。审计发现共享路径时必须停止并刷新附件，禁止继续生图。
- 已处理过的源图会按飞书批次写入 `data/auto-listing/processed-images.json`，同一批中断恢复时自动跳过；飞书更新为新批次后，即使产品或源图路径与旧批次重复，也按新批次继续执行。
- 所有飞书记录都处理完成后，项目 supervisor 会刷新飞书表格；如果发现新批次，继续按飞书表格顺序上架新批次；如果没有新批次，项目自动停止运行，并在状态里提示当前批次已经完成。
- 后续发送“开始上架”时刷新并开始新批次；发送“继续上架/恢复上架”时只恢复当前锁定批次。没有新批次时不会自动重跑旧批次；确认重跑时使用 `npm run auto-listing:hermes-rerun-current-batch`。

产品类目规则：

- `医疗器械`：依次上架 01-10 十个店铺，5 份 Word、20 张主图、20 条标题；每个店铺分配 2 张水印主图。
- `非处方药`：只上架到 01-05 前五个店铺，5 份 Word、20 张主图、20 条标题；每个店铺分配 4 张水印主图。
- `保健食品`：依次上架 01-10 十个店铺，5 份 Word、20 张主图、20 条标题；每个店铺分配 2 张水印主图。

标题统一规则：标题前半部分只由飞书 `标题关键词` 随机排列组合而成，不允许修改、替换、截断、引申或增加相近词；每条标题追加飞书 `标题固定后缀`，完整标题尽量接近 120 个字符且不得超过 120 个字符。

主图提示词统一规则：每份 Word 为飞书五段式内容，依次是 `主图指令`、`产品卖点`、当前轮 `DeepSeek提示词`、`正向提示词`、`反向提示词`。项目不再使用内部固定主图模板或内部差异化提示词。

价格库存统一规则：飞书 `产品价格` 必须正好填写 4 个价格并按从大到小顺序排列，发布时从上往下填入 4 行价格库存，库存统一填写 2000。

该 Mac Feishu job 默认设置 `cleanupSourceImageAfterPublish=true`，每个产品完成后会删除当前已完成产品对应的飞书下载附件、标题表、Word 文档、运行目录、店铺产品文件夹等中间文件，只保留归档后的无水印主图。同一批次中尚未处理的飞书白底图和资质附件必须作为 protected asset 保留，不能被单个产品清理动作删除。真实流程全部产品成功完成后，才清扫 `input/auto-listing` 下所有过时历史产物，包括旧批次白底图、资质附件、标题表、主图工作目录产物、店铺商品产物和自动生成的断点恢复 job，避免零星残留影响下一次运行。

无水印主图归档路径固定为：

```bash
/Users/mfrank/Desktop/FFC的文件夹/工作/001电商/2026AI主图/<yyyyMMddHHmm><用户认知名>/
```

标题关键词来自飞书 `标题关键词` 字段，脚本只做类目规则内的排列组合。

真实流程的生图 provider 已切换为 OpenAI-compatible 中转站 `gpt-image-2`。本地密钥和接口配置放在 `input/image-generation.config.json`，该文件被 `.gitignore` 忽略；仓库只提交 `input/image-generation.config.example.json`。如果运行时报余额、额度或计费不足，需要先给中转站账号充值。

这条链路不使用 ChatGPT 网页端，因此不应消耗 GPT Plus 会员消息额度。项目运行时会拦截 `chatgpt.com` 和 `chat.openai.com` 这类 ChatGPT/Plus 网页域名；OpenAI-compatible 图片接口或中转站接口属于 API/中转站计费，不等同于 GPT Plus 会员额度。

真实流程仍会消耗飞书开放平台调用额度、附件下载流量、中转站生图额度，以及抖店浏览器账号会话资源。启动器会把真实流程放到后台运行，并通过状态命令返回结果摘要。

运行全流程前先检查：

```bash
npm run doctor:feishu
npm run doctor:auto-listing -- --require-image-generation --image-generation-provider openai-compatible --image-generation-config ./input/image-generation.config.json
npm run audit:auto-listing
```

如果 `doctor:feishu` 报 `invalidRecords`，需要先补齐飞书表格里的缺失字段或附件。

`audit:auto-listing` 是只读审计命令，不会启动项目控制器、不会调用飞书下载、不会发布商品。它会检查：

- `data/feishu/products.json` 里的产品总数和待处理数量。
- `data/auto-listing/processed-images.json` 里当前飞书批次的已完成源图。
- `input/auto-listing/feishu-images` 和 `input/auto-listing/qualifications` 是否仍保留待处理产品素材。
- 最新运行如果还在进行，当前发现的任务数是否少于应处理的待处理产品数。
- 已完成主图生成阶段的任务是否满足类目计划：每个 Word 提示词 4 张，所有类目总计 20 张。
- 已进入发布阶段的店铺产品文件夹是否都有安全发布信号；安全信号只能来自发布结果或 `publish-manifest.json` 中的 `published + publish_signal_confirmed/list_verified`。
