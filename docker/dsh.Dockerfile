FROM node:24-slim
RUN npm install -g dsh --silent
# dsh package lacks an npm bin link; expose its entry via wrapper
RUN printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/dsh/dsh.js "$@"\n' > /usr/local/bin/dsh \
    && chmod +x /usr/local/bin/dsh \
    && dsh --version
WORKDIR /ws
