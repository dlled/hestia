#!/bin/sh
set -eu

: "${HESTIA_DB_PASSWORD:?HESTIA_DB_PASSWORD is required}"
: "${TEMPORAL_DB_PASSWORD:?TEMPORAL_DB_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=hestia_password="$HESTIA_DB_PASSWORD" \
  --set=temporal_password="$TEMPORAL_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE hestia LOGIN PASSWORD %L', :'hestia_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hestia')
\gexec

SELECT 'CREATE DATABASE hestia OWNER hestia'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'hestia')
\gexec

SELECT format('CREATE ROLE temporal LOGIN PASSWORD %L', :'temporal_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'temporal')
\gexec

SELECT 'CREATE DATABASE temporal OWNER temporal'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'temporal')
\gexec

SELECT 'CREATE DATABASE temporal_visibility OWNER temporal'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'temporal_visibility')
\gexec
SQL
