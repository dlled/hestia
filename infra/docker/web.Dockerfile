# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN npm install --global pnpm@10.33.2

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=hestia-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter @hestia/web build

FROM nginx:alpine AS runtime

COPY infra/docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=nginx:nginx /workspace/apps/web/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
