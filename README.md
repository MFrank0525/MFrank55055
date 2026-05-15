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

```powershell
npm run business:doubao -- --job .\input\doubao-job.example.json
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

```powershell
npm run business:publish -- --job .\input\publish-from-spu.job.example.json
```

独立输入样例：
- `input/publish-from-spu.job.example.json`

## 兼容入口

`npm run task` 仍然保留，但只作为旧任务文件兼容层。

不建议新流程继续使用：

```powershell
npm run task:legacy -- --taskFile .\input\legacy\task.publish-from-spu.flow.inspect.json
```

## 安装

```powershell
npm install
npx playwright install chromium
```

## 目录

- `src/doubao`: 豆包业务实现
- `src/business/publish-from-spu.ts`: SPU 发布业务实现
- `src/legacy-task`: 旧统一任务入口兼容层
- `src/cli/doubao-run.ts`: 豆包独立 CLI
- `src/cli/publish-from-spu.ts`: SPU 发布独立 CLI
- `docs/TASK_INTERFACE.md`: 旧任务入口兼容说明
