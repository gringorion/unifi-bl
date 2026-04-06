#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/sync-repo-219.sh"
"$ROOT_DIR/scripts/deploy-131.sh"
