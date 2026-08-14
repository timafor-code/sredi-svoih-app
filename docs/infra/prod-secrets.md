# Production secrets and first-start checklist

## Purpose

This owner-run checklist prepares the first controlled production start of the
Python API on the Selectel host without committing, printing, or copying real
production secrets into Git.

Current deployment context:

- repository: `timafor-code/sredi-svoih-app`;
- host workspace: `/opt/sredi-svoih`;
- public API hostname: `api.pgs24.ru` (temporary production/testing hostname);
- host Nginx and TLS are already configured;
- Certbot renewal dry-run must have succeeded before this checklist starts;
- FastAPI must remain reachable only through `127.0.0.1:8000` behind Nginx;
- PostgreSQL must have no published host port.

This checklist does not enable email, push, object storage, or the privacy
erasure worker. Those dependencies stay fail-closed until separately reviewed
and configured.

## Non-negotiable secret boundary

Real production values live only in these owner-managed server files:

```text
infra/env/.env.compose.production
infra/env/.env.api.production
```

They must:

- remain ignored by Git;
- be owned by the deployment account;
- use mode `0600`;
- never be pasted into issues, PRs, chat, screenshots, shell commands, logs, or
  client environment files;
- never be copied into a Docker image layer.

The committed files below are examples only and contain fake placeholders:

```text
infra/env/compose.prod.env.example
infra/env/api.prod.env.example
```

## 1. Sync the approved production commit

Run on the server as `deploy` after the relevant PR has been merged:

```bash
cd /opt/sredi-svoih
git status --short
git fetch origin
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
```

Stop if tracked files are modified, deleted, staged, conflicted, or otherwise
unexpected. Do not discard server changes merely to make the checkout clean.

## 2. Verify the secret files are ignored before creating them

```bash
cd /opt/sredi-svoih
git check-ignore -v infra/env/.env.compose.production infra/env/.env.api.production
```

Both paths must be reported as ignored. Do not create real secret files until
this check succeeds.

## 3. Generate independent bootstrap secrets without printing them

Use URL-safe hexadecimal values so the PostgreSQL password can be embedded in
the SQLAlchemy URL without extra escaping.

```bash
cd /opt/sredi-svoih
umask 077
POSTGRES_PASSWORD="$(openssl rand -hex 32)"
API_JWT_SECRET="$(openssl rand -hex 32)"
API_TOKEN_HASH_SECRET="$(openssl rand -hex 32)"
GIT_SHA="$(git rev-parse HEAD)"
```

Requirements:

- `POSTGRES_PASSWORD`, `API_JWT_SECRET`, and `API_TOKEN_HASH_SECRET` must be
  independently generated;
- never reuse one value for another purpose;
- do not run `echo`, `printf`, `env`, `set`, or another command that prints the
  values;
- if the shell session is interrupted before the files are written, generate a
  new set rather than trying to recover the old values.

## 4. Create the Compose production environment file

```bash
cd /opt/sredi-svoih
cat > infra/env/.env.compose.production <<EOF
SREDI_API_IMAGE=sredi-svoih-api:${GIT_SHA}
API_ENV_FILE=./env/.env.api.production
POSTGRES_DB=sredi_api
POSTGRES_USER=sredi_api
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
EOF
chmod 600 infra/env/.env.compose.production
```

`POSTGRES_PASSWORD` in this file must be the same password used inside the API
`DATABASE_URL` below. It is the only deliberate duplication between the two
runtime files.

## 5. Create the API production environment file

The first controlled start keeps optional external dependencies disabled. The
`.invalid` public/client URLs below are deliberate bootstrap placeholders: they
allow the API process to start without accidentally authorizing an unreviewed
browser origin. Do not cut over admin, public web, or mobile clients while
these placeholders remain.

```bash
cd /opt/sredi-svoih
cat > infra/env/.env.api.production <<EOF
APP_NAME=sredi-svoih-api
APP_ENV=production
API_VERSION=0.1.0
GIT_SHA=${GIT_SHA}
LOG_LEVEL=INFO

DATABASE_URL=postgresql+asyncpg://sredi_api:${POSTGRES_PASSWORD}@api_postgres:5432/sredi_api
API_JWT_SECRET=${API_JWT_SECRET}
API_TOKEN_HASH_SECRET=${API_TOKEN_HASH_SECRET}
API_JWT_ISSUER=sredi-svoih-api
API_JWT_AUDIENCE=sredi-svoih-app
MIGRATION_ACCEPT_SUPABASE_JWT=false

API_EMAIL_ENABLED=false
API_CORS_ALLOWED_ORIGINS=https://admin.example.invalid,https://public-web.example.invalid
PUBLIC_WEB_BASE_URL=https://public-web.example.invalid
API_PUBLIC_APP_BASE_URL=https://public-app.example.invalid

API_OBJECT_STORAGE_ENABLED=false
API_OBJECT_STORAGE_ENDPOINT_URL=
API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL=
API_OBJECT_STORAGE_REGION=ru-1
API_OBJECT_STORAGE_BUCKET=
API_OBJECT_STORAGE_EVENT_IMAGES_BUCKET=event-images
API_OBJECT_STORAGE_ACCESS_KEY_ID=
API_OBJECT_STORAGE_SECRET_ACCESS_KEY=
API_OBJECT_STORAGE_PATH_STYLE=false
API_EVENT_IMAGE_PUBLIC_BASE_URL=

API_PUSH_ENABLED=false
API_PUSH_PRODUCTION_SIGNOFF=false
API_PRIVACY_ERASURE_WORKER_ENABLED=false
EOF
chmod 600 infra/env/.env.api.production
```

The placeholder object-storage region is inert while
`API_OBJECT_STORAGE_ENABLED=false`; replace it with the provider's real region
when S3 is approved.

After both files have been written, remove the secrets from the interactive
shell variables:

```bash
unset POSTGRES_PASSWORD API_JWT_SECRET API_TOKEN_HASH_SECRET GIT_SHA
```

## 6. Verify permissions and Git isolation

Do not display file contents.

```bash
cd /opt/sredi-svoih
stat -c '%a %U:%G %n' infra/env/.env.compose.production infra/env/.env.api.production
git status --short
git check-ignore -v infra/env/.env.compose.production infra/env/.env.api.production
```

Expected security properties:

```text
mode: 600
owner: deploy
git status: no tracked changes caused by the secret files
both secret paths: ignored
```

If permissions are broader than `0600`, fix them before any Compose command:

```bash
chmod 600 infra/env/.env.compose.production infra/env/.env.api.production
```

## 7. Validate Compose without printing resolved secrets

Use quiet validation. Do not use plain `docker compose config` with real
production env files because the rendered configuration can expose resolved
credentials in terminal scrollback or logs.

```bash
cd /opt/sredi-svoih
sudo docker compose \
  --env-file infra/env/.env.compose.production \
  -f infra/docker-compose.prod.yml \
  config --quiet
```

The command must exit successfully and produce no rendered configuration.

Before starting services, also confirm the checked-in Compose file still has
the expected network boundary:

```bash
git grep -n '127.0.0.1:8000:8000' -- infra/docker-compose.prod.yml
git grep -n 'api_postgres:' -- infra/docker-compose.prod.yml
```

Do not add a PostgreSQL `ports:` mapping and do not change the API binding to
`0.0.0.0:8000`.

## 8. DNS state for this deployment

The current API hostname is:

```text
api.pgs24.ru
```

For this first start:

- do not change DNS if the hostname still resolves to the prepared Selectel
  host and the existing certificate is valid;
- do not put DNS-provider credentials into either production env file;
- DNS credentials are infrastructure-management credentials, not API runtime
  secrets;
- a later move to the permanent domain requires a controlled DNS, Nginx, TLS,
  CORS, client-build, and public-URL cutover. It does not require moving the
  PostgreSQL volume merely because the hostname changes.

## 9. S3 decision gate

Object storage is deliberately disabled for the first API/PostgreSQL health
start:

```text
API_OBJECT_STORAGE_ENABLED=false
```

Before enabling it, record and verify all of the following outside the
repository:

- provider and Russian region/data-location evidence;
- private avatar bucket name;
- event-image bucket name and public-read policy required by the current event
  image contract;
- API endpoint URL;
- public object endpoint or event-image public base URL;
- path-style versus virtual-host addressing requirement;
- least-privilege access key scoped only to the required buckets/actions;
- lifecycle, backup/recovery, CORS, and object deletion behavior.

Only after that review should the owner replace the disabled S3 fields in
`infra/env/.env.api.production`, validate the API configuration, and enable
`API_OBJECT_STORAGE_ENABLED=true`.

Do not put S3 credentials in `apps/admin`, `apps/web`, Expo/mobile env, GitHub
issues, PR bodies, or committed examples.

## 10. First controlled service-start order

After the secret files and quiet Compose validation pass, use this order:

```text
1. PostgreSQL only
2. wait for PostgreSQL health
3. build/select the approved immutable API image
4. run the owner-controlled Alembic migration service once
5. start FastAPI
6. verify host sockets
7. verify local /health
8. verify public HTTPS /health and /version
9. only then prepare client URL/CORS cutover
```

The concrete service commands belong to the next deployment step. Do not start
PostgreSQL as part of secret-file creation merely to test this checklist.

## 11. Stop conditions

Stop the deployment before starting PostgreSQL if any of these are true:

- a real secret appears in `git diff`, `git status`, terminal output intended
  for sharing, or a committed file;
- either production env file is not ignored;
- either production env file is readable by group/others;
- `docker compose ... config --quiet` fails;
- the API Compose binding is not `127.0.0.1:8000:8000`;
- PostgreSQL gains a host/public port mapping;
- the checked-out commit is not the intended approved production commit;
- TLS/renewal validation is not complete;
- an optional dependency is required but has not been reviewed/configured.

## Manual smoke

Not run by the agent. Manual production verification is performed by the
project owner.

For this documentation-only PR, the owner verifies after merge that:

- both production secret paths are ignored;
- generated files use mode `0600`;
- quiet Compose validation succeeds without rendering secrets;
- optional services remain disabled;
- no PostgreSQL or FastAPI service is started until the next explicit
  deployment step.
