# UniFi Blocklists

UniFi Blocklists is a web console for managing IPv4 CIDR blocklists and syncing
them to UniFi firewall groups.

![UniFi Blocklists console preview](docs/screenshot.png)

## What you can do

- monitor controller health and connectivity
- keep local blocklists in one place
- import CIDRs from remote URLs on a schedule
- sync lists to UniFi as managed firewall groups
- split oversized lists into multiple groups or truncate to the first entries
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
- Some installations may require `ALLOW_INSECURE_TLS=true` for self-signed certs.
