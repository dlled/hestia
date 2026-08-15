FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @hestia/workers-mqtt... build
RUN pnpm --filter @hestia/workers-mqtt deploy --prod /opt/worker

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /opt/worker/ ./
USER node
CMD ["node", "dist/worker.js"]
