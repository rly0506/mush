# C 盘占用只读扫描报告 · 2026-08-17

- 性质：只读扫描（目录大小统计），未删除、未修改任何文件。
- 结果摘要：`cmd dir C:\` 显示可用空间仅 **12,103,680 bytes（约 11.5 MB）**——
  C 盘接近写满，属紧急状态。
- 扫描方式：Get-ChildItem -Recurse 统计字节（跳过无权限项）；因沙箱限制
  Get-PSDrive/CIM 拒绝访问，总容量未知，仅得到可用字节。

## 候选目录（按大小降序；均未执行任何操作）

| 目录 | 大小 | 可否安全清 | 说明/建议 |
| --- | --- | --- | --- |
| `C:\Users\<user>\AppData\Local\Docker` | ~9.28 GB | ❌ 需你决定 | wsl-data/镜像与容器；建议在 Docker Desktop 内执行 prune 类操作，不可直接删目录 |
| `C:\Users\<user>\.cc-switch` | ~3.6 GB | ❌ 含凭据 | cc-switch 数据库/日志/备份（51k+ 请求日志）；其中含凭据文件，mush 不碰；建议用 cc-switch 自身清理或你手动处理 |
| `C:\Users\<user>\.codex` | ~2.9 GB | ⚠️ 部分 | codex 会话/缓存；目录含配置，删除子目录需你逐项批准 |
| `C:\Users\<user>\AppData\Local\uv\cache` | ~604 MB | ✅ 可再生 | uv 包缓存，删除后按需自动重建 |
| `C:\Users\<user>\.claude` | ~360 MB | ⚠️ 含凭据 | claude 会话/历史/缓存；`.credentials.json` 在列，mush 不碰 |
| `C:\Users\<user>\.zcode` | ~86 MB | ⚠️ 部分 | zcode 插件缓存/会话 |
| `C:\Users\<user>\AppData\Local\Temp` | ~36 MB | ✅ 可再生 | 用户临时目录 |
| `C:\Users\<user>\.dsh` | ~21 MB | ⚠️ 含凭据 | dsh 配置/会话；`.credentials.yaml` 在列 |
| `C:\Windows\SoftwareDistribution\Download` | ~8 MB | ⚠️ 需管理员 | Windows 更新缓存 |
| pip-cache / npm-cache | ~0 | — | 无显著占用 |

## 立即建议（零风险、可再生，但需要你批准后我才执行）

1. **uv cache**（~604 MB）：最快、最安全的释放；
2. **用户 Temp**（~36 MB）+ Windows\Temp（权限允许时）。

其余大项（Docker 9.3GB / cc-switch 3.6GB / codex 2.9GB / claude 360MB）都涉及
凭据、会话或镜像数据，必须由你逐项拍板；我可以先列子目录清单+哈希再执行。

## 硬边界提示

- `D:\意向项目` 与 mush 仓库外一切删除均属触发门 3/4，未经你逐项批准不执行；
- 含凭据目录（.cc-switch/.claude/.dsh 等）我不会读取内容，只做大小统计。
