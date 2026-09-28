# apps/web —— Next 16，只做 UI（STACK §1：不承载 WS 与任务队列）。
#
# 单阶段而不是多阶段：v1 是 10 人体量的单机部署，镜像大几百 MB 换来的是
# 少一层「构建产物拷漏了」的失败模式。真要瘦身，改 output: 'standalone'。
FROM node:24.21.0-bookworm-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/contract/package.json packages/contract/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/safety/package.json packages/safety/
COPY packages/prompts/package.json packages/prompts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @drift/web...

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/

# 浏览器侧可见的 apps/api 地址。NEXT_PUBLIC_* 由 Next 在**构建期**内联进客户端
# bundle（DefinePlugin 语义），运行时塞环境变量改不动产物 —— 缺了它，apps/web/src
# 里五处 fetch 会静默回退到 http://127.0.0.1:3001，也就是「用户自己机器上的 3001
# 端口」。ARG 必须早于使用它的 RUN；ENV 把 build 参数转成构建期环境变量（Next 读的
# 是 process.env，只声明 ARG 不够）。
ARG NEXT_PUBLIC_API_ORIGIN
ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN

WORKDIR /app/apps/web
RUN pnpm exec next build

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# 构建上下文里的文件模式会被 COPY 原样带进镜像，而 pnpm 12 把 pnpm-lock.yaml 与
# pnpm-workspace.yaml 写成 **0600**。于是 `USER node` 读不到它们，容器起来就报
# `Failed to read pnpm-workspace.yaml: Permission denied (os error 13)`。
# 这个坑只在「构建上下文来自 pnpm 跑过的工作树」时出现 —— git 只存可执行位，
# 所以 CI 里的全新 clone 拿到的是 0644，**复现不了**。故这里不依赖宿主模式，
# 显式放开读权限（目录补 x）。
RUN chmod -R a+rX /app

USER node
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start"]
