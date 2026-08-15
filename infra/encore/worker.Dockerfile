# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN --mount=type=cache,id=hestia-pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps ./apps
COPY --from=build --chown=node:node /workspace/packages ./packages
USER node
CMD ["node", "apps/workers-automation/dist/worker.js"]
