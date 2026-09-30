# apps/api —— hono HTTP + ws + pg-boss worker，一个进程三个入口。
#
# 基础镜像固定到 engines.node 的下限版本本身（24.21.0）而不是 `24`：
# 「本地 24.13 绿、CI/生产 24.x 红」这类差异是最难复现的一类故障。
FROM node:24.21.0-bookworm-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production

RUN corepack enable
WORKDIR /app

# 先只拷依赖清单：改一行源码不该让依赖层失效。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/contract/package.json packages/contract/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/safety/package.json packages/safety/
COPY packages/prompts/package.json packages/prompts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# --frozen-lockfile：镜像里装的必须与 lockfile 逐字一致（T-03-SC）。
RUN pnpm install --frozen-lockfile --filter @drift/api...

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
# 隐私政策与服务条款正文。**运行时必需**：consent_event.policy_version 是
# apps/web/content/legal/privacy.md 的内容哈希，而 apps/api/src/modules/auth/register.ts
# 在模块加载期就读它（缺失即抛错、进程起不来 —— 那是刻意的 fail-loud，因为一个伪造的
# policy_version 会让每条同意留证指向一份不存在的政策文本）。只拷 content/，不拷整个
# apps/web：前端构建产物与 node_modules 与本镜像无关。
COPY apps/web/content/ apps/web/content/

# 导出文件目录（PRIV-04）。7 天 TTL 清理在 Plan 11 Task 3 作用于这个目录。
RUN mkdir -p /var/lib/drift/exports && chown -R node:node /var/lib/drift

# 构建上下文里的文件模式会被 COPY 原样带进镜像，而 pnpm 12 把 pnpm-lock.yaml 与
# pnpm-workspace.yaml 写成 **0600**。于是 `USER node` 读不到它们，容器起来就报
# `Failed to read pnpm-workspace.yaml: Permission denied (os error 13)`。
# 这个坑只在「构建上下文来自 pnpm 跑过的工作树」时出现 —— git 只存可执行位，
# 所以 CI 里的全新 clone 拿到的是 0644，**复现不了**。故这里不依赖宿主模式，
# 显式放开读权限（目录补 x）。
RUN chmod -R a+rX /app

USER node
EXPOSE 3001
WORKDIR /app/apps/api

# 源码直连：Node 24 原生剥离类型，不预构建（与 packages/* 的 exports 同一策略）。
# 因此 apps/api 的 import specifier 写的是实际存在的 .ts 路径 —— Node 不会把
# './x.js' 改写成 './x.ts'。
CMD ["node", "src/index.ts"]
