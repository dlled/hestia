#!/bin/sh
set -eu

: "${HESTIA_DB_PASSWORD:?HESTIA_DB_PASSWORD must be set}"
export PGPASSWORD="$HESTIA_DB_PASSWORD"

apply_database() {
  database="$1"
  migrations_dir="$2"
  psql --set=ON_ERROR_STOP=1 --host=postgres --username=hestia --dbname="$database" <<'SQL'
CREATE TABLE IF NOT EXISTS hestia_schema_migration (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL
  for migration in "$migrations_dir"/*.up.sql; do
    [ -f "$migration" ] || continue
    version="$(basename "$migration")"
    applied="$(psql --host=postgres --username=hestia --dbname="$database" --tuples-only --no-align --command="SELECT 1 FROM hestia_schema_migration WHERE version = '$version'")"
    [ "$applied" = "1" ] && continue
    psql --set=ON_ERROR_STOP=1 --single-transaction --host=postgres --username=hestia --dbname="$database" \
      --file="$migration" --command="INSERT INTO hestia_schema_migration (version) VALUES ('$version')"
  done
}

apply_database hestia_home_core /migrations/homecore
apply_database hestia_integration_hub /migrations/integrationhub
apply_database hestia_automation /migrations/automation
apply_database hestia_identity /migrations/identity
apply_database hestia_notifications /migrations/notifications
apply_database hestia_energy /migrations/energy
apply_database hestia_mcp_gateway /migrations/mcpgateway
