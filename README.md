# UniFi Blocklists

UniFi Blocklists is a web interface for managing IPv4 CIDR blocklists,
synchronizing them to UniFi, and choosing which ones feed the firewall policy
managed by the application.

![UniFi Blocklists interface preview](docs/screenshot.png)

## What You Can Do

- create and edit your blocklists from a single interface
- automatically import CIDRs from remote URLs
- synchronize lists to UniFi groups managed by the application
- choose, list by list, whether it should also feed the firewall policy
- review the latest synchronization status and any errors
- protect the interface with a local username and password

## Docker Setup

1. Copy the example file:

```bash
cp .env.example .env
```

2. Fill in your local UniFi URL, API key, and site ID.
3. Start the application:

```bash
docker compose up -d
```

4. Open `http://<host>:8080`.

## Start With docker run

```bash
docker run -d \
  --name unifi-bl \
  --restart unless-stopped \
  -p 8080:8080 \
  -v "$(pwd)/data:/app/data" \
  --env-file .env \
  gringorion/unifi-bl:latest
```

## Example docker-compose

Copy and paste this `docker-compose.yml` file:

```yaml
services:
  app:
    image: gringorion/unifi-bl:latest
    container_name: unifi-bl
    restart: unless-stopped
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
```

## Useful Settings

- `UNIFI_NETWORK_BASE_URL`: local UniFi Network URL
- `UNIFI_NETWORK_API_KEY`: local UniFi API key
- `UNIFI_SITE_ID`: target site
- `UNIFI_BLOCKLISTS_MAX_ENTRIES`: maximum size of a UniFi group
- `UNIFI_FIREWALL_POLICY_NAME`: name of the managed policy
- `APP_AUTH_USERNAME`, `APP_AUTH_PASSWORD`, `APP_AUTH_PASSWORD_SEED`: enable local login

## In The Interface

- each blocklist can be enabled or disabled for synchronization
- each blocklist can be included or excluded from the firewall policy
- the managed policy is named `unifi-bl - block enabled lists` by default
- private or local IPv4 ranges are not added to the managed policy
- telemetry is enabled by default, but each browser can disable it from Settings
- the PostHog project key is not configured from the interface or Docker variables
- telemetry events include the running version and a persistent installation identifier
- installation-level events are emitted from the container backend with the current running version

## Notes

- IPv4 CIDR only
- local data is stored in the `data/` directory
- the application works well with `docker compose up -d`

## Versioning

- `VERSION` is the build-time source of truth for the application semver
- keep `VERSION` and `package.json` aligned when preparing a release or sync
- run `bash scripts/prepare-build-version.sh patch|minor|major` to auto-bump the build version
- `bash scripts/commit-build-version.sh <branch> patch|minor|major|none` prepares the build version, commits `VERSION` plus `package.json`, and pushes that semver change back to the branch
- `AUTO_BUMP_BUILD=patch|minor|major bash scripts/deploy-131.sh` bumps `VERSION` and `package.json` before the remote Docker rebuild
- the Forgejo publish flow on `main` auto-bumps `patch` before each published build, commits the new semver, and then builds the image from that updated checkout
- the manual Forgejo Docker Publish workflow uses the same commit-first semver bump flow and defaults to `patch`, with `minor`, `major`, or `none` available when needed
- for `release-131.sh`, bump first, commit `VERSION` plus `package.json`, then run the repo sync and deploy flow
