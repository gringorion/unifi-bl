# Forgejo Actions for UniFi Blocklists

This repository now includes a Forgejo Actions setup dedicated to the real
`unifi-bl` workflow:

- validate the Docker build and the Compose startup path
- smoke test the running container over HTTP
- publish the OCI image for `main`
- publish tagged releases
- scan the repository and image for common security problems

The workflow files live in `.forgejo/workflows/`.

## Why there is a dedicated `docker-compose.ci.yml`

The runtime `docker-compose.yml` is designed for production-style usage with:

- a published image (`gringorion/unifi-bl:latest`)
- a fixed local bind mount for `./data`
- a fixed `container_name`

That is perfect for normal deployment, but it is not ideal for CI because CI
must build the image locally and avoid mutating the repository `data/`
directory.

For that reason, CI uses `docker-compose.ci.yml`, which:

- builds from the local `Dockerfile`
- avoids the fixed runtime volume mount
- adds a healthcheck against `/api/health`

The standard `docker-compose.yml` is still validated in CI with `docker compose config`.

## Prerequisites

1. Forgejo Actions must be enabled for the repository.
2. At least one runner must be attached to the repository, the owner, or the instance.
3. The runner used by these workflows must have Docker access.

These workflows currently assume:

- a Forgejo runner exposing the `docker` label
- the runner exposes a Docker daemon to job containers
- if the job image does not already include Docker CLI tools, the workflows install them automatically through `apk` or `apt-get`
- the workflows do not create their own daemon; they use the daemon configured by the runner

## Required secrets

Configure these repository secrets in Forgejo:

- `REGISTRY`
  Example: `docker.io`
- `IMAGE_NAME`
  Example: `gringorion/unifi-bl`
- `REGISTRY_USERNAME`
  Example: your Docker registry username
- `REGISTRY_PASSWORD`
  Example: your Docker registry password or access token

No extra secret is required for Forgejo release creation in the default setup.
The release workflow uses the temporary token exposed by Forgejo (`FORGEJO_TOKEN`)
when the workflow runs on a trusted event such as a tag push.

## Included workflows

### `01-ci.yml`

Triggered on:

- `push`
- `pull_request`

What it does:

- checks out the repository
- prints Docker and Compose versions
- verifies critical files
- creates a fake `.env` from `.env.example`
- validates both Compose files
- builds the local image
- starts the application with Compose
- waits for the healthcheck
- calls `/api/health`
- calls `/api/session`
- dumps logs on failure
- always cleans up the CI stack

### `03-docker-publish.yml`

Triggered on:

- push to `main`
- manual `workflow_dispatch`

What it does:

- logs in to the configured OCI registry
- builds the image from the real `Dockerfile`
- pushes:
  - `latest`
  - `sha-<shortsha>`

### `04-release.yml`

Triggered on:

- push of tags matching `v*`

What it does:

- checks that the tag matches:
  - `VERSION`
  - `package.json`
- builds and pushes:
  - `vX.Y.Z`
  - `latest`
- creates or updates the Forgejo release entry via the Forgejo API

### `02-security-scan.yml`

Triggered on:

- `push`
- `pull_request`
- manual `workflow_dispatch`

What it does:

- scans the repository for secrets with Gitleaks
- builds the Docker image locally
- scans the built image tarball with Trivy
- fails on critical vulnerabilities

## How to run the workflows

### CI

- Push a branch
- or open a pull request

### Docker publish

- Push to `main`
- or start `Docker Publish` manually from the Actions UI

### Release

1. Make sure `VERSION` and `package.json` contain the release version.
2. Create a tag such as `v0.24.0`.
3. Push the tag to Forgejo.

Example:

```bash
git tag v0.24.0
git push forgejo-219 v0.24.0
```

### Security scan

- Push a branch
- open a pull request
- or launch the workflow manually

## Docker runner options

### Option 1: Runner with Docker socket access

This is the simplest option for this repository.

Recommended setup:

- a dedicated Forgejo runner for trusted repositories only
- the runner exposes the `docker` label
- Docker is installed on the host
- the runner user is allowed to access Docker
- the runner is configured with either `container.docker_host: automount` or a dedicated Docker-in-Docker daemon

Typical validation commands on the runner host:

```bash
docker version
docker compose version
```

This is the most pragmatic option for `unifi-bl`, because the workflows need:

- `docker build`
- `docker compose up`
- image publish
- image scanning

### Option 2: Dedicated Docker-in-Docker daemon

If you do not want to expose the host Docker daemon, configure the runner to use a separate Docker-in-Docker daemon.

Typical runner-side configuration:

- start a persistent `docker:dind` container on the runner host
- set `runner.envs.DOCKER_HOST` to the DIND endpoint
- set `container.docker_host` to the host-side endpoint the runner should use
- add a host alias such as `--add-host=dind_container.docker.internal:host-gateway` in `container.options` when needed

## Troubleshooting

### Docker is not accessible

Symptoms:

- `Cannot connect to the Docker daemon`
- `permission denied while trying to connect to the Docker daemon socket`
- `docker: command not found`

What to check:

- the job image exposes either `apk` or `apt-get` so the bootstrap step can install Docker CLI tools when needed
- Docker is installed on the runner host
- the runner user can talk to Docker
- the runner exposes a daemon to job containers with `container.docker_host: automount`, or with a dedicated DIND configuration
- if using dedicated DIND, `runner.envs.DOCKER_HOST` and `container.docker_host` both point to the correct daemon

### Compose errors

Symptoms:

- `docker compose config` fails
- invalid interpolation
- missing `.env` values

What to check:

- `.env.example` still contains the keys expected by the app
- `docker-compose.yml` and `docker-compose.ci.yml` stay aligned
- the runner has either `docker compose` or `docker-compose`

### Build errors

Symptoms:

- `docker build` fails
- base image pull fails

What to check:

- the runner can reach the registry used by the `Dockerfile`
- disk space is available on the runner
- the Docker daemon is healthy

### Publish errors

Symptoms:

- image login fails
- push is denied

What to check:

- `REGISTRY`
- `IMAGE_NAME`
- `REGISTRY_USERNAME`
- `REGISTRY_PASSWORD`

For Docker Hub, a good baseline is:

- `REGISTRY=docker.io`
- `IMAGE_NAME=gringorion/unifi-bl`

### Release creation errors

Symptoms:

- image is pushed but the Forgejo release is missing

What to check:

- the workflow was triggered by a tag push, not a pull request
- the tag matches `vX.Y.Z`
- `VERSION` and `package.json` match the tag
- the Forgejo instance exposes the standard releases API

## Limitations

- The workflows assume the runner has Docker available.
- The publish and release workflows depend on registry secrets.
- The release workflow only creates the Forgejo release entry and container tags; it does not attach binary assets.
- The CI workflow uses fake UniFi values and validates container startup, not live UniFi integration.

## Practical advice

- Keep `VERSION` and `package.json` synchronized before tagging.
- Run the CI workflow on every branch before tagging a release.
- Use a dedicated runner for this repository if possible.
- Prefer Docker socket access over DinD unless your environment requires DinD.
