# UniFi Blocklists

UniFi Blocklists is a web console for managing IPv4 CIDR blocklists and syncing
them to UniFi firewall groups.

![UniFi Blocklists console preview](docs/screenshot.png)

## What you can do

- monitor controller health and connectivity
- keep local blocklists in one place
- import CIDRs from remote URLs on a schedule
- sync lists to UniFi as managed firewall groups
- choose per blocklist whether it participates in the managed firewall policy
- keep managed UniFi inbound and outbound zone-based firewall policies in sync with selected groups
- split oversized lists into multiple groups or truncate to the first entries
- exclude private and non-routable IPv4 ranges from the managed firewall sync
- use the semantic version from `package.json` in the UI
- select a UniFi IP set size that matches your gateway
- view sync status and detailed error messages in the UI
- optionally protect the UI with a local login

## Production install (Docker)

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Fill in the UniFi connection details in `.env`.
3. Optional: enable UI authentication by setting
   `APP_AUTH_USERNAME`, `APP_AUTH_PASSWORD`, and `APP_AUTH_PASSWORD_SEED`.
4. Start the container:

```bash
docker compose up -d
```

5. Open the UI at `http://<host>:8080`.

## Configuration essentials

Set these in `.env` for a production deployment:

- `UNIFI_NETWORK_BASE_URL`: base URL of the local UniFi Network API
- `UNIFI_NETWORK_API_KEY`: local UniFi API key
- `UNIFI_SITE_ID`: target site used for reads and sync operations
- `UNIFI_BLOCKLISTS_MAX_ENTRIES`: UniFi group size limit, default `4000`
- `UNIFI_FIREWALL_RULE_NAME`: base managed firewall rule name, default `unifi-bl - block enabled lists`
- `APP_AUTH_USERNAME`: local UI login username (optional)
- `APP_AUTH_PASSWORD`: local UI login password or `sha256:<hash>` (optional)
- `APP_AUTH_PASSWORD_SEED`: secret used in password derivation (optional)

The UI exposes presets for the most common UniFi limits:
`2000 (USG)`, `4000 (Typical)`, `8000 (UDM Pro / UXG)`.

## Authentication

If you set all three auth variables, the UI requires a login and keeps a 12-hour
session cookie. The login form supports password managers, and the current user
appears in the top-right navigation bar with an `Exit` button.

To store the password as a hash:

```bash
# sha256(APP_AUTH_PASSWORD_SEED + ":" + your_password)
APP_AUTH_PASSWORD=sha256:<hash>
```

Legacy plaintext passwords still work, but the seeded `sha256:` format is
recommended.

## Notes

- IPv4 CIDR only.
- UniFi API responses can vary across controller versions.
- Large blocklists depend on the selected overflow strategy and configured limit.
- The managed firewall policy now targets UniFi zone-based `firewall-policies` by default, with one inbound and one outbound policy per selected remote group and per non-gateway zone.
- Only enabled blocklists with the firewall checkbox turned on are referenced by the managed firewall policy.
- On controllers that do not expose the modern `firewall-policies` API, `unifi_bl` falls back to the legacy `firewallrule` endpoints.
- Private and other non-routable IPv4 ranges are filtered out before the managed firewall rule can reference them.
- `192.168.40.131/32` is always injected into the managed UniFi group payloads as an explicit exception.
- Every code modification must bump `package.json`: simple change `+0.0.1`, important change `+0.1.0`.
- Every committed version change must also be pushed to `http://192.168.40.219:3000/Nico/unifi-bl.git`.
- Use `npm run deploy:131` for the standard release flow: it syncs the current committed branch to `192.168.40.219` and then redeploys `192.168.40.131`.
- `npm run deploy:131` expects a clean git worktree with the bumped `package.json` version already committed.
- `npm run deploy:131:direct` keeps the previous behavior and redeploys only the current working tree to `192.168.40.131`.
- Some installations may require `ALLOW_INSECURE_TLS=true` for self-signed certs.
