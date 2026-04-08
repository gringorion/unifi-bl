#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${1:-$ROOT_DIR/docs/screenshot.png}"
SCREENSHOT_SOURCE_PATH="${SCREENSHOT_SOURCE_PATH:-}"

pick_source_screenshot() {
  local candidates=()

  if [[ -n "$SCREENSHOT_SOURCE_PATH" ]]; then
    candidates+=("$SCREENSHOT_SOURCE_PATH")
  fi

  candidates+=(
    "$ROOT_DIR/.run/ci/ui-screenshot.png"
    "$ROOT_DIR/.run/ci/validated-ui-screenshot.png"
  )

  local candidate=""
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

SOURCE_PATH="$(pick_source_screenshot || true)"

if [[ -z "$SOURCE_PATH" ]]; then
  echo "Unable to find a CI screenshot to promote." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"
cp "$SOURCE_PATH" "$OUTPUT_PATH"

echo "Promoted $SOURCE_PATH to $OUTPUT_PATH."
