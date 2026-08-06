# Privacy, Hosting, And Localization

Source of truth: repository-root `plan.md`, version `2026-07-06 v2.7`.

This document records production data-residency and hosting constraints for the
backend migration. It supplements the existing privacy notes and does not change
runtime behavior in PR 1.

## Production Residency Decision

Production personal data of Russian citizens must not be stored in Western
Supabase after production cutover.

Before production cutover, these data classes must live in Russia-hosted
PostgreSQL or Russia-hosted object storage:

- app users;
- profiles;
- memberships;
- registrations;
- invites;
- device tokens;
- prayer logs;
- community contacts;
- contact visibility settings;
- avatars/photos;
- push jobs and deliveries;
- seating assignments.

Historical Supabase data may remain only in migration archives or synthetic,
non-frontend fixtures. It is not a mobile or web-admin runtime dependency.

## Object Storage

Supabase Storage is replaced by Russia-hosted object storage before production
cutover unless the owner explicitly signs off on an exclusion.

Avatar/photo storage must not be treated as a separate privacy exception. If it
contains or can identify a person, it follows the same production residency
standard as profile and registration data.

Avatar objects and API-owned avatar metadata must be stored in Russia in
production. The PR 32G local MinIO service is for local smoke only and is not
the production storage provider. Production must use a Russia-hosted
S3-compatible endpoint and a private bucket.

Avatar upload/read URLs are short-lived bearer URLs. They contain authorization
query parameters and must not be logged, persisted, copied into support notes,
or stored in PostgreSQL. API responses expose durable `avatar_id` references;
they must not expose object keys, bucket names, ETags, storage credentials, or
internal storage endpoint configuration.

## Expo Push Caveat

Device tokens may be stored in Russia.

If Expo Push API is used for delivery, device tokens and message payloads are
transmitted to Expo as a delivery processor during sending. This is a
transit/processor decision, not merely a storage decision.

Production push enablement must review this caveat before rollout. A
Russia-hosted push alternative may be chosen later if required by the owner.

## Privacy Requests And Device Tokens (PR 32B / client integration PR 33)

The Python API records data-subject style privacy requests in the API-owned
`privacy_requests` table. `POST /privacy/requests` and `GET /privacy/requests`
are scoped to the authenticated user; admin review through
`/admin/privacy/requests` is admin-only and community-scoped. These endpoints
record and track requests. Irreversible deletion is not exposed as an API
endpoint; after explicit privacy-session confirmation, an operator executes one
request through the backend CLI. The current worker creates an encrypted
completion-notification outbox atomically with erasure and attempts delivery
only after commit. Request `message` text is personal data and must not be
logged raw.

Device tokens registered through `POST /me/device-tokens` are push-token PII
stored in the API-owned `device_tokens` table, upserted per
`(user_id, expo_push_token)`. API responses return token metadata only and
never echo the raw Expo push token. Deactivation is a soft `is_active = false`
update scoped to the owning user. The PR 32I worker uses these backend-owned
rows only for explicit event-registrant jobs; the Expo Push caveat above applies
to every outbound delivery attempt.

PR 38 makes privacy requests and device-token operations API-only in mobile
production. Privacy API calls are current-user only and do not log request
messages. Device API responses and client error messages omit raw Expo tokens;
the client does not persist them in debug storage. There is no frontend
fallback, direct-table access, or provider flag in production.

For Expo Go on iPhone, the mobile API base URL must use the development
computer's LAN address (`http://<computer-lan-ip>:8000`). Expo Push delivery,
if later enabled, remains an explicit external transit/processor decision and
is outside PR 33; no push is sent by this client integration.

## Logging And Sensitive Values

Production logging must avoid raw personal and secret values, including:

- email;
- phone;
- names;
- invite codes;
- registration comments;
- device push tokens;
- privacy request messages;
- signed avatar URLs;
- object-storage credentials;
- raw avatar image bytes;
- JWTs;
- refresh tokens;
- password reset codes.

Logs should prefer counts, ids that are safe for the context, hashes where
appropriate, and validation summaries.

## Public Web Registration Boundaries

The complete specification is
[`docs/web-event-registration.md`](web-event-registration.md). These rules are
documentation contracts. Registration intents, legal tables, SMTP templates,
and the privacy-erasure worker and restore replay are implemented; the public
web application remains separate work.

Mobile, the future separate Vite + React `apps/web`, and web-admin use the same
FastAPI API and canonical PostgreSQL data model. The public form must not be
placed inside `apps/admin`, and no frontend receives direct database access or
backend credentials.

For public registration, Russian residency requirements apply to primary
PostgreSQL, replicas, backups, S3-compatible object storage, SMTP
infrastructure, and logs. Every processor and infrastructure location requires
approval before launch. The MVP includes no foreign analytics, advertising
pixels, reCAPTCHA, or third-party trackers.

The MVP minimizes collection to first name, last name, phone, email, and a
separate affirmative personal-data consent. The privacy policy and separate
consent must be accessible before submission, consent must not be preselected,
and the acceptance must identify an immutable version of the legal document.
The MVP does not collect passport data, health information, religious status
or beliefs, nationality, conversion status, Jewish status, or other
special-category questionnaire data.

In addition to the existing logging restrictions, public registration and
privacy execution must never log raw questionnaire answers or verification
codes. Raw email, phone, names, questionnaire answers, registration comments,
JWTs, refresh tokens, verification codes, magic links, privacy-request text,
or full email bodies must not enter application, access, SMTP, analytics,
error, or infrastructure logs. Verification codes, passwords, refresh tokens,
and invite codes are never stored in plaintext; only appropriate hashes or
revocable server-side session state are stored.

Deletion must cover every applicable PII store, including PostgreSQL primary
and replicas, profile/contact/auth/session data, registration option and
capacity rows, questionnaire answers, device/contact/avatar data, S3 objects,
exports, logs, and backups under their approved schedules. The execution must
be idempotent, release capacity for cancelled future registrations, replay an
erasure register after restore, and create required destruction evidence
without retaining the erased PII. The current worker deletes every recorded
avatar object from the configured private S3-compatible Russian storage before
committing PostgreSQL identity deletion. Retention periods and any legally
required limited preservation remain launch decisions and must not be invented.

No claim is made that backups are currently purged. The owner-run
restore-erasure replay mechanism is implemented, but a real restore drill and
approved backup policy remain launch gates. Backup retention remains
unresolved and must be approved rather than inferred from application
behavior; this worker and replay command do not establish production
readiness.

The `prayer_activity_logs` data remains private. It must not be exposed through
web-admin, public registration, privacy administration views, exports for event
operations, or conflict-review tooling.

## Migration Script Carve-Out

Future owner-run scripts under `scripts/migration/**` may inspect Supabase Auth
metadata only when required for migration inventory/export and only under the
root-plan carve-out.

Those scripts may output counts, mappings, and validation reports only. No raw
auth dumps, plaintext tokens, OAuth provider payloads, or password data may be
committed.

Any service-role key needed by the owner for such scripts must stay in the
owner's local environment. It must never be committed or placed in mobile,
Expo env, Vite env, `apps/admin`, docs examples with real values, or frontend
code.

## API Push Delivery (PR 32I)

PR 32I makes the data-transit decision explicit: device tokens and notification
title, body, and data are stored in Russia with the API data, but are
transmitted to Expo infrastructure when a delivery is attempted. This requires
explicit project-owner production sign-off. The backend defaults
`API_PUSH_ENABLED=false`; when `APP_ENV=production`, it refuses outbound Expo
delivery unless `API_PUSH_PRODUCTION_SIGNOFF=true` as well. No agent check sends
a real push.

Only normalized job/delivery state and Expo ticket identifiers are retained for
delivery processing. Raw Expo tokens, notification payloads, ticket/receipt
response bodies, recipient names, email, phone, and registration comments must
not enter logs or admin job-list responses. `DeviceNotRegistered` safely
deactivates the associated device-token row without deleting it.

## Reversible Erasure Processing Stop

The API lifecycle stage verifies the canonical email through a fixed-scope
privacy session, then records a reversible processing stop without physically
deleting the app user, profile, registrations, avatar metadata/object, or other
personal stores. Active credentials are revoked and new ordinary account or
registration processing is blocked while the user is `deletion_pending`.

Automatic lifecycle confirmation is restricted to the free registration
contour. Any payment identifier, financial payment state, non-free registration
mode, priced option, or donation marker returns a generic manual-review
conflict. No claim is made that financial records can be removed until an
approved retention matrix exists.

Cancellation is allowed only before irreversible worker execution. It restores
the saved user status but does not restore credentials or registrations. The
one-request worker now performs user-scoped PostgreSQL deletion, private-S3
object removal, and PII-free destruction evidence. It deletes `app_users` last
and preserves operational audit rows through nullable actor FKs. Prayer
activity remains unread: execution uses only a direct user-scoped `DELETE`
without selecting or logging its content.

Before irreversible avatar or PostgreSQL deletion, the worker validates a
versioned private restore-erasure register and its token-hash-key fingerprint,
then durably writes an idempotent PII-free subject marker. Failure records the
stable `privacy_erasure_restore_register_unavailable` code where possible and
leaves the avatar, PostgreSQL personal graph, evidence, and canonical user
untouched. The register uses the configured backend-only S3-compatible storage
under `API_PRIVACY_ERASURE_REGISTER_PREFIX`; it is never exposed to mobile or
web-admin.

## Restore-Erasure Register And Replay

The restore-erasure register is independent of primary PostgreSQL backups. It
contains strict version metadata, a non-secret fingerprint proving compatibility
with `API_TOKEN_HASH_SECRET`, and one immutable/idempotent marker per keyed
subject reference. It contains no raw UUID, name, email, phone, request text,
prayer data, registration comment, credential, notification recipient, or
avatar object key. It is PII-free but remains sensitive backend operational
data and must remain private in approved Russia-hosted S3-compatible storage.

The owner-run `scripts/run_privacy_erasure_restore_replay.py` command defaults
to dry-run; mutation requires `--apply`. It preflights all metadata and markers
before database mutation, scans restored `app_users` identifiers only to
recompute the established subject hash, deletes matched private avatar objects
and the shared personal-data manifest, deletes `app_users` last, and writes
PII-free replay evidence when the schema supports it. It never creates a
privacy request or completion notification. Output is aggregate counts and
stable failure codes only. Prayer activity remains unread and is handled only
through the canonical direct user-scoped `DELETE` without `RETURNING`.

Register availability is a production erasure requirement. Its retention must
cover every PostgreSQL backup that remains restorable, but this repository does
not approve or invent a duration. Backup retention and purge remain
owner/legal/operations decisions. The command does not restore a backup, does
not purge backups, and does not prove the production backup policy or a real
restore drill complete.

## Encrypted Erasure Completion Notification

The notification outbox is part of the production personal-data contour and
must be hosted in Russia with primary PostgreSQL and its replicas. Ciphertext
is still personal data: it is retained only for completion delivery and is not
used for login, matching, marketing, analytics, admin display, evidence, or
export. The AES-256-GCM key is backend-only and must be held separately from
auth, token-hash, SMTP, password, and provider credentials.

Ciphertext and nonce are cleared after successful delivery or expiry of the
explicitly approved window. Backups may temporarily retain older ciphertext;
this change does not claim that production backup purge is solved. A restored
database must run the owner-controlled restore replay and remaining validation
before it is opened for service.

The SMTP provider and every relevant infrastructure location require explicit
approval. Russian plain-text templates and application-side encryption do not
by themselves establish production residency or production readiness.
