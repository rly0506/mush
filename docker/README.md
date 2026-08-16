# mush-dsh Docker 镜像（路线 B：WSL 替代方案）

背景：WSL Ubuntu 在本机无法启动（Wsl/Service/E_UNEXPECTED，wsl --update 被代理
403 拦截，见 AD-12 前后对话记录）；Docker Desktop（WSL 后端）正常。本镜像提供
"容器内 dsh"作为 DeepSeek 犬的 Linux 运行环境。

## 构建（已构建：mush-dsh:local）

```bash
docker build -f docker/dsh.Dockerfile -t mush-dsh:local docker/
```

要点：dsh 的 npm 包未配置 bin 链接（`which dsh` 找不到），镜像内以 wrapper
暴露其真实入口 `node /usr/local/lib/node_modules/dsh/dsh.js`。

## 使用

```bash
# 无凭据冒烟（不花钱）
docker run --rm mush-dsh:local dsh --version

# 真实 dispatch（key 经环境变量注入，不落盘不入库；Git Bash 需 MSYS_NO_PATHCONV=1）
MSYS_NO_PATHCONV=1 docker run --rm -e DEEPSEEK_API_KEY \
  -v "D:\mush:/ws" -w /ws mush-dsh:local \
  dsh --profile headless "任务文本"
```

## 已知差异（F-29）

在 Linux 容器内 `npm test` 有 4 个失败，均为 Windows 专属语义在 Linux 的预期
差异，非新缺陷：

1. reparse/junction 检测 ×2（Linux 无此原语；语义模型按 D16/AD-04 处理）；
2. `bin/mush status` 在非 mush 目录的断言（路径形态差异）；
3. commit-phase 超时状态机：慢环境下 agent-settle 与 process 超时的竞态
   （黄金参照 epoch50 同类事故模式，值得在 M2+ 收紧确定性）。

Windows 本机基线仍为权威：**182/182 pass**。CI/跨平台测试留待后续 Goal。
