# Sahay API + worker image (worker runs the same image with a different command).
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN npm ci --workspace packages/shared --workspace server --include-workspace-root=false
COPY packages/shared packages/shared
COPY server server
RUN npm run build -w packages/shared && npm run build -w server

FROM node:22-alpine
ENV NODE_ENV=production
RUN addgroup -S sahay && adduser -S sahay -G sahay
WORKDIR /app
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared/dist node_modules/@sahay/shared/dist
COPY --from=build /repo/packages/shared/package.json node_modules/@sahay/shared/package.json
COPY --from=build /repo/server/dist dist
COPY --from=build /repo/server/migrations migrations
COPY --from=build /repo/server/package.json package.json
USER sahay
EXPOSE 4000
# Migrations are applied by an explicit one-shot task (see docker-compose.prod.yml),
# never implicitly at startup.
CMD ["node", "dist/main.js"]
