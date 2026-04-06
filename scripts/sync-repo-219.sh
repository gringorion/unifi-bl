#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_NAME="${SYNC_219_REMOTE_NAME:-forgejo-219}"
REMOTE_URL="${SYNC_219_REMOTE_URL:-http://192.168.40.219:3000/Nico/unifi-bl.git}"
TARGET_BRANCH="${SYNC_219_BRANCH:-$(git -C "$ROOT_DIR" branch --show-current)}"

if [[ -z "$TARGET_BRANCH" ]]; then
  echo "Unable to determine the current git branch." >&2
  exit 1
fi

if ! git -C "$ROOT_DIR" diff --quiet --ignore-submodules --; then
  echo "Refusing to sync $REMOTE_URL: tracked files are modified. Commit the version change first." >&2
  exit 1
fi

if ! git -C "$ROOT_DIR" diff --cached --quiet --ignore-submodules --; then
  echo "Refusing to sync $REMOTE_URL: staged changes are still pending commit." >&2
  exit 1
fi

if [[ -n "$(git -C "$ROOT_DIR" ls-files --others --exclude-standard)" ]]; then
  echo "Refusing to sync $REMOTE_URL: untracked files are present. Add them or ignore them first." >&2
  exit 1
fi

WORKTREE_VERSION="$(
  sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$ROOT_DIR/package.json" | head -n 1
)"
HEAD_VERSION="$(
  git -C "$ROOT_DIR" show HEAD:package.json | sed -n 's/.*"version": "\([^"]*\)".*/\1/p' | head -n 1
)"

if [[ -z "$WORKTREE_VERSION" || -z "$HEAD_VERSION" ]]; then
  echo "Unable to read the package.json version." >&2
  exit 1
fi

if [[ "$WORKTREE_VERSION" != "$HEAD_VERSION" ]]; then
  echo "Refusing to sync $REMOTE_URL: package.json version must be committed before pushing." >&2
  exit 1
fi

CURRENT_URL="$(git -C "$ROOT_DIR" remote get-url "$REMOTE_NAME" 2>/dev/null || true)"
if [[ -z "$CURRENT_URL" ]]; then
  git -C "$ROOT_DIR" remote add "$REMOTE_NAME" "$REMOTE_URL"
elif [[ "$CURRENT_URL" != "$REMOTE_URL" ]]; then
  git -C "$ROOT_DIR" remote set-url "$REMOTE_NAME" "$REMOTE_URL"
fi

git -C "$ROOT_DIR" push "$REMOTE_NAME" "HEAD:refs/heads/$TARGET_BRANCH"

echo "Synced version $WORKTREE_VERSION to $REMOTE_URL on branch $TARGET_BRANCH."
