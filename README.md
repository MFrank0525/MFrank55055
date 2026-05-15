# Douyin Business Automation

这个仓库现在按两条独立业务线运行，不建议再用统一任务入口。

## 业务入口

### 1. 豆包业务

用途：
- 上传图片到豆包
- 提交提示词
- 抓取回答
- 落地 CSV 和结果 JSON

执行：

```bash
npm run business:doubao -- --job ./input/doubao-job.example.json
```

独立输入样例：
- `input/doubao-job.example.json`

### 2. SPU 发布业务

用途：
- 读取商品文件夹素材和表格
- 查询抖店后台 SPU
- 打开商品发布页
- 自动填写固定字段、图片、规格、价格库存
- 输出截图和结构化结果

执行：

```bash
npm run business:publish -- --job ./input/publish-from-spu.job.example.json
```

独立输入样例：
- `input/publish-from-spu.job.example.json`

## 兼容入口

`npm run task` 仍然保留，但只作为旧任务文件兼容层。

不建议新流程继续使用：

```bash
npm run task:legacy -- --taskFile ./input/legacy/task.publish-from-spu.flow.inspect.json
```

## 安装

macOS 推荐先确认 Node.js 已安装，然后在仓库根目录执行：

```bash
npm install
npx playwright install chromium
npm run doctor
```

`npm run doctor` 会检查依赖、Playwright Chromium、示例 JSON 和常用输入目录。

专项检查：

```bash
npm run doctor:publish
npm run doctor:auto-listing
npm run doctor:all
```

默认 `doctor` 只检查基础环境，不检查真实商品目录、Dreamina、Pillow、商品信息表等专项业务资料。

可选环境变量：
- `PYTHON_BIN`：指定 Python 命令，默认 macOS/Linux 使用 `python3`
- `DREAMINA_BIN`：指定 Dreamina CLI 路径，默认优先查 `/opt/homebrew/bin/dreamina`
- `DREAMINA_SKILL_DIR`：指定 dreamina-cli skill 目录，目录下应包含 `scripts/image2image.py` 等 wrapper

自动上架的本地水印依赖 Python Pillow。如 `npm run doctor:auto-listing` 提示缺失，可安装：

```bash
python3 -m pip install pillow
```

## 本机运行准备

示例 job 使用相对路径，默认从仓库根目录解析。

豆包业务运行前：
- 把要上传的图片放到 `input/images/`
- 确认提示词文件是 `input/doubao-prompt.txt`
- 结果会写到 `output/doubao/` 和 `output/doubao-run-result.json`

SPU 发布业务运行前：
- 把 `input/publish-from-spu.job.example.json` 里的 `shopFolder` 和 `productFolder` 改成真实商品目录
- 如果只想打开或查询页面，先把 `mode` 改成对应模式再运行

自动上架业务运行前：
- 把素材放到 `input/auto-listing/` 下对应目录
- 把商品信息表保存为 `input/auto-listing/product-info.xlsx`
- 如需调用 Dreamina，先配置 `DREAMINA_BIN` 和 `DREAMINA_SKILL_DIR`

## 目录

- `src/doubao`: 豆包业务实现
- `src/business/publish-from-spu.ts`: SPU 发布业务实现
- `src/legacy-task`: 旧统一任务入口兼容层
- `src/cli/doubao-run.ts`: 豆包独立 CLI
- `src/cli/publish-from-spu.ts`: SPU 发布独立 CLI
- `docs/TASK_INTERFACE.md`: 旧任务入口兼容说明
