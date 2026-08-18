# Container deployment

HESTIA ships two production images and two Compose topologies:

- `infra/docker/node.Dockerfile` builds the API services and workers into a shared Node 24 image.
- `infra/docker/web.Dockerfile` builds the React application and serves it through nginx.
- `infra/compose/docker-compose.prod.yml` wires the twenty application and infrastructure services together.
- `infra/encore/docker-compose.yml` runs the native Encore image with PostgreSQL domain databases, NATS JetStream, Temporal and the same web image. Its nginx configuration proxies application API requests directly to Encore.

Both runtime images use unprivileged users. Only the web application and edge API publish host ports, bound to loopback by default.

## Configure

Copy the interpolation contract and fill every empty secret locally:

```bash
cp infra/compose/.env.example infra/compose/.env
```

Never commit `infra/compose/.env`. Compose derives the internal application database URL from `HESTIA_DB_PASSWORD`; individual service examples keep `DATABASE_URL` empty so an external runtime can inject it.

## Build and start

```bash
docker compose \
  --env-file infra/compose/.env \
  -f infra/compose/docker-compose.prod.yml \
  up --build --detach --wait
```

The default local endpoints are:

| Surface | URL |
| --- | --- |
| Web | http://127.0.0.1:5173 |
| Edge API health | http://127.0.0.1:3000/health |

## Stop

```bash
docker compose \
  --env-file infra/compose/.env \
  -f infra/compose/docker-compose.prod.yml \
  down
```

Add `--volumes` only when intentionally discarding PostgreSQL, NATS, and MinIO data.

## Validate the contracts

```bash
pnpm test:infra
pnpm test:runtime
pnpm test:blackbox:phase1
pnpm test:blackbox:phase2
pnpm test:blackbox:phase3
```

The first check validates env examples, image policies, and the complete Compose service list. The second starts every built Node entrypoint that does not require external infrastructure.
The Phase 1 black-box check builds the full stack, discovers a simulated Home Assistant entity and its area/device registries through authenticated REST and WebSocket APIs, materializes both event lanes through JetStream and PostgreSQL, restarts `home-core` and `integration-hub`, and verifies stable entity/topology identities plus the persisted integration checkpoint through `edge-api`. Phase 2 adds durable plan execution, approval, observed-state verification, worker loss, and audit recovery. Phase 3 starts from natural language and crosses the isolated model gateway before exercising the same deterministic control plane. Temporary containers and volumes are removed automatically.

## Encore self-hosted image

Build the Encore application into the local Docker runtime before starting `infra/encore/docker-compose.yml`:

```bash
pnpm encore:build:selfhost
docker compose --env-file .env -f infra/encore/docker-compose.yml up --build --detach
```

The build script resolves Docker's active context and passes its endpoint to Encore. Encore keeps a local background daemon; after switching between Docker Desktop, OrbStack, or another runtime, stop the old `encore daemon` process and rerun the build so the new daemon inherits the active Docker endpoint.

The web service publishes port `5173` by default and proxies `/api`, `/health`, and `/ready` to the `hestia` Encore container. For the disposable browser identity acceptance test, inject the same test-only `IDENTITY_BOOTSTRAP_CODE` into the Compose stack and test process, then run:

```bash
HESTIA_WEB_URL=http://localhost:5173 \
IDENTITY_BOOTSTRAP_CODE='<test-only bootstrap value>' \
pnpm encore:test:identity-browser
```

The test creates the first owner, so never aim it at a persistent home database.
