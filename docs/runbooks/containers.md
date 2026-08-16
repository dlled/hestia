# Container deployment

HESTIA ships two production images and one Compose topology:

- `infra/docker/node.Dockerfile` builds the API services and workers into a shared Node 24 image.
- `infra/docker/web.Dockerfile` builds the React application and serves it through nginx.
- `infra/compose/docker-compose.prod.yml` wires the twenty application and infrastructure services together.

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

The native Encore self-host proof uses `infra/encore/docker-compose.yml`. `pnpm encore:test:blackbox` verifies MCP request integrity, signed entity ingestion, and the SC-02 path from a moisture webhook through JetStream, `notifications-worker`, Temporal and the persisted incident timeline. Configure only empty local secrets from `.env.example`; the test uses the built-in observe-only leak playbook and performs no physical action.
