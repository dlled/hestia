# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN npm install --global pnpm@10.33.2

WORKDIR /workspace

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=hestia-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=hestia-pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /workspace

COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps ./apps
COPY --from=build --chown=node:node /workspace/packages ./packages
COPY --chown=node:node package.json pnpm-workspace.yaml ./

USER node

CMD ["node", "apps/edge-api/dist/server.js"]
