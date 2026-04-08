#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_REF="${1:-}"
OUTPUT_PATH="${2:-$ROOT_DIR/.run/ci/validated-ui-screenshot.png}"

if [[ -z "$IMAGE_REF" ]]; then
  echo "Usage: bash scripts/capture-public-screenshot.sh <image-ref> [output-path]" >&2
  exit 1
fi

ENV_PATH="$(mktemp)"
DATA_DIR="$(mktemp -d)"
CONTAINER_NAME="unifi-bl-public-screenshot-$RANDOM-$$"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$ENV_PATH"
  rm -rf "$DATA_DIR"
}

trap cleanup EXIT

cp "$ROOT_DIR/.env.example" "$ENV_PATH"

upsert_env() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" "$ENV_PATH"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_PATH"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_PATH"
  fi
}

upsert_env PORT "8080"
upsert_env APP_TITLE "UniFi Blocklists CI"
upsert_env APP_AUTH_USERNAME "gringorion"
upsert_env APP_AUTH_PASSWORD "ci-password"
upsert_env APP_AUTH_PASSWORD_SEED "ci-password-seed"
upsert_env ALLOW_INSECURE_TLS "false"
upsert_env UNIFI_NETWORK_BASE_URL "https://192.0.2.1/proxy/network/integration/v1"
upsert_env UNIFI_NETWORK_API_KEY "ci-fake-unifi-api-key"
upsert_env UNIFI_SITE_ID "ci-site"
upsert_env UNIFI_BLOCKLISTS_MAX_ENTRIES "4000"
upsert_env UNIFI_FIREWALL_POLICY_NAME "unifi-bl - block enabled lists"

bash "$ROOT_DIR/scripts/seed-screenshot-data.sh" dir "$DATA_DIR"

docker run -d \
  --name "$CONTAINER_NAME" \
  --env-file "$ENV_PATH" \
  -p "127.0.0.1::8080" \
  "$IMAGE_REF" >/dev/null

docker exec "$CONTAINER_NAME" sh -lc 'mkdir -p /app/data'
docker cp "$DATA_DIR/blocklists.json" "$CONTAINER_NAME:/app/data/blocklists.json"

ci_host_port="$(
  docker port "$CONTAINER_NAME" 8080/tcp |
    head -n 1 |
    sed -E 's/.*:([0-9]+)$/\1/'
)"

[[ -n "$ci_host_port" ]] || {
  echo "Unable to determine the mapped host port for $IMAGE_REF." >&2
  exit 1
}

for attempt in $(seq 1 30); do
  running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")"
  echo "Screenshot prep attempt ${attempt}: running=${running}"

  if [[ "$running" != "true" ]]; then
    echo "Screenshot container exited before it became ready." >&2
    docker logs "$CONTAINER_NAME" || true
    exit 1
  fi

  if docker exec "$CONTAINER_NAME" sh -lc "
    if command -v wget >/dev/null 2>&1; then
      wget -qO- 'http://127.0.0.1:8080/api/health' >/tmp/unifi-health.json
    elif command -v curl >/dev/null 2>&1; then
      curl -fsS 'http://127.0.0.1:8080/api/health' >/tmp/unifi-health.json
    else
      exit 1
    fi
  "; then
    break
  fi

  if [[ "$attempt" -eq 30 ]]; then
    echo "Timed out while waiting for the screenshot container to become ready." >&2
    docker logs "$CONTAINER_NAME" || true
    exit 1
  fi

  sleep 2
done

CI_SCREENSHOT_PORT="$ci_host_port" bash "$ROOT_DIR/scripts/capture-ci-screenshot.sh" "$OUTPUT_PATH"

echo "Prepared a public screenshot from $IMAGE_REF at $OUTPUT_PATH."
