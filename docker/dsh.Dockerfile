FROM node:24-slim
# node-pty（dsh 依赖）需原生编译：slim 镜像缺工具链
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @deepseek-ai/dsh@0.1.0-rc.6 \
 && node -e "const p=require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json');console.log('installed:',p.name,p.version)" \
 && printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js "$@"\n' > /usr/local/bin/dsh \
 && chmod +x /usr/local/bin/dsh \
 && dsh --version
WORKDIR /ws
