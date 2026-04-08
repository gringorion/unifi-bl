#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_KIND="${1:-}"
TARGET_PATH="${2:-}"

if [[ -z "$TARGET_KIND" || -z "$TARGET_PATH" ]]; then
  echo "Usage: bash scripts/seed-screenshot-data.sh <dir|container> <target>" >&2
  exit 1
fi

case "$TARGET_KIND" in
  dir)
    mkdir -p "$TARGET_PATH"
    bash "$ROOT_DIR/scripts/generate-screenshot-seed.sh" "$TARGET_PATH/blocklists.json"
    echo "Seeded screenshot data into $TARGET_PATH."
    ;;
  container)
    temp_dir="$(mktemp -d)"

    cleanup() {
      rm -rf "$temp_dir"
    }

    trap cleanup EXIT

    bash "$ROOT_DIR/scripts/generate-screenshot-seed.sh" "$temp_dir/blocklists.json"
    docker exec "$TARGET_PATH" sh -lc 'mkdir -p /app/data'
    docker cp "$temp_dir/blocklists.json" "$TARGET_PATH:/app/data/blocklists.json"
    echo "Seeded screenshot data into container $TARGET_PATH."
    ;;
  *)
    echo "Unsupported target kind: $TARGET_KIND" >&2
    exit 1
    ;;
esac
