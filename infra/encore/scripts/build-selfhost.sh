#!/bin/sh
set -eu

cd "$(dirname "$0")/../../.."
docker_arch="$(docker info --format '{{.Architecture}}')"
case "$docker_arch" in
  arm64 | aarch64) target_arch=arm64 ;;
  *) target_arch=amd64 ;;
esac
encore build docker hestia-encore:local --arch "$target_arch" --config infra/encore/encore.infra.json

# Encore exports through /var/run/docker.sock. Docker Desktop/OrbStack contexts
# can point the CLI at another daemon, so make the freshly built image visible
# to the active Compose context when their image IDs differ.
encore_image_id="$(docker -H unix:///var/run/docker.sock image inspect hestia-encore:local --format '{{.Id}}')"
active_image_id="$(docker image inspect hestia-encore:local --format '{{.Id}}' 2>/dev/null || true)"
if [ "$encore_image_id" != "$active_image_id" ]; then
  docker -H unix:///var/run/docker.sock image save hestia-encore:local | docker image load >/dev/null
fi

active_image_id="$(docker image inspect hestia-encore:local --format '{{.Id}}')"
[ "$encore_image_id" = "$active_image_id" ] || {
  echo "Encore image is not available in the active Docker context" >&2
  exit 1
}
