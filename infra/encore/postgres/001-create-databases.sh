#!/bin/sh
set -eu

: "${HESTIA_DB_PASSWORD:?HESTIA_DB_PASSWORD must be set}"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=hestia_password="$HESTIA_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE hestia LOGIN PASSWORD %L', :'hestia_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hestia') \gexec

SELECT format('CREATE DATABASE %I OWNER hestia', database_name)
FROM (VALUES
  ('hestia_home_core'),
  ('hestia_integration_hub'),
  ('hestia_automation'),
  ('hestia_identity'),
  ('hestia_notifications'),
  ('hestia_energy'),
  ('hestia_mcp_gateway')
) AS databases(database_name)
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = database_name) \gexec
SQL
