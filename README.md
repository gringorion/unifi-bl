# unifi_bl

`unifi_bl` is a V1 web application for managing CIDR blocklists linked to
UniFi, with a lightweight workflow similar to a small Pi-hole-style control
plane:

- read UniFi data from a local UniFi controller
- manage local CIDR blocklists
- sync those lists to UniFi remote objects

## What V1 does

- tests connectivity to the local UniFi Network API
- reads sites, devices, and clients from the selected site
- can also read hosts through the official Site Manager cloud API
- manages persistent local blocklists stored in `data/blocklists.json`
- lets you update UniFi runtime configuration from the web UI
- provides a multi-view interface with a dedicated technical section
- lets you attach a source URL to each blocklist
- can automatically refresh source lists and re-sync UniFi
- syncs each blocklist to a configurable remote UniFi object
- shows detailed sync errors directly in the interface
- recreates or relinks a UniFi group when the remote object no longer exists
- deletes the local blocklist even if the remote UniFi group is already gone

## Important note about the UniFi API

As of March 30, 2026, the public UniFi documentation clearly exposes read
endpoints for sites, devices, clients, and statistics, as well as the
read-only Site Manager cloud API through `X-API-Key`.

However, CRUD endpoints for objects that store CIDR lists are not documented as
clearly in the public UniFi documentation. This V1 is therefore built with:

- an official path for reading network data
- a configurable adapter for UniFi blocklist objects

The default profile validated for this project currently points to:

- `{networkRootUrl}/api/s/{siteRef}/rest/firewallgroup`

Blocklist path templates support:

- `{siteId}`: site UUID exposed by the `integration/v1` API
- `{siteRef}`: legacy site reference, often `default`
- `{networkRootUrl}`: base derived from `UNIFI_NETWORK_BASE_URL` without the
  `/integration/v1` suffix

If your UniFi version uses a different path or JSON schema, you can adjust it
in `.env`.

UniFi connection settings can also be updated from the web UI. Runtime values
are stored in `data/settings.json`, which avoids editing `.env` for common
changes.

## Getting started

1. Copy `.env.example` to `.env`
2. Fill in your UniFi controller URL, local API key, and `UNIFI_SITE_ID`
3. Start the app:

```bash
docker compose up -d
```

4. Open `http://localhost:8080`

## Main variables

- `UNIFI_NETWORK_BASE_URL`: base URL of the local UniFi Network API
- `UNIFI_NETWORK_API_KEY`: local UniFi API key
- `UNIFI_SITE_ID`: target site used for reads and sync operations
- `UNIFI_SITE_MANAGER_API_KEY`: optional official cloud API key
- `UNIFI_BLOCKLISTS_*`: blocklist adapter configuration

## Project structure

- `src/server.js`: HTTP server and REST API
- `src/lib/`: configuration, UniFi client, JSON store, and sync logic
- `src/public/`: web interface
- `docs/unifi-assumptions.md`: UniFi assumptions and implementation notes

## Current limitations

- IPv4 CIDR only in this first version
- no local application authentication
- imported URL lists extract IPv4/CIDR values line by line
- UniFi API responses may vary depending on controller version
- some installations may require `ALLOW_INSECURE_TLS=true` when the local
  controller uses a self-signed certificate
