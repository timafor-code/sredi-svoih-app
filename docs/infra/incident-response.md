# Production incident response runbook

## Purpose and boundaries

This owner-operated runbook covers incidents in the post-PR-38 Python API,
PostgreSQL, object storage, TLS/reverse proxy, browser CORS, and mobile API
endpoint path. It does not authorize automated deployment, server mutation,
database migration, backup, restore, or client smoke testing.

Use it with [the production deployment runbook](api-production-deploy.md) and
[the PostgreSQL backup and restore runbook](postgres-backup-restore.md). The
owner chooses severity, external communication, provider/on-call model, and any
production recovery action. This document does not make legal or regulatory
claims.

## Detection and initial triage

Open an incident when any signal is sustained, correlated, or judged to risk
user data:

- public `GET /health` or `GET /version` fails, returns unexpected release
  data, or is unavailable over valid TLS;
- API 5xx/timeout rate, restart rate, latency, request rejection, or safe
  storage/database error metrics exceed owner threshold;
- PostgreSQL availability, connection failures, replication/provider health,
  storage capacity, or backup/restore-test alerts fire;
- S3-compatible storage cannot create signed URLs, accept expected uploads, or
  return authorized reads;
- certificate expiry, DNS, TLS handshake, reverse-proxy, or HTTP-to-HTTPS
  redirect behavior fails;
- web-admin preflight rejects approved origin or permits an unexpected origin;
  or
- a released mobile build reports API network failure after endpoint,
  certificate, or release change.

Initial operator actions:

1. Declare an incident owner and operations recorder. Record UTC time,
   environment, public symptom, release SHA/API version, and safe request IDs.
   Do not copy request/response bodies into the record.
2. Confirm scope with least-invasive checks: TLS reachability, `/health`,
   `/version`, release identity, proxy status, and provider health. `/health`
   is liveness only and does not query PostgreSQL.
3. Classify the suspected layer: API/process, DB, object storage, proxy/TLS,
   CORS, mobile endpoint/release configuration, or combination. State
   uncertainty rather than guessing.
4. Preserve redacted evidence: timestamps, status codes, aggregate metrics,
   release IDs, request IDs, certificate metadata, and backup artifact IDs.
   Restrict access to the incident record.
5. Decide whether writes need limiting. The owner, not an automated job,
   decides maintenance, traffic reduction, credential rotation, backup,
   database restore, or external notification.

## Safe containment

Containment limits harm while preserving data and evidence:

- Stop rollout/canary expansion first. Do not delete containers, databases,
  storage objects, backups, logs, or release artifacts to tidy a dashboard.
- If writes could worsen corruption or inconsistency, use owner-selected proxy
  controls to restrict writes/enter maintenance. Record time and routes.
- Keep PostgreSQL private. Do not expose port 5432, copy DB to a workstation,
  or give client applications direct DB access to diagnose an incident.
- If a secret, signed URL, JWT, refresh token, password, invite code, or reset
  code is suspected exposed, revoke/rotate through approved secret or identity
  management. Do not paste the value into a ticket to prove exposure.
- Take a fresh protected backup before owner-approved destructive recovery. A
  DB restore is not the default response to an API deployment problem.
- Prefer a known-compatible previous API artifact over DB downgrade. Follow the
  data-preserving rollback in [the deployment runbook](api-production-deploy.md).

## Service-specific response guidance

### API process or release failure

1. Compare `/version` API version and optional Git SHA to intended immutable
   release. Capture request/correlation IDs from failures when available.
2. Check process health, private DB/storage reachability, runtime events, and
   configuration presence without displaying environment values.
3. Stop expansion. If previous release is confirmed compatible with current
   Alembic schema, route traffic back to that immutable artifact. Do not run
   automatic migration downgrades.
4. If compatibility is unknown, restrict writes and escalate. Take a backup
   before any recovery action.

### PostgreSQL failure or suspected data issue

1. Treat DB unavailability, replication/provider alarms, disk pressure, or
   suspected corruption as data-protection incident. Restrict API writes when
   necessary and record last known-good time.
2. Check provider/service health and aggregate failures through privileged
   operator access; do not run queries that print personal data.
3. Locate newest restore-tested backup and its record. An untested artifact is
   not a recovery guarantee.
4. Escalate for any snapshot, failover, point-in-time recovery, or production
   restore. Follow [backup and restore](postgres-backup-restore.md); test the
   chosen artifact in separate disposable verification DB whenever possible.

### Object-storage or signed-avatar failure

1. Determine whether failure is API internal endpoint, public presigned-URL
   endpoint, DNS/TLS, bucket policy, storage CORS, or provider health. Do not
   log signed URL, bucket credential, object key, or image bytes.
2. Preserve objects/metadata. Do not bulk-delete, recreate bucket, make bucket
   public, or disable authorization as a workaround.
3. If upload confirmation is unreliable, restrict new avatar writes through
   approved traffic/API control while preserving reads where safely possible.
4. Check storage versioning/backup recovery with DB recovery point. Metadata
   and avatar objects may require coordinated recovery.

### TLS, DNS, or reverse-proxy failure

1. Confirm expected hostname, certificate validity/expiry, handshake, DNS,
   and proxy upstream. Record metadata only, not authorization headers/bodies.
2. Restore approved certificate/proxy config or route to known-good edge
   configuration. Keep API port 8000 and DB ports private.
3. Do not bypass TLS by publishing HTTP mobile API URL for production. Any
   temporary endpoint is an owner security and mobile-release decision.

### Admin CORS failure

1. Compare browser `Origin` with `API_CORS_ALLOWED_ORIGINS` and actual admin
   origin. Scheme, host, and port matter; base path does not belong there.
2. Verify required `Authorization`, `Content-Type`, `X-Request-ID` headers and
   supported methods, then test preflight without credentials.
3. Change only explicit approved origins after owner review. Never add `*` or
   reflect arbitrary origins to make browser requests work.

### Mobile API endpoint failure

1. Determine `EXPO_PUBLIC_API_URL` embedded in affected release via safe
   release metadata. It must be approved HTTPS API base URL, not loopback,
   private DB endpoint, or credential-bearing URL.
2. Test public endpoint TLS and `/health` independently; compare known-good
   mobile release and current API deployment.
3. If embedded endpoint is wrong, server config alone cannot repair every
   installed build. Owner decides compatible server route, mobile rollback, or
   corrected mobile release.

## Log redaction requirements

`apps/api/app/core/redaction.py` contains `redact_for_log` and
`redact_email_address`; email delivery uses them. The unhandled-error handler
records request ID and path; `apps/api/app/core/logging.py` configures basic
Python logging. These facts do not replace an operational redaction review for
API runtime, reverse proxy, DB provider, object storage, deployment platform,
and monitoring collector.

The following must never appear raw in logs, dashboards, alerts, tickets,
traces, error payloads, shell history, screenshots, or incident notes:

- email addresses, phone numbers, names, and other personal data;
- JWTs, `Authorization` values, refresh tokens, cookies, passwords, password
  hashes, email-verification codes, password-reset codes, set-password codes,
  and invite codes;
- registration comments, privacy-request messages, device push tokens, signed
  avatar URLs, object keys, bucket names, storage credentials, image bytes,
  DB connection strings, and secret-manager payloads; and
- raw request/response bodies, query strings with sensitive data, or unredacted
  provider error payloads.

Use safe correlation instead: request ID, release SHA/version, UTC timestamp,
status code, endpoint class, aggregate count, redacted error category, and
approved opaque job/artifact ID. Proxy access logs require special review;
they can capture query strings and authorization headers unless configured not
to.

If prohibited values reach a log destination, treat it as security incident:
restrict access, rotate/revoke affected credentials or tokens where applicable,
follow protected-log procedure, and record only a redacted exposure reference.

## Backup and restore escalation

- A missed backup, checksum mismatch, untested artifact, failed restore test,
  unavailable destination, or unknown provenance is a recovery risk for owner
  triage.
- Never overwrite production merely to test a backup. Restore tests use a
  separate disposable verification DB.
- Before owner-approved production restore, restrict writes as decided, choose
  restore point/object-storage consistency plan, take current protected backup
  if feasible, and prepare post-restore verification/communication.
- After DB recovery, verify migration state, storage consistency, API/DB,
  CORS, TLS, and only approved least-privilege client flows. Preserve
  pre-recovery evidence and backup IDs.

## Rollout rollback guidance

For deploy regressions, use [the deployment runbook](api-production-deploy.md):
halt expansion, preserve data, verify previous-release compatibility, then route
only to known-good immutable artifact when safe. API artifact rollback and
CORS/TLS fixes do not authorize DB downgrade, table deletion, storage cleanup,
or restore.

Owner must explicitly decide when to:

- restrict or restore writes;
- rotate secret or invalidate credential;
- roll back API/admin/mobile release;
- fail over PostgreSQL or object storage;
- restore production data;
- communicate externally; or
- close incident and reopen rollout.

## Post-incident verification checklist

- [ ] Incident owner recorded scope, UTC timeline, affected release, safe
  request IDs, decisions, and redacted evidence.
- [ ] API `/health` and `/version` work through valid TLS; release identity is
  intended stable artifact.
- [ ] DB availability, migration state, backup age, and latest restore-test
  status are verified without reading raw data.
- [ ] Storage is private, authorized signed-avatar paths work, and no signed
  URL/credential entered logs.
- [ ] Exact approved admin origin passes CORS preflight; unapproved origins do
  not receive credentialed access.
- [ ] Affected mobile release points at intended HTTPS API URL, or owner has
  approved compatible rollback/corrected-release plan.
- [ ] Alerts, dashboards, proxy/API logs, and incident notes were reviewed for
  prohibited raw data. Any exposure has separate security-response record.
- [ ] Owner approved normal traffic and documented follow-up, including
  backup/restore or deployment-runbook improvements.
