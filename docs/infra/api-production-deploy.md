# Python API production deployment runbook

## Purpose and operating boundary

This owner-run runbook covers the checked-in single-host production
architecture. It documents preparation and promotion; it does not deploy,
create infrastructure, issue a certificate, or authorize a production change.

| Label | Meaning |
| --- | --- |
| **Repository-defined** | A checked-in path, setting, behavior, or command verified in this repository. |
| **Placeholder** | An illustrative value in angle brackets, such as `<api-domain>`; never use it unchanged. |
| **Owner decision** | A production choice that must be approved and recorded by the owner. |
| **Secret** | Supply only through the owner-approved production secret-management mechanism. Never put it in the repository, a client build, shell history, ticket, or log. |

The Python API is the only production data boundary for mobile and web-admin.
Neither client may connect directly to PostgreSQL. This document makes no legal,
data-localization, certification, or regulatory claim; the owner must obtain
the review appropriate to selected providers and data.

Related runbooks:

- [PostgreSQL backup and restore](postgres-backup-restore.md) defines the
  restore test that must succeed before a backup is trusted.
- [Incident response](incident-response.md) governs containment, evidence, and
  recovery decisions.

## Verified topology

```text
Internet
  -> host Nginx :443
  -> 127.0.0.1:8000
  -> FastAPI container
  -> private Docker database network
  -> PostgreSQL
```

Nginx is the only public application ingress and runs directly on the prepared
Ubuntu host. It is not a Docker service. External object storage remains a
separate, disabled-by-default dependency and is not part of this checked-in
request path.

| Component | Verified repository fact | Production requirement / owner decision |
| --- | --- | --- |
| API | `apps/api` is FastAPI. `apps/api/Dockerfile` is the production image and starts `uvicorn app.main:app --host 0.0.0.0 --port 8000`; `apps/api/Dockerfile.local` is local-development-only. | `infra/docker-compose.prod.yml` defines the checked-in single-host production container topology. The owner still chooses the immutable image tag, secrets, resource limits, and promotion timing. |
| Privacy erasure worker | `python -m app.workers.privacy_erasure` is a separate process using the same backend image and PostgreSQL/storage/email dependencies. It is not a FastAPI background task and exposes no HTTP trigger. | Supervise it independently from FastAPI. Run one or more instances only after migrations and dependencies are ready, with the backend-only enable flag and mandatory erasure/retention configuration reviewed. |
| PostgreSQL | The local contour uses `postgres:16-alpine` as `api_postgres`, locally bound at `127.0.0.1:55432:5432`. Alembic is under `apps/api/alembic`. | Run PostgreSQL in Russia on a private network. Do not expose 5432 to the public, mobile, or web-admin. Choose managed/self-managed operation, availability, and backups. |
| Object storage | Local MinIO service `api_object_storage` exposes port 9000 internally and creates the private `avatars` bucket with anonymous access disabled. | Use Russia-hosted S3-compatible storage and a private bucket. Choose public signed-URL hostname, TLS, CORS, versioning, lifecycle, and recovery. Local MinIO is not the production provider. |
| Web-admin | `apps/admin/src/services/apiClient.ts` reads `VITE_API_URL`. | Build the static artifact with the production API URL and allow that exact browser origin through API CORS. |
| Mobile | `src/services/apiClient.ts` reads `EXPO_PUBLIC_API_URL`. | Embed the public HTTPS API URL in the mobile build. It is public configuration, not a secret. |
| Reverse proxy | `infra/nginx/api-http.conf.example` and `infra/nginx/api-https.conf.example` define the reviewed host-level Nginx bootstrap and TLS paths. | Replace `<api-domain>` only on the host. Nginx is not part of Compose and proxies only to `127.0.0.1:8000`. |
| Health | `GET /health` returns process status/service. `GET /version` returns service, version, environment, optional Git SHA, and timestamp. | Monitor both through the public proxy. `/health` is liveness only; it does not query PostgreSQL. Check migrations separately. |

### Local Compose is not a production recipe

`infra/docker-compose.api.yml` and the `apps/api/Dockerfile.local` images it
builds are a local development contour only. They use synthetic local
PostgreSQL, MinIO, JWT, token-hash, and storage values from
`infra/env/api.env.example`; publish `8000:8000`; have no TLS; and have no
production secret integration. Do not copy them or their values to production.

It is useful only as a verified reference for local services: `api_backend`,
`api_postgres`, `api_object_storage`, `api_object_storage_init`, and the
optional `api_push_worker` profile, and the separate
`api_privacy_erasure_worker` service.

### Checked-in single-host production Compose

`infra/docker-compose.prod.yml` is the production-only topology for the
prepared single host. It builds the API-backed services from
`apps/api/Dockerfile`, keeps the image's canonical FastAPI command, runs
PostgreSQL 16 on a persistent named volume, and provides an owner-invoked
one-shot `api_migrate` service. It does not change or replace the local-only
`infra/docker-compose.api.yml` contour.

FastAPI is published only as `127.0.0.1:8000:8000`; PostgreSQL has no published
host port and joins only the internal `api_database` network. FastAPI and the
optional privacy-erasure worker also join the egress-capable `api_egress`
network for reviewed external HTTPS dependencies. The Compose file publishes
neither the database network nor external dependency ports.

The migration service is behind the `migration` profile and runs only when the
owner explicitly targets `api_migrate`. The privacy-erasure worker is behind
the `privacy-erasure` profile and remains disabled in the committed production
environment example. No push worker, MinIO, or Mailpit service is included.

Host-level Nginx and TLS templates are checked in under `infra/nginx/`. Nginx
remains intentionally outside `infra/docker-compose.prod.yml`; do not add an
Nginx container. Compose does not provision production object storage: the API
environment contract is ready for a separately reviewed external Russia-hosted
S3-compatible service.

## Prerequisites and owner decisions

Record these decisions in the deployment change record before staging or
production. Use placeholders until values are approved; do not add real values
to this repository.

- **Russian hosting boundary:** selected API compute, PostgreSQL, object
  storage, backup storage, and their locations/regions. Confirm provider
  evidence and legal review separately; this document does not certify them.
- **Network and DNS:** `<api-domain>`, `<admin-domain>`, private API-to-DB and
  API-to-storage routes, operator source networks, and the public
  object-storage signed-URL hostname.
- **TLS:** `<api-domain>`, certificate account/contact handling, renewal owner,
  validation method, and expiry alerts. The checked-in single-host path uses
  host-level Nginx and Certbot/Let's Encrypt placeholder paths.
- **Runtime:** immutable artifact naming, deployment runner, restart policy,
  resource limits, operating-system patching, time synchronization, and log
  destination.
- **Secrets:** secret manager, access policy, rotation owner, audit route, and
  runtime delivery method. Local examples are not production secret templates.
- **Data recovery:** backup schedule, retention, encryption, isolated copy,
  recovery objectives, and disposable restore-test environment. Follow the
  backup runbook before promotion.
- **Auth/email:** production issuer/audience decisions, an actual email
  delivery path if email is enabled, and the migration path for OAuth-only
  users. Do not enable production API auth without that migration path.
- **Push:** whether push delivery is enabled. It remains disabled unless the
  owner explicitly signs off on production behavior and external delivery
  transit.
- **Privacy erasure:** whether the automatic worker is enabled, its poll
  interval and batch size, notification encryption/delivery configuration,
  restore-register storage, and the owner/legal-approved financial retention
  duration where finalized financial evidence exists.

## Server preparation

This is provider-neutral preparation guidance, not evidence that a provider
configuration already exists.

1. Provision separate least-privilege access for API host, database
   administration, storage administration, and backups. Record break-glass
   access outside this repository.
2. Put PostgreSQL and storage on private networks. Permit the API workload
   only the necessary service routes. Do not publish the database,
   object-storage console, credentials, or database connection string.
3. Expose only host-level Nginx publicly. It accepts 443 and uses 80 only for
   HTTP-01 validation and HTTPS redirects. FastAPI remains bound to
   `127.0.0.1:8000`; PostgreSQL has no published host port.
4. Install and patch the selected container/runtime and PostgreSQL client
   tools. The checked-in Python target is 3.12; `apps/api/pyproject.toml`
   requires Python `>=3.12`.
5. Configure alerts for disk capacity, service health, certificate expiry,
   backup jobs, database/storage availability, and application error rates.
   Alerts must use release IDs or request IDs, never request bodies or PII.
6. Give the deployer read access to the intended artifact and narrowly scoped
   access to inject API secrets. It must not have client secret paths or broad
   backup/storage deletion permission.

## Host Nginx and TLS owner-run sequence

The two files under `infra/nginx/` are templates, not deployable unchanged.
They contain no real domain, IP address, certificate, private key, or secret.
The Ubuntu host owns Nginx; `infra/docker-compose.prod.yml` owns only the
loopback-published FastAPI container and its private database network.

The final proxy passes all paths without rewriting to
`http://127.0.0.1:8000`, including `/health` and `/version`. It replaces
caller-supplied forwarding metadata with values derived from Nginx's direct
connection. The application accepts UUID `X-Request-ID` values and generates a
new UUID for an absent or invalid value, so the proxy passes the original
header to that application validator and logs only the response request ID.
The 13 MiB Nginx body ceiling covers the backend's 12 MiB event-image source
plus its 64 KiB multipart envelope; the backend remains the precise validator.

### Phase A — DNS prerequisite

1. The owner chooses the real `<api-domain>` and records it outside Git.
2. The owner creates a DNS A record for that hostname pointing to the
   production server's public IPv4. Do not add the public IP to this repository.
3. Wait until public DNS resolvers return the correct address before requesting
   a certificate. Certificate issuance must not begin while DNS is stale or
   incorrect.

### Phase B — host packages

On Ubuntu 24.04, the owner installs the distribution Nginx package:

```bash
sudo apt update
sudo apt install --yes nginx snapd
```

For Certbot, use the [currently recommended official snap installation
path](https://certbot.eff.org/instructions?ws=nginx&os=snap). This method is
identified explicitly; do not assume Certbot is already present and do not mix
the snap with an OS-packaged Certbot installation.

```bash
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
certbot --version
```

If `/usr/local/bin/certbot` already exists, verify that it resolves to
`/snap/bin/certbot` instead of overwriting it blindly. These are owner-run host
commands, never Codex-run deployment commands.

### Phase C — HTTP bootstrap

1. Create the HTTP-01 webroot on the host:

   ```bash
   sudo install -d -m 0755 /var/www/certbot/.well-known/acme-challenge
   ```

2. Copy `infra/nginx/api-http.conf.example` from the production workspace and
   replace every `<api-domain>` with the real hostname in the host copy only:

   ```bash
   sudo install -m 0644 /opt/sredi-svoih/infra/nginx/api-http.conf.example /etc/nginx/sites-available/sredi-svoih-api.conf
   sudoedit /etc/nginx/sites-available/sredi-svoih-api.conf
   sudo ln -s /etc/nginx/sites-available/sredi-svoih-api.conf /etc/nginx/sites-enabled/sredi-svoih-api.conf
   ```

3. If `/etc/nginx/sites-enabled/default` exists, disable that default-site
   symlink so the checked-in catch-all owns port 80. Then validate before any
   reload:

   ```bash
   sudo unlink /etc/nginx/sites-enabled/default
   sudo nginx -t
   sudo systemctl reload nginx
   ```

   Run the reload only when `sudo nginx -t` succeeds. If the default symlink is
   absent, skip only the `unlink` command.

4. Verify the intended hostname reaches the HTTP-01 webroot on public port 80
   before issuance. The bootstrap returns 503 for ordinary API paths because
   plaintext API traffic is not production-ready and is never proxied.

   ```bash
   printf '%s\n' 'http-01-owner-probe' | sudo tee /var/www/certbot/.well-known/acme-challenge/owner-probe >/dev/null
   curl -fsS http://<api-domain>/.well-known/acme-challenge/owner-probe
   sudo rm /var/www/certbot/.well-known/acme-challenge/owner-probe
   ```

### Phase D — certificate issuance

Only after public DNS and port 80 are correct, the owner issues the certificate
for the actual hostname:

```bash
sudo certbot certonly --webroot --webroot-path /var/www/certbot --domain <api-domain>
```

`certonly --webroot` is the conservative path: Certbot writes the HTTP-01 token
under the dedicated webroot but does not rewrite unrelated Nginx configuration.
Handle Certbot account, contact email, and private-key material only on the
host; do not put them in Git. HTTP-01 requires the hostname to be publicly
reachable on port 80. DNS validation is an intentional owner-selected
alternative when inbound port 80 is not used.

Certificate issuance is owner-run and must never be run by Codex against a real
domain.

### Phase E — HTTPS promotion

1. Copy `infra/nginx/api-https.conf.example` over the enabled site's source,
   replace every `<api-domain>` in the host copy, and confirm the referenced
   Certbot certificate paths exist:

   ```bash
   sudo install -m 0644 /opt/sredi-svoih/infra/nginx/api-https.conf.example /etc/nginx/sites-available/sredi-svoih-api.conf
   sudoedit /etc/nginx/sites-available/sredi-svoih-api.conf
   sudo nginx -t
   sudo systemctl reload nginx
   ```

   Reload only after `sudo nginx -t` succeeds. Do not enable HSTS, HTTP/3, or
   QUIC during this promotion. HSTS is a later owner decision after HTTPS is
   stable and its domain/subdomain consequences are understood.

2. Verify the active Nginx configuration proxies only to loopback, HTTP
   redirects ordinary API traffic to the fixed HTTPS hostname, and HTTPS serves
   the intended hostname:

   ```bash
   sudo nginx -T | grep -F 'proxy_pass http://127.0.0.1:8000;'
   curl -I http://<api-domain>/health
   curl -fsS https://<api-domain>/health
   curl -fsS https://<api-domain>/version
   sudo ss -ltn
   ```

   Expect the HTTP health request to redirect to HTTPS. Confirm the socket list
   shows FastAPI only on `127.0.0.1:8000`, no public `:8000`, and no published
   PostgreSQL `:5432`. Expected `/health` data is `status: "ok"` and the
   configured service name. `/version` includes `api_version`, `environment`,
   and, when supplied, `git_sha`. Do not put secrets in URLs or command lines.

### Phase F — renewal

Test renewal and inspect the schedule supplied by the Certbot snap:

```bash
sudo certbot renew --dry-run
systemctl list-timers --all | grep -E 'certbot|snap.certbot.renew'
systemctl status snap.certbot.renew.timer
```

The installed Certbot package supplies automated renewal. Do not add a custom
renewal cron job. If the exact timer unit differs, use `systemctl list-timers`
and `snap services certbot` to identify the installed schedule and record the
result in the owner change record.

## API environment inventory

`apps/api/app/core/config.py` is the source of this inventory. API settings are
server-side only. Inject **Secret** values at runtime through the approved
mechanism; `apps/api/.env.example` and `infra/env/api.env.example` are not
production secret stores.

The committed `infra/env/compose.prod.env.example` and
`infra/env/api.prod.env.example` contain fake placeholders only. On the server,
the owner creates `infra/env/.env.compose.production` and
`infra/env/.env.api.production`, restricts them to the deployment account (for
example with mode `600`), and never commits or copies them into image layers.
The repository `.gitignore` ignores `.env.*` files; verify `git status` before
every deployment and commit.

| Group | Exact setting names | Production rule |
| --- | --- | --- |
| Release identity | `APP_NAME`, `APP_ENV`, `API_VERSION`, `GIT_SHA`, `LOG_LEVEL` | `APP_ENV=production` is an **Owner decision**. Set version and optional SHA to the immutable release. Logging must not reveal request data. |
| Database | `DATABASE_URL` (or alias `API_DB_DSN`) | **Secret**, backend-only async SQLAlchemy connection string to private PostgreSQL. Never place it in Expo, Vite, `apps/admin`, `app`, `src`, static files, or logs. Local Compose `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` configure only its local DB container; they are not client settings. |
| API tokens | `API_JWT_SECRET`, `API_ACCESS_TOKEN_TTL_MINUTES`, `API_REFRESH_TOKEN_TTL_DAYS`, `API_TOKEN_HASH_SECRET`, `API_JWT_ISSUER`, `API_JWT_AUDIENCE` | JWT and token-hash material are distinct **Secrets**. TTL and issuer/audience choices are owner decisions tested in staging. |
| Legacy migration compatibility | `MIGRATION_ACCEPT_SUPABASE_JWT`, `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE` | Keep `MIGRATION_ACCEPT_SUPABASE_JWT=false` in production. This disabled migration-only path is not a production runtime dependency; do not provision its signing key. |
| Auth email | `API_AUTH_CODE_TTL_MINUTES`, `API_EMAIL_ENABLED`, `API_EMAIL_FROM_ADDRESS`, `API_EMAIL_FROM_NAME`, `API_EMAIL_SMTP_HOST`, `API_EMAIL_SMTP_PORT`, `API_EMAIL_SMTP_USERNAME`, `API_EMAIL_SMTP_PASSWORD`, `API_EMAIL_SMTP_STARTTLS`, `API_AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS`, `API_AUTH_EMAIL_RATE_LIMIT_MAX_ATTEMPTS`, `API_PUBLIC_APP_BASE_URL` | SMTP username/password are **Secrets**. Other values are owner decisions. Leave email disabled until a reviewed delivery path works. |
| Browser CORS | `API_CORS_ALLOWED_ORIGINS` | **Owner decision**, comma-separated exact browser origins. Do not use a wildcard for credentialed traffic. |
| Object storage | `API_OBJECT_STORAGE_ENABLED`, `API_OBJECT_STORAGE_ENDPOINT_URL`, `API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL`, `API_OBJECT_STORAGE_REGION`, `API_OBJECT_STORAGE_BUCKET`, `API_OBJECT_STORAGE_ACCESS_KEY_ID`, `API_OBJECT_STORAGE_SECRET_ACCESS_KEY`, `API_OBJECT_STORAGE_PATH_STYLE` | Key ID and secret are **Secrets**. Endpoints/bucket/region are owner decisions. Internal endpoint is API-to-storage; public endpoint is only for client-reachable presigned URLs. |
| Avatar limits | `API_AVATAR_UPLOAD_URL_TTL_SECONDS`, `API_AVATAR_READ_URL_TTL_SECONDS`, `API_AVATAR_MAX_SIZE_BYTES` | Owner decisions within code limits. Current defaults are 300 seconds and 5 MiB. |
| Push worker | `API_PUSH_ENABLED`, `API_PUSH_PRODUCTION_SIGNOFF`, `API_PUSH_TOKEN_ENVIRONMENT`, `API_EXPO_PUSH_ACCESS_TOKEN`, `API_EXPO_PUSH_SEND_URL`, `API_EXPO_PUSH_RECEIPTS_URL`, `API_PUSH_POLL_INTERVAL_SECONDS`, `API_PUSH_RECEIPT_DELAY_MINUTES`, `API_PUSH_REQUEST_TIMEOUT_SECONDS` | Keep disabled unless separately approved. The access token is a **Secret**. Production sends require both enabled and explicit signoff. |
| Privacy erasure worker | `API_PRIVACY_ERASURE_WORKER_ENABLED`, `API_PRIVACY_ERASURE_POLL_INTERVAL_SECONDS`, `API_PRIVACY_ERASURE_BATCH_SIZE` | Backend-only. Defaults are disabled, 30 seconds, and 10 requests; code bounds are 1-3600 seconds and 1-100 requests. Enable only on the dedicated worker process after all prerequisites below are present. Do not expose these values to clients. |
| Privacy erasure prerequisites | `API_PRIVACY_ERASURE_FINANCIAL_RETENTION_DAYS`, `API_PRIVACY_ERASURE_NOTIFICATION_KEY_B64`, `API_PRIVACY_ERASURE_NOTIFICATION_KEY_ID`, `API_PRIVACY_ERASURE_NOTIFICATION_DELIVERY_WINDOW_HOURS`, `API_PRIVACY_ERASURE_REGISTER_PREFIX`, email and object-storage settings | Encryption/storage credentials are **Secrets**. A positive owner/legal-approved retention duration is mandatory when finalized financial evidence is found; no production duration is defined by the repository. Missing mandatory configuration fails closed and leaves the account `deletion_pending`. |

Never include production values in image layers, labels, shell history, process
listings, committed env files, admin static assets, or mobile configuration.
Rotate a leaked secret and follow [incident response](incident-response.md).

### Admin CORS and browser configuration

FastAPI currently permits credentialed requests with these request headers and
methods: `Authorization`, `Content-Type`, `X-Request-ID`; `GET`, `POST`, `PUT`,
`PATCH`, `DELETE`, and `OPTIONS`. It exposes `X-Request-ID`.

For one production admin origin, use this **Placeholder** shape:

```dotenv
API_CORS_ALLOWED_ORIGINS=https://<admin-domain>
```

Add every separately hosted staging/production admin origin explicitly,
comma-separated. An origin is scheme + host + optional port, not `/admin`.

Build web-admin with browser-safe values only:

```dotenv
VITE_API_URL=https://<api-domain>
VITE_ADMIN_ENV_LABEL=production
VITE_ADMIN_BASE_PATH=/
```

`VITE_API_URL` is public build-time configuration and must be an absolute URL,
not a database or API secret. Build with the verified repository command:

```powershell
npm run admin:build
```

The output is `apps/admin/dist`. Before public traffic, owner may preflight
without credentials:

```powershell
curl.exe -i -X OPTIONS "https://<api-domain>/admin/events" -H "Origin: https://<admin-domain>" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization"
```

Confirm only the intended origin is permitted; do not broaden CORS to work
around a failed test.

### Mobile production API URL

The mobile client reads this public build-time setting:

```dotenv
EXPO_PUBLIC_API_URL=https://<api-domain>
```

It must be an absolute HTTPS API base URL with no loopback/private database
address, credential, or admin path. `EXPO_PUBLIC_*` values are embedded in the
app and must be safe to disclose. Changing this requires the owner's mobile
release process; it is not a server-side hot change.

### Public object-storage endpoint

`API_OBJECT_STORAGE_ENDPOINT_URL` is private and used for API `HEAD`/delete.
`API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL` is used only to make short-lived
signed upload/read URLs reachable from a device. It does not make the bucket
public.

Choose a public HTTPS hostname with working DNS/certificate/network paths.
Keep bucket listing and anonymous read/write disabled; configure only narrow
storage CORS needed for signed browser uploads. Never log signed URLs, object
keys, bucket credentials, or image bytes; do not expose the storage console.

## Owner-run deployment sequence

Commands with angle brackets are examples, not repository-defined production
infrastructure. Run them only after owner approval and secret injection.

1. **Prepare an immutable release.** Use an approved revision in a controlled
   deployment workspace. Record commit SHA/release tag; never build from an
   unreviewed worktree.
2. **Prepare the owner-only runtime files.** In `/opt/sredi-svoih`, derive the
   two ignored files from the committed examples, replace every placeholder
   with an approved production value, and restrict access before invoking
   Compose. The Compose env file must point `API_ENV_FILE` to
   `./env/.env.api.production`. Never commit these files or print their resolved
   values into logs.
3. **Validate and build the verified API source.** The production topology and
   dedicated image are defined by `infra/docker-compose.prod.yml` and
   `apps/api/Dockerfile`. From the production workspace, run:

   ```bash
   docker compose \
     --env-file infra/env/.env.compose.production \
     -f infra/docker-compose.prod.yml \
     config

   docker compose \
     --env-file infra/env/.env.compose.production \
     -f infra/docker-compose.prod.yml \
     build
   ```

   Confirm the resolved API binding is exactly loopback-only, PostgreSQL has no
   host binding, the database network is internal, and no local-only service is
   present. This preparation sequence intentionally omits `up -d`: proxy/TLS,
   external S3, real secrets, backup readiness, and migration prerequisites
   must be resolved first.
4. **Take and verify a pre-migration logical backup.** Follow
   [backup and restore](postgres-backup-restore.md), recording artifact ID and
   last successful restore-test result. Host disk snapshots are an additional
   recovery layer, not a replacement for the PostgreSQL logical backup and
   restore procedure.
5. **Run Alembic once from the approved image.** `apps/api/alembic/env.py`
   reads API settings; the owner-controlled one-shot command is:

   ```bash
   docker compose \
     --env-file infra/env/.env.compose.production \
     -f infra/docker-compose.prod.yml \
     run --rm api_migrate
   ```

   Run it before API promotion. The profile prevents migration execution as
   part of normal API startup. Do not run concurrent migration jobs, automatic
   downgrades, or production migrations from a developer workstation.
6. **Deploy private API instance(s), with the erasure worker disabled.** Start
   the approved image with injected settings; expose port 8000 only to
   proxy/private network; configure TLS and proxy rules before public traffic.
7. **Confirm migration state.** Run `alembic current` from the same approved
   image/configuration and compare it to the approved Alembic head. `/health`
   alone is not a DB check.
8. **Start the separate privacy-erasure worker.** From the same immutable image
   and backend configuration, run:

   ```powershell
   python -m app.workers.privacy_erasure
   ```

   Set `API_PRIVACY_ERASURE_WORKER_ENABLED=true` only after PostgreSQL,
   object storage, email delivery, notification encryption, restore-register
   storage, and the conditional retention prerequisite have been reviewed.
   The process logs startup, shutdown, claim counts, request UUIDs, result
   statuses, failure codes, and retry classification only. It must never log
   request content, identity/contact data, tokens, codes, notification
   recipients, or prayer data.
9. **Publish configured clients.** Build/publish admin only after
   `VITE_API_URL` is approved. Build mobile only after `EXPO_PUBLIC_API_URL`
   is approved. Neither client receives server secrets.
10. **Verify before expansion.** Check TLS, health, version, Alembic state,
   exact CORS preflight, least-privilege staging flow, and signed avatar flow
   without storing signed URLs. Review redacted logs and correlation IDs only.

### Privacy-erasure worker operations

The worker polls only confirmed, uncancelled, incomplete deletion requests whose
account remains `deletion_pending`. It claims a small ordered batch with
`FOR UPDATE SKIP LOCKED`, releases row locks, and keeps a PostgreSQL advisory
lock per request while calling the canonical idempotent
`execute_privacy_erasure_request(...)`. Concurrent worker instances therefore
skip an already claimed request. A crashed process loses its database session,
which releases the advisory lock so a later poll can recover the request.

Only canonical `retryable_failure` failure codes remain in the automatic queue.
Completed, cancelled, manual-review, and other non-eligible requests are not
reprocessed as new work. Restarts do not recreate destruction or retained
financial evidence. Poll waits are bounded and interruptible during graceful
shutdown.

To pause automatic erasure, stop the dedicated process or set
`API_PRIVACY_ERASURE_WORKER_ENABLED=false` and restart it. Confirmed requests
remain access-revoked and queued as `deletion_pending`; disabling the worker
does not cancel them or restore access. Re-enable the dedicated process after
the dependency/configuration issue is resolved.

`apps/api/scripts/run_privacy_erasure.py --request-id <uuid>` remains an
owner-only debug/recovery tool for one explicit request. It is not required for
normal automatic processing and is not a substitute for supervising the
dedicated worker.

## Staged rollout checklist

- [ ] Release SHA, provider/location choices, change window, operators, and
  rollback decision maker are recorded.
- [ ] PostgreSQL and object storage are private and Russia-hosted as selected
  by the owner; recovery obligations are accepted.
- [ ] A current backup has integrity evidence and a successful disposable
  restore test; see [backup and restore](postgres-backup-restore.md).
- [ ] Secrets are injected only by the approved mechanism and have not entered
  checkout, terminal history, image, static build, or logs.
- [ ] Proxy, TLS, firewall rules, and alerts are reviewed. API 8000,
  PostgreSQL, and storage administration endpoints are not public.
- [ ] Production environment, exact CORS, private endpoints, release identity,
  and disabled compatibility bridge are reviewed without printing secrets.
- [ ] First instance passes public health/version and Alembic state is checked
  separately.
- [ ] Start with an owner-approved canary. Monitor safe status/latency,
  request IDs, restarts, DB/storage errors, certificate state, and backup jobs;
  never use raw requests/tokens as diagnostics.
- [ ] Verify approved-origin admin CORS and a least-privilege admin flow;
  never use `*` as a workaround.
- [ ] Verify a production-configured mobile build uses HTTPS and signed-avatar
  flow reveals no credentials, object keys, or signed URLs in logs.
- [ ] Expand only after owner accepts canary evidence; observe post-rollout.

## Rollback checklist: preserve data first

An API rollback is not automatically a database rollback. Do not destroy data,
drop tables, delete storage, run `alembic downgrade`, or restore a database
merely because an application artifact is being rolled back.

1. Stop expansion; record release SHA, time, symptoms, request IDs, and owner
   decision. Start [incident response](incident-response.md) for user impact
   or data risk.
2. Stop or disable the privacy-erasure worker before rolling back its runtime.
   Queued `deletion_pending` requests remain queued and access-revoked. Do not
   cancel requests, clear failure state, remove evidence, or restore accounts.
3. Use owner-selected limited traffic/maintenance if writes could worsen the
   incident; preserve redacted evidence.
4. Verify previous API artifact compatibility with the current Alembic schema.
   If compatible, route traffic to that immutable artifact and retain data.
5. If uncertain, restrict writes and escalate. Take a fresh backup before any
   recovery. A database restore is a separate owner-approved procedure in
   [backup and restore](postgres-backup-restore.md), not a deploy command.
6. Preserve storage objects/backups. Rotate only credentials suspected exposed.
7. Verify TLS, health, version, migration compatibility, CORS, and safe client
   flows before lifting restrictions; record follow-up work.

## Owner-only staging exercise checklist

This is manual; it is not a request for agent-run browser, Expo, iPhone,
server, database, backup, restore, or deployment actions.

- [ ] Review all three runbooks with selected hosting, database, storage, TLS,
  and secret-management owners.
- [ ] Deploy a synthetic-data staging release with immutable artifact and
  private DB/storage route.
- [ ] Exercise certificate issuance/renewal and HTTPS proxying to private API.
- [ ] Build staging admin with `VITE_API_URL=https://<staging-api-domain>` and
  prove only exact staging origin passes CORS preflight.
- [ ] Build owner-controlled staging mobile with
  `EXPO_PUBLIC_API_URL=https://<staging-api-domain>`; confirm no loopback,
  database, or secret value is embedded.
- [ ] Run and record the disposable restore drill: artifact ID, duration,
  migration state, integrity/application result.
- [ ] Exercise a staging canary, monitoring handoff, and data-preserving API
  rollback. Do not use destructive migrations or production data without
  separate approval.
- [ ] Review proxy/API/DB/storage/deployment logs for redaction: correlation
  and release IDs are allowed; PII and credentials are not.
