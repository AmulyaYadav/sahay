# Builds the static web bundle; served by Caddy in production.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace packages/shared --workspace apps/web --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG VITE_API_URL=/
RUN npm run build -w packages/shared && VITE_API_URL=$VITE_API_URL npm run build -w apps/web

FROM caddy:2-alpine
COPY --from=build /repo/apps/web/dist /srv/web
COPY ops/Caddyfile /etc/caddy/Caddyfile
