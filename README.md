# Douyin Business Automation

本仓库保留两条明确入口：SPU 发布业务和飞书全自动上架业务。自动上架由项目调度器执行；Hermes 只负责启动和查询状态。

## 入口

### 飞书全自动上架

用户通过 Hermes / 飞书触发时，只使用启动器：

```bash
npm run auto-listing:hermes-start
```

查询运行状态、成功结果或失败原因：

```bash
npm run auto-listing:hermes-status
```

启动器会快速返回，并把真实流程放到后台运行。它会优先续跑当前失败的真实任务，复用已经生成的提示词、主图、标题和发布产物；没有可续跑任务时才启动完整真实流程。

### SPU 发布业务

```bash
npm run business:publish -- --job ./input/publish-from-spu.job.example.json
```

真实发布类模式必须额外传 `--allow-publish`，避免误触发布。

## 安装

```bash
npm install
npx playwright install chromium
npm run doctor
```

专项检查：

```bash
npm run doctor:publish
npm run doctor:auto-listing
npm run doctor:feishu
npm run doctor:all
```

自动上架的本地水印依赖 Python Pillow。如 `npm run doctor:auto-listing` 提示缺失，可安装：

```bash
python3 -m pip install pillow
```

## 飞书数据源

配置说明见 [docs/FEISHU_BITABLE_SETUP.md](docs/FEISHU_BITABLE_SETUP.md)。

常用检查：

```bash
npm run feishu:check -- --config ./input/feishu-bitable.config.json
npm run feishu:fields -- --config ./input/feishu-bitable.config.json
npm run feishu:assets -- --config ./input/feishu-bitable.config.json --out ./data/feishu/products.json
```

## 自动上架本地文件

真实 Mac 飞书流程的生图配置在本地忽略文件：

```text
input/image-generation.config.json
```

仓库只提交示例：

```text
input/image-generation.config.videos-base64.example.json
```

真实生图链路固定使用 OpenAI-compatible `gpt-image-2` 的 `videos-base64` 模式和 `/v1/videos` 接口，通过 Base64 data URL 元数据传入当前商品白底参考图。

运行数据、浏览器 profile、飞书附件、生成图片、标题表、Word 文档和发布日志都不提交 Git。

## 目录

- `src/cli/hermes-auto-listing-runner.ts`: Hermes 启动器和状态查询
- `src/cli/auto-listing.ts`: 自动上架 CLI
- `src/cli/flow-mac-feishu.ts`: 启动器内部使用的飞书流程编排
- `src/autolist/orchestrator.ts`: 自动上架主调度器
- `src/business/publish-from-spu.ts`: SPU 发布入口
- `docs/auto-listing/README.md`: 自动上架规则总览
