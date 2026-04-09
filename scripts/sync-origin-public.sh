#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_NAME="${SYNC_PUBLIC_REMOTE_NAME:-github-public}"
REMOTE_URL="${SYNC_PUBLIC_REMOTE_URL:-$(git -C "$ROOT_DIR" remote get-url "$REMOTE_NAME" 2>/dev/null || true)}"
TARGET_BRANCH="${SYNC_PUBLIC_BRANCH:-$(git -C "$ROOT_DIR" branch --show-current)}"
RELEASE_TAG="${SYNC_PUBLIC_RELEASE_TAG:-}"
SYNC_PUBLIC_AUTH_USERNAME="${SYNC_PUBLIC_AUTH_USERNAME:-}"
SYNC_PUBLIC_AUTH_PASSWORD="${SYNC_PUBLIC_AUTH_PASSWORD:-}"
SYNC_PUBLIC_AUTH_TOKEN="${SYNC_PUBLIC_AUTH_TOKEN:-}"
ALLOW_UNTRACKED="${SYNC_PUBLIC_ALLOW_UNTRACKED:-false}"

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

if [[ -z "$REMOTE_URL" ]]; then
  echo "Missing public GitHub remote URL. Set SYNC_PUBLIC_REMOTE_URL or configure remote $REMOTE_NAME." >&2
  exit 1
fi

if [[ -z "$TARGET_BRANCH" && -z "$RELEASE_TAG" ]]; then
  echo "Unable to determine which branch or tag to sync to $REMOTE_URL." >&2
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

UNTRACKED_FILES="$(git -C "$ROOT_DIR" ls-files --others --exclude-standard)"
if [[ -n "$UNTRACKED_FILES" ]]; then
  if [[ "$ALLOW_UNTRACKED" == "true" ]]; then
    echo "Ignoring untracked files for public sync:"
    while IFS= read -r untracked_path; do
      [[ -n "$untracked_path" ]] || continue
      echo " - $untracked_path"
    done <<<"$UNTRACKED_FILES"
  else
    echo "Refusing to sync $REMOTE_URL: untracked files are present. Add them or ignore them first." >&2
    exit 1
  fi
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

TMP_DIR="$(mktemp -d)"
SOURCE_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
ASKPASS_SCRIPT=""

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

normalize_git_auth() {
  if [[ -n "$SYNC_PUBLIC_AUTH_TOKEN" && -z "$SYNC_PUBLIC_AUTH_PASSWORD" ]]; then
    SYNC_PUBLIC_AUTH_PASSWORD="$SYNC_PUBLIC_AUTH_TOKEN"
  fi

  if [[ -n "$SYNC_PUBLIC_AUTH_PASSWORD" && -z "$SYNC_PUBLIC_AUTH_USERNAME" && "$REMOTE_URL" =~ ^https://github\.com/ ]]; then
    SYNC_PUBLIC_AUTH_USERNAME="git"
    echo "Warning: SYNC_PUBLIC_AUTH_USERNAME was not set for GitHub. Falling back to username 'git'." >&2
  fi

  if [[ -n "$SYNC_PUBLIC_AUTH_PASSWORD" && -z "$SYNC_PUBLIC_AUTH_TOKEN" && "$REMOTE_URL" =~ ^https://github\.com/ ]]; then
    echo "Note: for github.com HTTPS Git operations, the configured password value must be a personal access token, not an account password." >&2
  fi
}

setup_git_auth() {
  if [[ -z "$SYNC_PUBLIC_AUTH_USERNAME" && -z "$SYNC_PUBLIC_AUTH_PASSWORD" ]]; then
    return 0
  fi

  if [[ -z "$SYNC_PUBLIC_AUTH_USERNAME" || -z "$SYNC_PUBLIC_AUTH_PASSWORD" ]]; then
    echo "SYNC_PUBLIC_AUTH_USERNAME and SYNC_PUBLIC_AUTH_PASSWORD must either both be set or both be empty." >&2
    exit 1
  fi

  if [[ ! "$REMOTE_URL" =~ ^https?:// ]]; then
    echo "SYNC_PUBLIC_AUTH_USERNAME and SYNC_PUBLIC_AUTH_PASSWORD currently require an HTTP(S) remote URL." >&2
    exit 1
  fi

  ASKPASS_SCRIPT="$TMP_DIR/git-askpass.sh"
  cat > "$ASKPASS_SCRIPT" <<'EOF'
#!/usr/bin/env sh
case "$1" in
  *sername* )
    printf '%s\n' "$SYNC_PUBLIC_AUTH_USERNAME"
    ;;
  *assword* )
    printf '%s\n' "$SYNC_PUBLIC_AUTH_PASSWORD"
    ;;
  * )
    printf '%s\n' "$SYNC_PUBLIC_AUTH_PASSWORD"
    ;;
esac
EOF
  chmod 700 "$ASKPASS_SCRIPT"
}

run_git_with_auth() {
  if [[ -n "$ASKPASS_SCRIPT" ]]; then
    env \
      GIT_TERMINAL_PROMPT=0 \
      GIT_ASKPASS="$ASKPASS_SCRIPT" \
      SYNC_PUBLIC_AUTH_USERNAME="$SYNC_PUBLIC_AUTH_USERNAME" \
      SYNC_PUBLIC_AUTH_PASSWORD="$SYNC_PUBLIC_AUTH_PASSWORD" \
      git "$@"
    return
  fi

  git "$@"
}

normalize_git_auth
setup_git_auth

CURRENT_URL="$(git -C "$ROOT_DIR" remote get-url "$REMOTE_NAME" 2>/dev/null || true)"
if [[ -z "$CURRENT_URL" ]]; then
  git -C "$ROOT_DIR" remote add "$REMOTE_NAME" "$REMOTE_URL"
elif [[ "$CURRENT_URL" != "$REMOTE_URL" ]]; then
  git -C "$ROOT_DIR" remote set-url "$REMOTE_NAME" "$REMOTE_URL"
fi

if [[ -n "$TARGET_BRANCH" ]]; then
  echo "Syncing the full source branch to GitHub:"
  echo " - branch: $TARGET_BRANCH"
  echo " - commit: $SOURCE_SHA"
  run_git_with_auth -C "$ROOT_DIR" push --force-with-lease "$REMOTE_NAME" "HEAD:refs/heads/$TARGET_BRANCH"
fi

if [[ -n "$RELEASE_TAG" ]]; then
  if ! git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/$RELEASE_TAG" >/dev/null; then
    echo "Local release tag $RELEASE_TAG does not exist." >&2
    exit 1
  fi

  if run_git_with_auth ls-remote --exit-code --tags "$REMOTE_URL" "refs/tags/$RELEASE_TAG" >/dev/null 2>&1; then
    echo "Public tag $RELEASE_TAG already exists on $REMOTE_URL."
  else
    run_git_with_auth -C "$ROOT_DIR" push "$REMOTE_NAME" "refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG"
  fi

  if GITHUB_REPOSITORY="$(infer_github_repository "$REMOTE_URL")"; then
    GITHUB_RELEASE_REMOTE_NAME="$REMOTE_NAME" \
    GITHUB_RELEASE_REMOTE_URL="$REMOTE_URL" \
    GITHUB_RELEASE_REPOSITORY="$GITHUB_REPOSITORY" \
    GITHUB_RELEASE_USERNAME="$SYNC_PUBLIC_AUTH_USERNAME" \
    GITHUB_RELEASE_PASSWORD="$SYNC_PUBLIC_AUTH_PASSWORD" \
    GITHUB_RELEASE_TOKEN="$SYNC_PUBLIC_AUTH_TOKEN" \
    bash "$ROOT_DIR/scripts/create-github-release.sh" "$RELEASE_TAG"
  else
    echo "Warning: unable to infer the GitHub repository from $REMOTE_URL, skipping the public release entry." >&2
  fi
fi

if [[ -n "$TARGET_BRANCH" && -n "$RELEASE_TAG" ]]; then
  echo "Synced the full source branch $TARGET_BRANCH and release tag $RELEASE_TAG to $REMOTE_URL from $SOURCE_SHA."
elif [[ -n "$TARGET_BRANCH" ]]; then
  echo "Synced the full source branch $TARGET_BRANCH to $REMOTE_URL from $SOURCE_SHA."
else
  echo "Synced the release tag $RELEASE_TAG to $REMOTE_URL from $SOURCE_SHA."
fi
