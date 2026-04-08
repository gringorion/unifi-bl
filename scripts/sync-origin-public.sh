#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_NAME="${SYNC_PUBLIC_REMOTE_NAME:-origin}"
REMOTE_URL="${SYNC_PUBLIC_REMOTE_URL:-$(git -C "$ROOT_DIR" remote get-url origin)}"
TARGET_BRANCH="${SYNC_PUBLIC_BRANCH:-$(git -C "$ROOT_DIR" branch --show-current)}"
REFRESH_SCREENSHOT="${SYNC_PUBLIC_REFRESH_SCREENSHOT:-true}"
REQUIRE_SCREENSHOT="${SYNC_PUBLIC_REQUIRE_SCREENSHOT:-false}"
EXPORT_LIST_FILE="${SYNC_PUBLIC_EXPORT_LIST_FILE:-$ROOT_DIR/.public-export-include}"
SCREENSHOT_SOURCE_PATH="${SYNC_PUBLIC_SCREENSHOT_PATH:-}"
PREFER_CI_SCREENSHOT="${SYNC_PUBLIC_PREFER_CI_SCREENSHOT:-true}"
RELEASE_TAG="${SYNC_PUBLIC_RELEASE_TAG:-}"

load_export_paths() {
  if [[ ! -f "$EXPORT_LIST_FILE" ]]; then
    echo "Missing public export list: $EXPORT_LIST_FILE" >&2
    exit 1
  fi

  mapfile -t EXPORT_PATHS < <(
    sed 's/[[:space:]]*#.*$//' "$EXPORT_LIST_FILE" | sed '/^[[:space:]]*$/d'
  )

  if [[ "${#EXPORT_PATHS[@]}" -eq 0 ]]; then
    echo "The public export list is empty: $EXPORT_LIST_FILE" >&2
    exit 1
  fi
}

pick_ci_screenshot() {
  local candidates=()

  if [[ -n "$SCREENSHOT_SOURCE_PATH" ]]; then
    candidates+=("$SCREENSHOT_SOURCE_PATH")
  fi

  if [[ "$PREFER_CI_SCREENSHOT" == "true" ]]; then
    candidates+=(
      "$ROOT_DIR/.run/ci/ui-screenshot.png"
      "$ROOT_DIR/.run/ci/validated-ui-screenshot.png"
    )
  fi

  local candidate=""
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

load_export_paths

infer_github_repository() {
  local remote_url="$1"

  if [[ "$remote_url" =~ ^https://github\.com/([^/]+/[^/.]+)(\.git)?$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  if [[ "$remote_url" =~ ^git@github\.com:([^/]+/[^/.]+)(\.git)?$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

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

mkdir -p "$EXPORT_DIR/docs"

if CI_SCREENSHOT_PATH="$(pick_ci_screenshot)"; then
  cp "$CI_SCREENSHOT_PATH" "$EXPORT_DIR/docs/screenshot.png"
  echo "Integrated the CI screenshot from $CI_SCREENSHOT_PATH into the public export."
elif [[ "$REFRESH_SCREENSHOT" == "true" ]]; then
  if bash "$ROOT_DIR/scripts/update-screenshot.sh" "$EXPORT_DIR/docs/screenshot.png"; then
    echo "Refreshed the public screenshot from the live application."
  elif [[ "$REQUIRE_SCREENSHOT" == "true" ]]; then
    echo "Unable to refresh the public screenshot." >&2
    exit 1
  else
    echo "Warning: unable to refresh the public screenshot, keeping the committed image." >&2
  fi
elif [[ "$REQUIRE_SCREENSHOT" == "true" && ! -f "$EXPORT_DIR/docs/screenshot.png" ]]; then
  echo "A public screenshot is required but none is available." >&2
  exit 1
fi

cat > "$EXPORT_DIR/.gitignore" <<'EOF'
.env
data/
EOF

printf '%s\n' "$WORKTREE_VERSION" > "$EXPORT_DIR/VERSION"

echo "Public export will publish these paths:"
printf ' - %s\n' "${EXPORT_PATHS[@]}"
echo " - VERSION"
echo " - .gitignore"

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
  echo "Public repo already up to date at version $WORKTREE_VERSION."
  exit 0
fi

git -C "$REMOTE_DIR" commit --quiet -m "release $WORKTREE_VERSION"
git -C "$REMOTE_DIR" push --force-with-lease origin "HEAD:refs/heads/$TARGET_BRANCH"

if [[ -n "$RELEASE_TAG" ]]; then
  if ! git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/$RELEASE_TAG" >/dev/null; then
    echo "Local release tag $RELEASE_TAG does not exist." >&2
    exit 1
  fi

  git -C "$ROOT_DIR" push --force-with-lease "$REMOTE_NAME" "refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG"

  if GITHUB_REPOSITORY="$(infer_github_repository "$REMOTE_URL")"; then
    GITHUB_RELEASE_REMOTE_NAME="$REMOTE_NAME" \
    GITHUB_RELEASE_REPOSITORY="$GITHUB_REPOSITORY" \
    bash "$ROOT_DIR/scripts/create-github-release.sh" "$RELEASE_TAG"
  else
    echo "Warning: unable to infer the GitHub repository from $REMOTE_URL, skipping the public release entry." >&2
  fi
fi

echo "Synced public repo version $WORKTREE_VERSION to $REMOTE_URL on branch $TARGET_BRANCH from $SOURCE_SHA."
