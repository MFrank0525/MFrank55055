# Legacy Task Interface

这个文档只描述旧的统一任务入口兼容层：

```bash
npm run task:legacy -- --taskFile ./input/legacy/task.json
```

默认业务执行不要再使用它。默认请改用：

- `npm run business:doubao -- --job <doubao-job.json>`
- `npm run business:publish -- --job <publish-from-spu.job.json>`

## 仍兼容的任务类型

- `doubao.run`
- `publish_from_spu`

## 兼容层作用

- 读取旧任务文件
- 按 `taskType` 转发到现有业务实现
- 继续输出旧格式结果 JSON

## 不建议继续做的事

- 不要新增新的 `taskType`
- 不要把多个业务塞进一个统一任务流
- 不要把它当成默认执行入口

## 迁移建议

旧：

```bash
npm run task:legacy -- --taskFile ./input/legacy/task.doubao.example.json
```

新：

```bash
npm run business:doubao -- --job ./input/doubao-job.example.json
```

旧：

```bash
npm run task:legacy -- --taskFile ./input/legacy/task.publish-from-spu.flow.inspect.json
```

新：

```bash
npm run business:publish -- --job ./input/publish-from-spu.job.example.json
```
