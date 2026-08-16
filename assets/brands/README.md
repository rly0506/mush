# 品牌图标资产（assets/brands）

来源：Simple Icons（CC0），2026-08-17 经 cdn.simpleicons.org 拉取，
`fill` 已统一改写为 `currentColor`（随主题着色）。

| 文件 | 犬 | 说明 |
| --- | --- | --- |
| deepseek.svg | deepseek-dsh | 官方小鲸鱼 |
| claude.svg | claude-code | Claude 标记 |
| kimi.svg | kimi（待入册） | Kimi 标记 |
| anthropic.svg | （备用） | Anthropic 字标 |
| opencode.svg | opencode | OpenCode 标记 |

**兜底链**：页面按 `assets/brands/<adapter>.svg` 是否存在决定官方图标或
手绘内联标记——**将来新增官方图标只需把 SVG 丢进本目录**（如 openai.svg
到位后 codex 自动切换），无需改代码。zcode/codex 暂用手绘。

红线合规：资产在仓、运行时由本机看板自供（127.0.0.1），零外部请求。
