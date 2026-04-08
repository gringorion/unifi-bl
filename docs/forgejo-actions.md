# Forgejo Actions for UniFi Blocklists

This repository now includes a Forgejo Actions setup dedicated to the real
`unifi-bl` workflow:

- validate the Docker build and the Compose startup path
- smoke test the running container over HTTP
- publish the OCI image for `main`
- publish tagged releases
- scan the repository and image for common security problems

The workflow files live in `.forgejo/workflows/`.

## Execution order on push

Pushes now go through a dedicated orchestration workflow with standard jobs:

1. `00-push-pipeline.yml`
2. `01-ci.yml`
3. `02-security-scan.yml`
4. `03-docker-publish.yml` on pushes to `main` only

This keeps the execution order explicit and avoids racing independent workflows
against each other on the same commit, while staying compatible with runners
that do not schedule reusable workflow jobs correctly.

## Why CI does not use `docker compose up`

The runtime `docker-compose.yml` is designed for production-style usage with:

- a published image (`gringorion/unifi-bl:latest`)
- a fixed local bind mount for `./data`
- a fixed `container_name`

That is perfect for normal deployment, but it is not ideal for CI because CI
must build the image locally, avoid mutating the repository `data/`
directory, and stay compatible with remote Docker daemons used by some Forgejo
runners.

For that reason, CI now:

- validates the standard `docker-compose.yml` with `docker compose config`
- builds the image directly with `docker build`
- starts the app directly with `docker run`
- lets Docker allocate a free loopback host port for each CI job
- lists the files embedded under `/app` in the built image
- captures an intermediate UI screenshot with `scripts/update-screenshot.sh`
- fails if `docs/forgejo-actions.md` is found in the image

## Public GitHub export

The public GitHub push is intentionally filtered and is now meant to run from
Forgejo workflows, not from the local workstation by default.

It exports only the files listed in `.public-export-include`, then adds:

- `VERSION`
- a minimal `.gitignore`

When a CI screenshot already exists, `scripts/sync-origin-public.sh` now prefers:

- `.run/ci/ui-screenshot.png`
- then `.run/ci/validated-ui-screenshot.png`

That lets the public sync reuse the sanitized screenshot produced by CI instead
of generating a different one.

Forgejo workflow runs also set `SYNC_PUBLIC_ALLOW_UNTRACKED=true` for this
public export step, so CI-generated files such as `.run/ci/...` do not block the
filtered GitHub mirror as long as tracked files are clean.

From now on, the local default remains Forgejo-only:

- local sync and deploy scripts target Forgejo and the private deployment host
- public GitHub sync and release publication are handled by Forgejo workflows
- local GitHub pushes should only happen on explicit request

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

Optional but recommended for the public GitHub mirror and public releases:

- `PUBLIC_GITHUB_REMOTE_URL`
  Example: `https://github.com/gringorion/unifi-bl.git`
- `PUBLIC_GITHUB_TOKEN`
  Example: a GitHub personal access token with repository access
- `PUBLIC_GITHUB_USERNAME`
  Example: your GitHub username
- `PUBLIC_GITHUB_PASSWORD`
  Legacy local fallback only. Forgejo workflows now require `PUBLIC_GITHUB_TOKEN`.

For GitHub HTTPS Git operations, GitHub requires a personal access token instead
of an account password. The Forgejo workflows therefore fail fast when
`PUBLIC_GITHUB_REMOTE_URL` is configured without `PUBLIC_GITHUB_TOKEN`, instead
of retrying with an invalid account password.

No extra secret is required for Forgejo release creation in the default setup.
The release workflow uses the temporary token exposed by Forgejo (`FORGEJO_TOKEN`)
when the workflow runs on a trusted event such as a tag push.

## Included workflows

### `00-push-pipeline.yml`

Triggered on:

- `push`
- manual `workflow_dispatch`

What it does:

- runs the CI job first
- then runs the security scan job
- then runs the Docker publish job only for pushes to `main`
- then mirrors the filtered public repository to GitHub from Forgejo when the `PUBLIC_GITHUB_*` secrets are configured

### `01-ci.yml`

Triggered on:

- `pull_request`
- manual `workflow_dispatch`

What it does:

- checks out the repository
- prints Docker and Compose versions
- verifies critical files
- creates a fake `.env` from `.env.example`
- validates the runtime Compose file
- builds the local image
- lists the files embedded in the image under `/app`
- starts the application with `docker run`
- uses a dynamically assigned loopback host port to avoid collisions between jobs
- waits for the app to answer on `/api/health`
- calls `/api/health` from the running app container
- calls `/api/session` from the running app container
- captures a sanitized UI screenshot at `.run/ci/ui-screenshot.png`
- keeps the usual screenshot anonymization for the Site ID
- fails if visible text includes common key, token, password, or unexpected user strings
- fails if the visible signed-in user is not `gringorion`
- fails if the version footer is not visible in the bottom-left corner
- dumps container details and logs on failure
- always cleans up the CI stack

### `03-docker-publish.yml`

Triggered on:

- manual `workflow_dispatch`

What it does:

- logs in to the configured OCI registry
- builds the image from the real `Dockerfile`
- lists the files embedded in the image under `/app`
- generates a fresh sanitized screenshot from the publish image in the same job
- commits the refreshed `docs/screenshot.png` back to the Forgejo branch with a `[skip ci]` commit message when it changed
- pushes:
  - `latest`
  - `<VERSION>`
- mirrors the filtered public repository to GitHub from Forgejo on `main` when the `PUBLIC_GITHUB_*` secrets are configured

### `04-release.yml`

Triggered on:

- push of tags matching `v*`

What it does:

- checks that the tag matches:
  - `VERSION`
  - `package.json`
- builds the release image
- lists the files embedded in the image under `/app`
- generates a fresh sanitized screenshot from the release image in the same job
- pushes:
  - `X.Y.Z`
  - `vX.Y.Z`
  - `latest`
- creates or updates the Forgejo release entry via the Forgejo API
- updates the filtered public GitHub repository and creates or updates the public GitHub release when the `PUBLIC_GITHUB_*` secrets are configured

The tag-based release workflow does not push a screenshot commit back to the
Forgejo branch. Only the branch-based publish workflows do that.

### `02-security-scan.yml`

Triggered on:

- `pull_request`
- manual `workflow_dispatch`

What it does:

- scans the repository for secrets with Gitleaks
- builds the Docker image locally
- lists the files embedded in the image under `/app`
- scans the built image tarball with a pinned official Trivy image from GHCR
- fails on critical vulnerabilities
- copies scan inputs into temporary scanner containers so the workflow also works with remote Docker daemons

## How to run the workflows

### CI

- Push a branch to run the ordered pipeline
- or open a pull request

### Docker publish

- Push to `main` through `00-push-pipeline.yml`
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

- Push a branch through `00-push-pipeline.yml`
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
- `docker-compose.yml` still renders correctly with `docker compose config`
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
