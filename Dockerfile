# Cloud Run：單一容器同時提供 API + WebSocket + 建置好的前端
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @chick/engine test \
 && pnpm --filter @chick/web build \
 && pnpm --filter @chick/server build \
 && pnpm --filter @chick/server deploy --prod --legacy /out

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/web
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./web
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
