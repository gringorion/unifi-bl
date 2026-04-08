#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_BRANCH="${1:-$(git -C "$ROOT_DIR" symbolic-ref --quiet --short HEAD || true)}"
TARGET_PATH="${2:-$ROOT_DIR/docs/screenshot.png}"
COMMIT_NAME="${FORGEJO_SCREENSHOT_COMMIT_NAME:-Forgejo Actions}"
COMMIT_EMAIL="${FORGEJO_SCREENSHOT_COMMIT_EMAIL:-forgejo-actions@local}"
COMMIT_MESSAGE="${FORGEJO_SCREENSHOT_COMMIT_MESSAGE:-docs: refresh screenshot [skip ci]}"

if [[ -z "$TARGET_BRANCH" ]]; then
  echo "Skipping the private screenshot commit: the checkout is detached." >&2
  exit 0
fi

bash "$ROOT_DIR/scripts/promote-ci-screenshot.sh" "$TARGET_PATH"

if git -C "$ROOT_DIR" diff --quiet -- "$TARGET_PATH"; then
  echo "The private screenshot is already up to date at $TARGET_PATH."
  exit 0
fi

git -C "$ROOT_DIR" config user.name "$COMMIT_NAME"
git -C "$ROOT_DIR" config user.email "$COMMIT_EMAIL"
git -C "$ROOT_DIR" add "$TARGET_PATH"

if git -C "$ROOT_DIR" diff --cached --quiet -- "$TARGET_PATH"; then
  echo "The private screenshot did not produce a staged change."
  exit 0
fi

git -C "$ROOT_DIR" commit -m "$COMMIT_MESSAGE"
git -C "$ROOT_DIR" pull --rebase origin "$TARGET_BRANCH"
git -C "$ROOT_DIR" push origin "HEAD:refs/heads/$TARGET_BRANCH"

echo "Committed and pushed the refreshed private screenshot to $TARGET_BRANCH."
