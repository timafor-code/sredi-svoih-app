# Python API production deployment runbook

## Purpose and operating boundary

This owner-run runbook covers the post-PR-38 production architecture. It
documents the repository at PR 39; it does not deploy, create infrastructure,
or authorize a production change.

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
Expo mobile release                         web-admin static build
EXPO_PUBLIC_API_URL                         VITE_API_URL
          |                                        |
          +------------ HTTPS JSON API ------------+
                               |
                     TLS reverse proxy
                     <api-domain>:443
                               |
              private upstream, port 8000
                               |
             apps/api FastAPI container/image
                   |                    |
     private PostgreSQL in Russia   private S3-compatible storage in Russia
                                     |
                         public HTTPS endpoint only for short-lived
                         presigned avatar upload/read URLs
```

| Component | Verified repository fact | Production requirement / owner decision |
| --- | --- | --- |
| API | `apps/api` is FastAPI. `apps/api/Dockerfile.local` starts `uvicorn app.main:app --host 0.0.0.0 --port 8000`. | Choose Russia-hosted compute, runner, registry, private network, supervision, and resource limits. No production Compose file, systemd unit, proxy configuration, or provider is checked in. |
| PostgreSQL | The local contour uses `postgres:16-alpine` as `api_postgres`, locally bound at `127.0.0.1:55432:5432`. Alembic is under `apps/api/alembic`. | Run PostgreSQL in Russia on a private network. Do not expose 5432 to the public, mobile, or web-admin. Choose managed/self-managed operation, availability, and backups. |
| Object storage | Local MinIO service `api_object_storage` exposes port 9000 internally and creates the private `avatars` bucket with anonymous access disabled. | Use Russia-hosted S3-compatible storage and a private bucket. Choose public signed-URL hostname, TLS, CORS, versioning, lifecycle, and recovery. Local MinIO is not the production provider. |
| Web-admin | `apps/admin/src/services/apiClient.ts` reads `VITE_API_URL`. | Build the static artifact with the production API URL and allow that exact browser origin through API CORS. |
| Mobile | `src/services/apiClient.ts` reads `EXPO_PUBLIC_API_URL`. | Embed the public HTTPS API URL in the mobile build. It is public configuration, not a secret. |
| Health | `GET /health` returns process status/service. `GET /version` returns service, version, environment, optional Git SHA, and timestamp. | Monitor both through the public proxy. `/health` is liveness only; it does not query PostgreSQL. Check migrations separately. |

### Local Compose is not a production recipe

`infra/docker-compose.api.yml` is a local development contour only. It uses
synthetic local PostgreSQL, MinIO, JWT, token-hash, and storage values from
`infra/env/api.env.example`; publishes `8000:8000`; has no TLS; and has no
production secret integration. Do not copy it or its values to production.

It is useful only as a verified reference for local services: `api_backend`,
`api_postgres`, `api_object_storage`, `api_object_storage_init`, and the
optional `api_push_worker` profile.

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
- **TLS:** certificate issuer, renewal owner, DNS validation, expiry alerts,
  and reverse-proxy product. The repository selects none of these.
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

## Server preparation

This is provider-neutral preparation guidance, not evidence that a provider
configuration already exists.

1. Provision separate least-privilege access for API host, database
   administration, storage administration, and backups. Record break-glass
   access outside this repository.
2. Put PostgreSQL and storage on private networks. Permit the API workload
   only the necessary service routes. Do not publish the database,
   object-storage console, credentials, or database connection string.
3. Expose only the reverse proxy/load balancer publicly. It should accept 443
   and, if used, 80 only to redirect to HTTPS. Bind FastAPI port 8000 to
   loopback or a private service network, not a public interface.
4. Install and patch the selected container/runtime and PostgreSQL client
   tools. The checked-in Python target is 3.12; `apps/api/pyproject.toml`
   requires Python `>=3.12`.
5. Configure alerts for disk capacity, service health, certificate expiry,
   backup jobs, database/storage availability, and application error rates.
   Alerts must use release IDs or request IDs, never request bodies or PII.
6. Give the deployer read access to the intended artifact and narrowly scoped
   access to inject API secrets. It must not have client secret paths or broad
   backup/storage deletion permission.

## Reverse proxy and TLS requirements

No proxy configuration is checked in. The owner must implement and review the
following in the selected product:

- Terminate a valid certificate for `https://<api-domain>` and redirect HTTP
  to HTTPS; monitor expiry and renewal.
- Proxy all API paths, including `/health` and `/version`, to the private API
  upstream on port 8000 without stripping paths. Keep the upstream private.
- Preserve host and scheme through the chosen proxy headers. Forward a valid
  `X-Request-ID` when supplied, or allow the API to generate one; return the
  API response's `X-Request-ID` for safe correlation.
- Set conservative request-size, timeout, rate-limit, and access-log rules.
  Do not log `Authorization`, cookies, signed-URL query strings, or bodies.
- Configure trusted forwarded headers only when the runtime/proxy explicitly
  supports it. The checked-in application has no trusted-proxy allowlist; do
  not trust client-supplied forwarding headers by default.
- Keep browser CORS in API configuration, not a permissive proxy rule.

Owner-run staging checks:

```powershell
curl -fsS https://<api-domain>/health
curl -fsS https://<api-domain>/version
```

Expected `/health` data is `status: "ok"` and the configured service name.
`/version` includes `api_version`, `environment`, and, when supplied,
`git_sha`. Do not put secrets in URLs or command lines.

## API environment inventory

`apps/api/app/core/config.py` is the source of this inventory. API settings are
server-side only. Inject **Secret** values at runtime through the approved
mechanism; `apps/api/.env.example` and `infra/env/api.env.example` are not
production secret stores.

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
2. **Build the verified API source.** The only API Dockerfile is
   `apps/api/Dockerfile.local`, which exposes port 8000. A standard Docker
   build grounded in that path is:

   ```powershell
   docker build -f apps/api/Dockerfile.local -t sredi-svoih-api:<immutable-release> apps/api
   ```

   This does not define a production runner, registry, network, or secret
   mechanism.
3. **Validate resolved configuration without printing secrets.** Confirm
   production environment, exact CORS origins, private DB/storage routes,
   release identity, and disabled migration compatibility path.
4. **Take and verify a pre-migration backup.** Follow
   [backup and restore](postgres-backup-restore.md), recording artifact ID and
   last successful restore-test result.
5. **Run Alembic once from the approved image.** `apps/api/alembic/env.py`
   reads API settings; the verified command is `alembic upgrade head`. An
   illustrative workload command is:

   ```powershell
   docker run --rm --env-file <secret-manager-runtime-file> sredi-svoih-api:<immutable-release> alembic upgrade head
   ```

   The file is a **Placeholder** for an owner-controlled non-repository secret
   delivery method. Do not run concurrent migration jobs, automatic downgrades,
   or production migrations from a developer workstation.
6. **Deploy private API instance(s).** Start the approved image with injected
   settings; expose port 8000 only to proxy/private network; configure TLS and
   proxy rules before public traffic.
7. **Confirm migration state.** Run `alembic current` from the same approved
   image/configuration and compare it to the approved Alembic head. `/health`
   alone is not a DB check.
8. **Publish configured clients.** Build/publish admin only after
   `VITE_API_URL` is approved. Build mobile only after `EXPO_PUBLIC_API_URL`
   is approved. Neither client receives server secrets.
9. **Verify before expansion.** Check TLS, health, version, Alembic state,
   exact CORS preflight, least-privilege staging flow, and signed avatar flow
   without storing signed URLs. Review redacted logs and correlation IDs only.

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
2. Use owner-selected limited traffic/maintenance if writes could worsen the
   incident; preserve redacted evidence.
3. Verify previous API artifact compatibility with the current Alembic schema.
   If compatible, route traffic to that immutable artifact and retain data.
4. If uncertain, restrict writes and escalate. Take a fresh backup before any
   recovery. A database restore is a separate owner-approved procedure in
   [backup and restore](postgres-backup-restore.md), not a deploy command.
5. Preserve storage objects/backups. Rotate only credentials suspected exposed.
6. Verify TLS, health, version, migration compatibility, CORS, and safe client
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
