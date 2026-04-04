# unifi_bl

`unifi_bl` is a lightweight web console for managing IPv4 CIDR blocklists and
syncing them to UniFi firewall groups.

It is built to:

- read health and inventory data from a local UniFi Network controller
- manage persistent local blocklists
- import CIDRs from remote source URLs
- push those CIDRs to UniFi as one or more managed groups
- keep the current app version visible in the interface footer

## Features

- connectivity checks for the local UniFi Network API
- optional read-only Site Manager support
- persistent blocklists stored in `data/blocklists.json`
- runtime UniFi settings editable from the web UI
- source URL refresh with scheduled re-sync
- configurable UniFi group adapter through `UNIFI_BLOCKLISTS_*`
- selectable UniFi ipset limits for common gateways:
  `2000 (USG)`, `4000 (Typical)`, `8000 (UDM Pro / UXG)`
- overflow handling for large lists:
  split into multiple UniFi groups or keep only the first entries
- detailed sync errors directly in the interface
- automatic relink or recreate behavior when a UniFi group disappears
- local session-based authentication when enabled
- explicit UI feedback when local authentication is disabled

## Authentication

The UI can be protected with local credentials stored in `.env`.

When authentication is enabled:

- the login form is compatible with password managers
- the session cookie lasts 12 hours
- the current username is shown on the right side of the navigation bar with an
  `Exit` button
- sessions are stored in memory, so restarting the app closes active sessions

Enable authentication by setting all three variables together:

- `APP_AUTH_USERNAME`
- `APP_AUTH_PASSWORD`
- `APP_AUTH_PASSWORD_SEED`

`APP_AUTH_PASSWORD_SEED` is an additional secret used during password
verification. Use a unique random value and keep it only in `.env`.

If these variables are left empty, the UI remains accessible without local
login. In that case the navigation bar shows `Access / Auth inactive`, and a
click opens a modal that explains why authentication is not active and which
Docker variables are still required.

## Versioning

The application version comes from `package.json` and is displayed in the
footer of the interface.

This repository uses a simple release rule:

- every delivered change increments the visible version
- small changes increment the minor version
- larger changes increment the major version

## UniFi API note

Public UniFi documentation exposes the read endpoints used for sites, devices,
clients, and the Site Manager cloud API.

Write operations for CIDR-carrying firewall groups are less clearly documented,
so this project combines:

- official UniFi read endpoints for controller data
- a configurable adapter for UniFi blocklist objects

The default validated profile targets:

- `{networkRootUrl}/api/s/{siteRef}/rest/firewallgroup`

Supported path placeholders:

- `{siteId}`: site UUID exposed by the `integration/v1` API
- `{siteRef}`: legacy site reference, often `default`
- `{networkRootUrl}`: base derived from `UNIFI_NETWORK_BASE_URL` without the
  `/integration/v1` suffix

If your UniFi version differs, adjust the adapter variables in `.env`.

## Getting started

1. Copy `.env.example` to `.env`.
2. Fill in your UniFi connection values.
3. Optionally set `APP_AUTH_USERNAME`, `APP_AUTH_PASSWORD`, and
   `APP_AUTH_PASSWORD_SEED`.
4. Choose the UniFi group size limit that matches your gateway. The default is
   `4000`, and the UI also offers `2000` and `8000`.
5. Start the app:

```bash
docker compose up -d
```

6. Open `http://localhost:8080`.

## Main variables

- `UNIFI_NETWORK_BASE_URL`: base URL of the local UniFi Network API
- `UNIFI_NETWORK_API_KEY`: local UniFi API key
- `UNIFI_SITE_ID`: target site used for reads and sync operations
- `UNIFI_SITE_MANAGER_API_KEY`: optional official cloud API key
- `UNIFI_BLOCKLISTS_*`: UniFi blocklist adapter configuration
- `UNIFI_BLOCKLISTS_MAX_ENTRIES`: UniFi group size limit, default `4000`
- `APP_AUTH_USERNAME`: local UI login username
- `APP_AUTH_PASSWORD`: local UI login password
- `APP_AUTH_PASSWORD_SEED`: additional local secret used during password
  verification

## Security

- do not commit `.env`
- do not commit API keys, passwords, password seeds, or SSH keys
- keep deployment-specific hostnames, private IPs, and access details outside
  the public documentation

## Project structure

- `src/server.js`: HTTP server and REST API
- `src/lib/`: configuration, UniFi client, auth, JSON store, and sync logic
- `src/public/`: web interface
- `tests/`: focused runtime and sync tests

## Current limitations

- IPv4 CIDR only
- imported URL lists extract IPv4/CIDR values line by line
- UniFi API responses may vary depending on controller version
- large blocklists depend on the selected overflow strategy and the configured
  UniFi group size limit
- some installations may require `ALLOW_INSECURE_TLS=true` with self-signed
  controller certificates
