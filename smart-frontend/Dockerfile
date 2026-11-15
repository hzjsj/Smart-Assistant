# ── 构建阶段：UmiJS 生产构建 ──────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# 依赖先行安装，充分利用镜像层缓存
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com

COPY . .
RUN NODE_ENV=production npm run build

# ── 运行阶段：nginx 托管 dist 并反代后端 ─────────────────────────────
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
