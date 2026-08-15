# Local development

## Prerequisites

- Node 24+
- pnpm 10+
- Docker

`psql` is optional. Without it, `pnpm dev` still starts Compose and the apps; schema bootstrap is skipped.

## Start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

| Surface | URL |
| --- | --- |
| Web | http://localhost:5173 |
| edge-api | http://localhost:3000/health |
| Temporal UI | http://localhost:8080 |
| MinIO console | http://localhost:9001 |
| NATS monitor | http://localhost:8222 |

## Prove durability

1. Open the web app and run **Run durable ping**.
2. While the workflow is `running`, stop the automation worker.
3. Start it again (`pnpm --filter @hestia/workers-automation dev`).
4. The workflow completes. Temporal UI shows the same workflow id.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
```
