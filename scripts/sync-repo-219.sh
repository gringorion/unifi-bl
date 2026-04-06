#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_NAME="${SYNC_219_REMOTE_NAME:-forgejo-219}"
REMOTE_URL="${SYNC_219_REMOTE_URL:-http://192.168.40.219:3000/Nico/unifi-bl.git}"
TARGET_BRANCH="${SYNC_219_BRANCH:-$(git -C "$ROOT_DIR" branch --show-current)}"
EXPORT_PATHS=(
  ".env.example"
  "LICENSE"
  "README.md"
  "docker-compose.yml"
  "docs/screenshot.png"
)

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

TMP_DIR="$(mktemp -d)"
EXPORT_DIR="$TMP_DIR/export"
REMOTE_DIR="$TMP_DIR/remote"
SOURCE_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
AUTHOR_NAME="$(git -C "$ROOT_DIR" log -1 --format=%an)"
AUTHOR_EMAIL="$(git -C "$ROOT_DIR" log -1 --format=%ae)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

mkdir -p "$EXPORT_DIR"
git -C "$ROOT_DIR" archive --format=tar HEAD -- "${EXPORT_PATHS[@]}" | tar -xf - -C "$EXPORT_DIR"

cat > "$EXPORT_DIR/.gitignore" <<'EOF'
.env
data/
EOF

printf '%s\n' "$WORKTREE_VERSION" > "$EXPORT_DIR/VERSION"

if git ls-remote --exit-code --heads "$REMOTE_URL" "$TARGET_BRANCH" >/dev/null 2>&1; then
  git clone --quiet --branch "$TARGET_BRANCH" --single-branch "$REMOTE_URL" "$REMOTE_DIR"
else
  git init --quiet "$REMOTE_DIR"
  git -C "$REMOTE_DIR" remote add origin "$REMOTE_URL"
  git -C "$REMOTE_DIR" checkout --quiet -b "$TARGET_BRANCH"
fi

find "$REMOTE_DIR" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
tar -C "$EXPORT_DIR" -cf - . | tar -xf - -C "$REMOTE_DIR"

git -C "$REMOTE_DIR" config user.name "$AUTHOR_NAME"
git -C "$REMOTE_DIR" config user.email "$AUTHOR_EMAIL"
git -C "$REMOTE_DIR" add -A

if git -C "$REMOTE_DIR" diff --cached --quiet --ignore-submodules --; then
  echo "User-facing repo already up to date at version $WORKTREE_VERSION."
  exit 0
fi

git -C "$REMOTE_DIR" commit --quiet -m "release $WORKTREE_VERSION"
git -C "$REMOTE_DIR" push origin "HEAD:refs/heads/$TARGET_BRANCH"

echo "Synced user-facing repo version $WORKTREE_VERSION to $REMOTE_URL on branch $TARGET_BRANCH from $SOURCE_SHA."
