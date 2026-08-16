FROM node:24-slim
# node-pty（dsh 依赖）无 linux-x64 预编译，需原生编译工具链
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# npm 的 bin 链接（/usr/local/bin/dsh → lib/bin.js，自带 env-node shebang）
# 在 Linux 上开箱可用——不需要 wrapper（那是 Windows .cmd 垫片的专属问题；
# 此前手写 wrapper 的 printf 在 Dockerfile 引号层被啃坏反而覆盖了正确链接）。
RUN npm install -g @deepseek-ai/dsh@0.1.0-rc.6 \
 && test -x /usr/local/bin/dsh \
 && dsh --version
WORKDIR /ws
