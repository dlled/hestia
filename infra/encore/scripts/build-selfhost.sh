#!/bin/sh
set -eu

cd "$(dirname "$0")/../../.."
docker_arch="$(docker info --format '{{.Architecture}}')"
case "$docker_arch" in
  arm64 | aarch64) target_arch=arm64 ;;
  *) target_arch=amd64 ;;
esac

# On macOS, /var/run/docker.sock can remain linked to an inactive runtime
# (for example OrbStack) while Docker Desktop owns the selected context. Build
# directly against the active context so Encore and Compose share one daemon.
active_docker_host="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}"
DOCKER_HOST="$active_docker_host" encore build docker hestia-encore:local \
  --arch "$target_arch" \
  --config infra/encore/encore.infra.json

docker image inspect hestia-encore:local >/dev/null
