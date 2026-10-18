#!/usr/bin/env bash
# Pull the latest main and rebuild/restart the PDF Diff container. No sudo needed
# (the user must be in the docker group). Usage: ~/pdfdiff/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
old_image=$(docker image inspect -f '{{.Id}}' pdfdiff:latest 2>/dev/null || true)

docker compose -f deploy/docker-compose.yml up -d --build

# Remove the previous pdfdiff image if the rebuild replaced it (only that image).
new_image=$(docker image inspect -f '{{.Id}}' pdfdiff:latest)
if [[ -n "$old_image" && "$old_image" != "$new_image" ]]; then
  docker image rm "$old_image" >/dev/null 2>&1 || true
fi

# Wait for the healthcheck, then show status.
for _ in $(seq 1 20); do
  [[ $(docker inspect -f '{{.State.Health.Status}}' pdfdiff) == healthy ]] && break
  sleep 1
done
docker ps --filter name='^pdfdiff$' --format '{{.Names}}  {{.Status}}  {{.Ports}}'
curl -fsS -o /dev/null -w 'http://127.0.0.1:8095/ -> %{http_code}\n' http://127.0.0.1:8095/
