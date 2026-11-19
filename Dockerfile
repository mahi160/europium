FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@12.14.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
COPY tsconfig.json vite.config.ts ./

FROM dependencies AS frontend
RUN pnpm --filter @office-service/web build

FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json ./package.json
COPY --from=dependencies /app/tsconfig.json ./tsconfig.json
COPY --from=dependencies /app/apps/api ./apps/api
COPY --from=dependencies /app/packages/shared ./packages/shared
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/api/src/server.ts"]

FROM caddy:2.11.7-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /app/apps/web/dist /srv
