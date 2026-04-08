#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_NAME="${GITHUB_RELEASE_REMOTE_NAME:-origin}"
REPOSITORY="${GITHUB_RELEASE_REPOSITORY:-gringorion/unifi-bl}"
TAG_NAME="${1:-${GITHUB_RELEASE_TAG:-}}"

if [[ -z "$TAG_NAME" ]]; then
  echo "Usage: bash scripts/create-github-release.sh vX.Y.Z" >&2
  exit 1
fi

if [[ ! "$TAG_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Release tags must look like vX.Y.Z. Got: $TAG_NAME" >&2
  exit 1
fi

if ! git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  echo "Local tag $TAG_NAME does not exist." >&2
  exit 1
fi

REMOTE_URL="$(git -C "$ROOT_DIR" remote get-url "$REMOTE_NAME")"
if [[ "$REMOTE_URL" != "https://github.com/"* && "$REMOTE_URL" != "git@github.com:"* ]]; then
  echo "Remote $REMOTE_NAME does not point to GitHub: $REMOTE_URL" >&2
  exit 1
fi

CRED="$(
  printf 'protocol=https\nhost=github.com\npath=%s.git\n\n' "$REPOSITORY" | git credential fill
)"
GITHUB_USERNAME="$(printf '%s\n' "$CRED" | sed -n 's/^username=//p')"
GITHUB_PASSWORD="$(printf '%s\n' "$CRED" | sed -n 's/^password=//p')"

if [[ -z "$GITHUB_USERNAME" || -z "$GITHUB_PASSWORD" ]]; then
  echo "Missing GitHub credentials for $REPOSITORY." >&2
  exit 1
fi

TAG_SHA="$(git -C "$ROOT_DIR" rev-list -n 1 "$TAG_NAME")"
RELEASE_VERSION="${TAG_NAME#v}"
API_ROOT="https://api.github.com/repos/$REPOSITORY/releases"
PAYLOAD_FILE="$(mktemp)"
LOOKUP_FILE="$(mktemp)"
RESPONSE_FILE="$(mktemp)"

cleanup() {
  rm -f "$PAYLOAD_FILE" "$LOOKUP_FILE" "$RESPONSE_FILE"
}

trap cleanup EXIT

cat > "$PAYLOAD_FILE" <<EOF
{
  "tag_name": "$TAG_NAME",
  "name": "Release $TAG_NAME",
  "body": "Release $TAG_NAME for UniFi Blocklists.\\n\\nVersion: $RELEASE_VERSION\\n\\nDocker image:\\n- gringorion/unifi-bl:$RELEASE_VERSION\\n- gringorion/unifi-bl:$TAG_NAME\\n- gringorion/unifi-bl:latest",
  "draft": false,
  "prerelease": false,
  "generate_release_notes": false
}
EOF

STATUS_CODE="$(curl -sS -u "$GITHUB_USERNAME:$GITHUB_PASSWORD" \
  -o "$LOOKUP_FILE" \
  -w '%{http_code}' \
  -H "Accept: application/vnd.github+json" \
  "$API_ROOT/tags/$TAG_NAME")"

if [[ "$STATUS_CODE" == "200" ]]; then
  RELEASE_ID="$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$LOOKUP_FILE" | head -n 1)"
  if [[ -z "$RELEASE_ID" ]]; then
    echo "Unable to parse the existing GitHub release ID for $TAG_NAME." >&2
    cat "$LOOKUP_FILE" >&2
    exit 1
  fi

  curl -fsS -u "$GITHUB_USERNAME:$GITHUB_PASSWORD" \
    -X PATCH \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    --data @"$PAYLOAD_FILE" \
    "$API_ROOT/$RELEASE_ID" >/dev/null
elif [[ "$STATUS_CODE" == "404" ]]; then
  CREATE_STATUS="$(curl -sS -u "$GITHUB_USERNAME:$GITHUB_PASSWORD" \
    -X POST \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    --data @"$PAYLOAD_FILE" \
    -o "$RESPONSE_FILE" \
    -w '%{http_code}' \
    "$API_ROOT")"

  if [[ "$CREATE_STATUS" != "201" ]]; then
    echo "Unable to create the GitHub release for $TAG_NAME: HTTP $CREATE_STATUS" >&2
    cat "$RESPONSE_FILE" >&2
    exit 1
  fi
else
  echo "Unexpected response while checking the GitHub release for $TAG_NAME: HTTP $STATUS_CODE" >&2
  cat "$LOOKUP_FILE" >&2
  exit 1
fi

echo "Created or updated the GitHub release for $TAG_NAME on $REPOSITORY."
