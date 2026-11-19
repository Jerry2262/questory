---
name: questory-api
description: 读取 Questory 个人周任务日志，一次获取本周或指定周的完整 Markdown。
---

Questory 是个人周任务日志：任务按重要性和紧急程度分在四个象限，可以嵌套。

```bash
curl -fsS 'http://127.0.0.1:5199/api/weeks/current'
```

`GET /api/weeks/{week}`：`current` 指覆盖今天的已记录周；也可传 URL 编码后的界面周标题，例如 `2026%2011.16-11.22`。找不到返回 404。

一次返回整周 Markdown：完整任务树、状态、备注和周总结原文。

### 任务状态

- **未关闭**：尚未完成的事项。
- **已完成**：已经做完的事项。
- **已作废**：已经取消或放弃的事项，无需继续推进。
