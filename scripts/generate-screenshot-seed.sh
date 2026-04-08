#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${1:-$ROOT_DIR/.run/ci/screenshot-blocklists.json}"

resolve_node_bin() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  if [[ -x /app/code-server/lib/node ]]; then
    printf '%s\n' /app/code-server/lib/node
    return
  fi

  echo "Node.js is required to generate the screenshot seed." >&2
  exit 1
}

mkdir -p "$(dirname "$OUTPUT_PATH")"
NODE_BIN="$(resolve_node_bin)"

"$NODE_BIN" --input-type=module - "$OUTPUT_PATH" <<'NODE'
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outputPath = process.argv[2];
mkdirSync(path.dirname(outputPath), { recursive: true });

function buildImportedCidrs(total, seed) {
  const firstOctets = [23, 37, 44, 52, 63, 71, 82, 91, 103, 109, 128, 146, 154, 165, 185, 193];
  const cidrs = [];

  for (let index = 0; index < total; index += 1) {
    const first = firstOctets[(index + seed) % firstOctets.length];
    const second = 16 + ((Math.floor(index / 8192) + seed * 3) % 180);
    const third = Math.floor(index / 32) % 256;
    const fourth = (index % 32) * 8;
    cidrs.push(`${first}.${second}.${third}.${fourth}/29`);
  }

  return cidrs;
}

function buildRemoteGroups(baseName, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
    name: count > 1 ? `${baseName}_${index + 1}` : baseName,
  }));
}

function iso(value) {
  return new Date(value).toISOString();
}

const blocklists = [
  {
    id: "screenshot-feed-alpha",
    name: "Threat Research Alpha",
    description: "Derived from the reference controller feed profile",
    enabled: true,
    includeInFirewall: false,
    cidrs: [],
    sourceUrl: "https://feeds.example.net/alpha.txt",
    refreshInterval: "12h",
    overflowMode: "split",
    refreshPaused: false,
    importedCidrs: buildImportedCidrs(32768, 1),
    remoteObjectId: "threat-research-alpha-1",
    remoteGroups: buildRemoteGroups("Threat Research Alpha", 9),
    lastUrlSyncAt: iso("2026-04-08T10:45:58Z"),
    lastUrlSyncStatus: "ok",
    lastUrlSyncError: "",
    lastUnifiSyncAt: iso("2026-04-08T10:46:10Z"),
    lastUnifiSyncStatus: "ok",
    lastUnifiSyncError: "",
    lastSyncAt: iso("2026-04-08T10:46:10Z"),
    lastSyncStatus: "ok",
    lastSyncError: "",
    createdAt: iso("2026-04-06T08:30:00Z"),
    updatedAt: iso("2026-04-08T10:46:10Z"),
  },
  {
    id: "screenshot-review-queue",
    name: "Manual Review Queue",
    description: "Small operator-managed set for fast verification",
    enabled: true,
    includeInFirewall: true,
    cidrs: [
      "23.24.25.26/32",
      "34.52.18.0/24",
      "46.112.33.45/32",
      "52.160.20.0/24",
      "63.118.4.11/32",
      "82.44.10.0/24",
      "91.52.64.70/32",
      "109.65.81.0/24",
      "128.40.12.13/32",
      "146.24.18.0/24",
      "154.33.21.22/32",
      "165.44.55.0/24",
    ],
    sourceUrl: "",
    refreshInterval: "",
    overflowMode: "split",
    refreshPaused: false,
    importedCidrs: [],
    remoteObjectId: "manual-review-queue-1",
    remoteGroups: buildRemoteGroups("Manual Review Queue", 1),
    lastUrlSyncAt: "",
    lastUrlSyncStatus: "never",
    lastUrlSyncError: "",
    lastUnifiSyncAt: iso("2026-04-08T10:42:18Z"),
    lastUnifiSyncStatus: "ok",
    lastUnifiSyncError: "",
    lastSyncAt: iso("2026-04-08T10:42:18Z"),
    lastSyncStatus: "ok",
    lastSyncError: "",
    createdAt: iso("2026-04-07T14:12:00Z"),
    updatedAt: iso("2026-04-08T10:42:18Z"),
  },
  {
    id: "screenshot-feed-beta",
    name: "Regional Feed Beta",
    description: "Daily import kept visible for coverage checks",
    enabled: true,
    includeInFirewall: true,
    cidrs: [],
    sourceUrl: "https://feeds.example.net/regional-beta.txt",
    refreshInterval: "1d",
    overflowMode: "split",
    refreshPaused: true,
    importedCidrs: buildImportedCidrs(12640, 5),
    remoteObjectId: "regional-feed-beta-1",
    remoteGroups: buildRemoteGroups("Regional Feed Beta", 4),
    lastUrlSyncAt: iso("2026-04-07T22:14:51Z"),
    lastUrlSyncStatus: "ok",
    lastUrlSyncError: "",
    lastUnifiSyncAt: iso("2026-04-07T22:15:09Z"),
    lastUnifiSyncStatus: "ok",
    lastUnifiSyncError: "",
    lastSyncAt: iso("2026-04-07T22:15:09Z"),
    lastSyncStatus: "ok",
    lastSyncError: "",
    createdAt: iso("2026-04-06T16:10:00Z"),
    updatedAt: iso("2026-04-07T22:15:09Z"),
  },
  {
    id: "screenshot-overflow-watch",
    name: "Overflow Watch",
    description: "Feed retained after a remote object relink is required",
    enabled: true,
    includeInFirewall: true,
    cidrs: [],
    sourceUrl: "https://feeds.example.net/overflow-watch.txt",
    refreshInterval: "6h",
    overflowMode: "truncate",
    refreshPaused: false,
    importedCidrs: buildImportedCidrs(6050, 9),
    remoteObjectId: "overflow-watch-1",
    remoteGroups: buildRemoteGroups("Overflow Watch", 2),
    lastUrlSyncAt: iso("2026-04-08T09:08:40Z"),
    lastUrlSyncStatus: "ok",
    lastUrlSyncError: "",
    lastUnifiSyncAt: iso("2026-04-08T09:09:02Z"),
    lastUnifiSyncStatus: "ok",
    lastUnifiSyncError: "",
    lastSyncAt: iso("2026-04-08T09:09:02Z"),
    lastSyncStatus: "remote-deleted",
    lastSyncError: "",
    createdAt: iso("2026-04-05T18:20:00Z"),
    updatedAt: iso("2026-04-08T09:09:02Z"),
  },
  {
    id: "screenshot-sandbox-disabled",
    name: "Sandbox Disabled",
    description: "Dormant manual list kept outside the active policy set",
    enabled: false,
    includeInFirewall: false,
    cidrs: [
      "37.41.52.0/24",
      "71.82.93.104/32",
      "193.22.44.0/24",
    ],
    sourceUrl: "",
    refreshInterval: "",
    overflowMode: "split",
    refreshPaused: false,
    importedCidrs: [],
    remoteObjectId: "",
    remoteGroups: [],
    lastUrlSyncAt: "",
    lastUrlSyncStatus: "never",
    lastUrlSyncError: "",
    lastUnifiSyncAt: "",
    lastUnifiSyncStatus: "never",
    lastUnifiSyncError: "",
    lastSyncAt: "",
    lastSyncStatus: "never",
    lastSyncError: "",
    createdAt: iso("2026-04-04T09:15:00Z"),
    updatedAt: iso("2026-04-05T07:40:00Z"),
  },
];

writeFileSync(
  outputPath,
  JSON.stringify({ version: 3, blocklists }, null, 2),
  "utf8",
);
NODE

echo "Generated screenshot seed data at $OUTPUT_PATH."
