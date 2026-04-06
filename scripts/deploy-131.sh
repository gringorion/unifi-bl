#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_KEY="${DEPLOY_131_SSH_KEY:-/config/workspace/.ssh/transcript_root_192_168_40_128}"
KNOWN_HOSTS="${DEPLOY_131_KNOWN_HOSTS:-/config/workspace/transcript/.ssh/known_hosts}"
REMOTE_HOST="${DEPLOY_131_HOST:-root@192.168.40.131}"
REMOTE_DIR="${DEPLOY_131_REMOTE_DIR:-/opt/unifi_bl}"

tar \
  --exclude='.git' \
  --exclude='data' \
  --exclude='.run' \
  --exclude='unifi_bl.code-workspace' \
  -C "$ROOT_DIR" \
  -cf - . \
  | ssh \
      -i "$SSH_KEY" \
      -o IdentitiesOnly=yes \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile="$KNOWN_HOSTS" \
      "$REMOTE_HOST" \
      "cd '$REMOTE_DIR' && tar -xf - && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build app"
