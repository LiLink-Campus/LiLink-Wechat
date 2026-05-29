# syntax=docker/dockerfile:1
#
# LiLink 平台一体化镜像（Next.js 16 + Payload 3.85）
# 多阶段构建，基镜像 node:22-bookworm-slim（Debian/glibc，sharp 预编译二进制可直接用，
# 不像 alpine/musl 需要 libc6-compat）。
#
# 构建上下文 = platform/（见 docker-compose.yml 的 build.context）。
# 流程：deps 装依赖 → builder 编译 next build → runner 用 next start 起服务（端口 3000）。
# 运行镜像额外装 python3：排版功能会调用 scripts/render.py（纯标准库，无需 pip 包）。

############################
# 1) 基础层
############################
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
# 关闭 Next.js 匿名遥测，构建/运行更干净
ENV NEXT_TELEMETRY_DISABLED=1

############################
# 2) 依赖层：仅在 lockfile 变化时才重装，最大化缓存命中
#    这里需要包含 devDependencies（TypeScript / 类型 / eslint-config-next），
#    因为 next build 在编译期需要它们，所以不加 --omit=dev。
############################
FROM base AS deps
# 先只拷贝清单文件，命中 Docker 层缓存
COPY package.json package-lock.json* ./
RUN npm ci

############################
# 3) 构建层：带着 node_modules 拷入全部源码并编译
############################
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 产出 .next 构建结果（采用 next start 模式，非 standalone）
RUN npm run build

############################
# 4) 运行层：装 python3（render.py 排版用），拷入已编译应用，next start 起服务
############################
FROM base AS runner

# 排版脚本 scripts/render.py 依赖 python3（纯标准库实现，故无需 pip 安装额外包）
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

# 非 root 运行：复用基镜像自带的 node 用户（uid/gid 1000）
# 从 builder 整体拷入已构建的应用树（含 node_modules / .next / 源码 / 配置），
# next start 需要这些文件齐全才能正常挂载 Payload 后台与 API。
COPY --from=builder --chown=node:node /app ./

USER node

EXPOSE 3000
# 监听容器所有网卡，便于 compose / 宿主访问
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# package.json 的 start 脚本即 `next start`
CMD ["npm", "run", "start"]
