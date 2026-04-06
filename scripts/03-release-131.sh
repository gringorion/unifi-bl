#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT_DIR/scripts/01-sync-repo-219.sh"
bash "$ROOT_DIR/scripts/02-deploy-131.sh"
