# Web Event Registration

Specification source: user-provided `webreg.md`, version 1.3, dated
2026-08-05. Repository architecture source: root `plan.md`, version
`2026-07-06 v2.7`.

This is a technical specification, not a legal opinion. Legal and operational
launch decisions listed below require approval by the operator and qualified
Russian counsel. This document describes target contracts unless a section is
explicitly marked as current.

## Status And Architecture

Current repository behavior:

- mobile and web-admin use the FastAPI application in `apps/api` and its
  canonical PostgreSQL data model;
- public event reads exist without mandatory authentication;
- `POST /events/{event_id}/register` exists only for an authenticated current
  user;
- password hash fields may be null, and email verification, password reset,
  set-password, SMTP delivery, and hash-only auth codes already exist;
- authenticated `POST /privacy/requests` and `GET /privacy/requests` record and
  list requests only; they do not execute export, correction, or erasure;
- the intent, email verification/finalization, identity/source/legal schema,
  and canonical public-web registration path are implemented;
- publication, public web UI, and privacy execution remain future contracts.

Mobile, public web, and web-admin must use one FastAPI API and one canonical
PostgreSQL model. They must not create a second backend, a separate web-user
database, or direct frontend access to PostgreSQL. Supabase is not restored as
the production data or authentication runtime.

The future public frontend must be a separate Vite + React application at
`apps/web`. It must not be implemented inside the closed administrative
application at `apps/admin`. `apps/web` does not exist yet and is outside this
documentation PR.

## Product And Identity Contract

The interface offers two equal paths; neither may be visually or verbally
coerced:

1. **Continue without a password.** After email verification, create or reuse
   one technical `app_users` record and create the event registration. A
   password is not required.
2. **Create or claim an account.** After the same email verification, set a
   password on that same `app_users` record. If an unclaimed record already
   exists, do not create a replacement; preserve its user id and registrations.

A technical `app_users` record is not the same as a password-based account.
The UI must say “continue without a password,” not “without creating an
account.” An existing claimed user may also complete email verification and
register without entering a password; the anonymous form must not silently
replace claimed profile or login details.

Target user states are `unclaimed`, `claimed`, `legacy_external`,
`deletion_pending`, and `erased`. Account blocking status must not be overloaded
with origin/claim semantics.

## Public Event URL And Publication

The stable public URL contract is:

```text
/events/{event_id}
/events/{event_id}?occurrence={occurrence_id}
```

The occurrence query only preselects a date; the backend must verify that the
occurrence belongs to the event. The URL contains no PII or secret and is not
an authorization mechanism.

The backend derives the absolute URL from trusted public-web base URL
configuration and the stable event UUID. It returns the URL to web-admin as a
read-only value. Administrators never enter, edit, or persist a full public
URL. Renaming an event must not invalidate its UUID URL. Disabling and later
re-enabling web publication must restore the same URL.

Target `web_visibility` values are:

- `disabled`: page and form unavailable even when the UUID is known;
- `unlisted`: accessible only by direct link and excluded from the future
  public directory and its search output;
- `listed`: also eligible for the future public events directory when the
  event satisfies the normal publication rules.

Existing and new events default to `disabled`. `listed` is not enabled in the
MVP: administrative writes must reject it, or the UI must withhold it, until
the public directory exists. The MVP operator may explicitly switch an event
to `unlisted`; no event becomes web-visible merely because it exists or is
renamed. The future directory is a separate, paginated event-card surface and
must never list `unlisted` events.

## Public Page And Data Minimization

The MVP form collects only:

- first name;
- last name;
- phone;
- email;
- a separate, affirmative personal-data consent.

The policy and separate consent text must be available before submission; the
checkbox must not be preselected. Account creation and marketing consent must
not be bundled with personal-data consent.

The MVP does not collect passport data, health information, religious status
or beliefs, nationality, conversion status, Jewish status, or other
special-category questionnaire data. It also excludes payments, Apple
Sign-In, Google OIDC, SMS verification, public participant lists, marketing
email, and registration by a minor in their own name. Later ordinary event
questions require an explicit purpose and retention period; high-risk or
special-category questions require separate legal review and controls.

## Registration Intent And Capacity Flow

The target public flow is:

1. Validate the web-visible event, occurrence, options, minimum fields, and
   versioned legal acceptance.
2. Normalize identity fields and apply enumeration-safe conflict checks.
3. Create a short-lived `web_registration_intent` and hash the opaque flow
   token/idempotency material.
4. Do **not** create `event_registrations` yet and, in the baseline MVP, do not
   reserve capacity.
5. Deliver an email code/link. Store only a hash of the code; plaintext exists
   only for outbound delivery.
6. On confirmation, atomically consume the code, resolve the single safe
   identity, re-check event state and capacity transactionally using the
   canonical registration service, and only then create
   `event_registrations`.
7. Return `confirmed`, `pending`, or `waitlisted` according to the event rules;
   offer the existing set-password path when account creation was selected.
8. Purge expired intents and their temporary PII on the approved short
   retention schedule.

`email_verification_required` is an intent state, never a final registration
state and never an occupied place. The result may change between submit and
confirmation because capacity is checked again. Retries must be idempotent and
must not create duplicate flows, users, registrations, or capacity usage.

For the current implementation, only `internal_free` events are
processable. Paid and donation selections are rejected. Registration preflight
uses the canonical occurrence, window, option, quantity, and seat-count rules;
capacity is not reserved and is rechecked transactionally at confirmation. Exactly one
active `event_registration_consent` with its exact content hash is mandatory;
an active `privacy_policy` may accompany it, while marketing consent is outside
this MVP. Questionnaire `answers` must remain empty and are stored as null.

## Identity Normalization And Conflict Rules

- Email is trimmed, Unicode-valid, domain-normalized, and compared
  case-insensitively using the canonical normalized value.
- Phone is normalized and stored/compared as E.164 (`+7XXXXXXXXXX` for a
  Russian number).
- Names are trimmed, repeated spaces collapsed, length-limited, and stripped
  of control characters.
- API responses before ownership proof are generic and do not reveal whether
  an email, phone, user, registration, or conflict exists.

After email verification, reuse an existing user only when the identity
resolution is safe. For an unclaimed email match with a free phone, the
verified owner may update the phone. A claimed profile is not changed without
an authenticated operation. A phone-only match must not create a duplicate or
disclose the match. If email and phone resolve to different rows, never merge
automatically: create a safe administrative review case containing the
minimum necessary data. A `deletion_pending` identity must not begin new
processing until erasure completes or is cancelled.

Before enforcing normalized-phone uniqueness, migration work must report
collisions without raw PII in output or logs.

## Target Data Contracts

The identity/source/legal, intent, and verification-code contracts below are
implemented. Publication, questionnaires, and privacy execution remain target
contracts for later PRs.

### `app_users`

```text
account_origin         password_signup | invite | web_guest | migration | admin
claim_state            unclaimed | claimed | legacy_external
claimed_at             timestamptz null
deletion_requested_at  timestamptz null
erased_at               timestamptz null
```

Migration classification must not infer all historical OAuth/import state from
`password_hash` alone.

### `event_registrations`

```text
source_channel  mobile | public_web | admin
```

The existing final statuses remain canonical. Email-verification status stays
in the intent.

### `web_registration_intents`

```text
id
flow_token_hash
event_id
occurrence_id null
first_name
last_name
email_normalized
phone_normalized
seats_count
option_payload
answer_payload null
legal_acceptance_payload
account_choice
status                 email_verification_required | confirmed | expired | failed
idempotency_key_hash
expires_at
confirmed_at null
created_at
```

Intent access uses only an opaque flow token. Flow tokens, intent PII, and
idempotency values must not appear in logs. Successful completion moves only
required data into canonical records, then clears or deletes the intent under
short retention.

Implementation status: the intent table, public create/status endpoints,
normalization, hash-only flow/idempotency lookup, database-backed idempotency,
minimal identity-conflict persistence, initial SMTP delivery, resend, and
transactional confirmation are implemented. The provisional
24-hour TTL is backend-configurable through
`API_WEB_REGISTRATION_INTENT_TTL_HOURS`; final retention approval is still a
launch gate. No capacity is reserved before confirmation and no web UI is
implemented in this step.
Phone-only and differing-user identity conflicts return one generic
support/recovery error. Differing users retain only the minimal technical
conflict record; deletion-pending matches create neither an intent nor a
conflict and begin no new submitted-PII processing.

### `web_registration_verification_codes`

```text
id
registration_intent_id
code_hash
expires_at
consumed_at
attempt_count
created_at
```

Codes are expiring, attempt-limited, single-use, and hash-only at rest.
Each hash includes the registration intent ID and is unique only together with
that ID, so equal six-digit plaintext codes in different intents do not
collide. Lookup is intent-scoped. Generation checks all prior codes for the
locked intent, including consumed and expired rows, and retries a bounded
number of times so a resend never repeats a code used earlier by that intent.
The backend defaults are a 15-minute TTL, five failed attempts, and a 60-second
resend cooldown. A new resend invalidates older active codes only after SMTP
delivery succeeds. SMTP disabled/failure is a safe 503 and never commits the
new code. Plaintext codes exist only in memory for delivery and are never
stored or logged.

### `legal_documents` And `legal_acceptances`

```text
legal_documents:
  id
  document_type       privacy_policy | event_registration_consent | marketing_consent
  version
  title
  content_hash
  published_url
  effective_at
  retired_at

legal_acceptances:
  id
  user_id
  registration_id null
  legal_document_id
  accepted_at
  acceptance_method checkbox_plus_email_verification | authenticated_action
  source_channel
  evidence_version
  retention_until null
```

Published legal versions are immutable evidence. A pointer to only the current
policy is insufficient.

### Privacy Access And Erasure Execution

Hash-only access codes and a narrowly scoped, short-lived privacy session must
support access to the verified person's own data only. Target execution state
in `privacy_requests` or a separate erasure job includes:

```text
identity_verified_at
processing_stopped_at
execution_started_at
completed_at
due_at
failure_code null
destruction_evidence_id null
```

## Public API Contracts

All endpoints except the registration-form read are implemented. They use the
repository's standard JSON envelope and generic, enumeration-safe errors.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/events/{event_id}/registration-form?channel=web` | Return the form only for an otherwise publishable `unlisted`/`listed` event; `disabled` remains inaccessible by UUID. |
| POST | `/web/registration-intents` | Create/reuse a short-lived, non-capacity-holding flow after validation. |
| POST | `/web/registration-intents/{flow_id}/resend-code` | Rate-limited generic resend; do not reveal identity state. |
| POST | `/web/registration-intents/{flow_id}/confirm-email` | Consume the code, resolve identity, re-check capacity transactionally, and create the final registration. |
| GET | `/web/registration-intents/{flow_id}/status` | Return only the state authorized by the opaque flow credential. |

Intent creation accepts the event/occurrence, the four MVP identity fields,
free seat and option selections, an empty `answers` list, and versioned legal acceptances including exactly one event-registration consent,
`account_choice` (`without_password` or `create_account`), and an opaque
idempotency value. A processable response returns an opaque `flow_id`,
`next_step = confirm_email`, and `expires_at`; sensitive identity conflicts
instead return the same generic support/recovery error and never state whether
contact values already existed. Confirmation returns the final registration state and,
when selected, a one-time transition into the existing set-password flow.
An equivalent create retry after confirmation returns the same `flow_id` with
`next_step = completed` and has no email, code, registration, legal-acceptance,
or plaintext-credential side effects.

`POST .../resend-code` returns only `next_step=confirm_email` and the new
expiry. `POST .../confirm-email` accepts a strict six-digit code. Successful
confirmation re-resolves identity, revalidates legal versions, and calls the
canonical registration service with `source_channel=public_web`. Capacity
failure leaves the intent unconfirmed and the valid code unconsumed.

New people become `web_guest`/`unclaimed` with a minimal profile, verified
email, unverified phone, no password, and no membership. Unclaimed email owners
may receive a still-free submitted phone; claimed/legacy profiles and login
contacts are not overwritten. Phone-only, different-user, and deletion-blocked
states share a neutral recovery outcome and never auto-merge.

Legal evidence is created only after confirmation with
`checkbox_plus_email_verification`, `public_web`, and
`web-registration-email-code-v1`. `without_password` returns no set-password
credential. `create_account` returns a first-response-only hash-backed handoff
for the existing `/auth/confirm-set-password`; replay returns
`request_set_password`, and a user with a password receives `sign_in`.
Registration-result email runs after commit and its failure cannot undo the
registration. Status is PII-free and contains only public state, minimal final
registration data, and an account next step without secrets.

## Target Administrative Publication Contracts

These endpoints are **not currently implemented**:

```text
GET   /admin/events/{event_id}/web-registration
PATCH /admin/events/{event_id}/web-registration
```

The read response contains `event_id`, `web_visibility`, computed
`public_registration_url`, and computed occurrence URLs. `PATCH` accepts only
managed settings such as `web_visibility`; it never accepts a caller-provided
URL. In the MVP it accepts only `disabled` and `unlisted`. Existing admin
authorization guards scope access to the event's community, and publication
changes produce a PII-free audit record.

## Target Privacy Self-Service Contracts

Only authenticated request recording/listing currently exists. The following
self-service/access/execution behaviors are **target contracts and are not
currently implemented** (including the expanded behavior of the existing
`POST /privacy/requests` path):

```text
POST /privacy/access/request
POST /privacy/access/confirm
GET  /privacy/data-summary
POST /privacy/data-export
POST /privacy/requests
POST /privacy/requests/{request_id}/confirm-erasure
POST /privacy/requests/{request_id}/cancel-erasure
```

Access request always returns generic success. Confirmation creates a short,
scoped privacy session that cannot act as an ordinary account session, change
passwords, or access another person. Erasure confirmation is a distinct
destructive action; cancellation is allowed only while execution rules permit.

## Privacy, Retention, And Destruction

Absence of a password must not prevent access, export, correction, consent
withdrawal, or erasure. Once erasure is confirmed, processing is stopped,
sessions are revoked, future registrations are cancelled and their capacity is
released, then an idempotent worker deletes or irreversibly anonymizes every
applicable PII store according to the approved retention matrix.

Applicable stores include profiles and contacts, credentials and auth codes,
sessions, device tokens, synced contacts and visibility, avatar object and
metadata, questionnaire answers, memberships when no independent basis
applies, event registration option/capacity records, privacy-request messages,
primary PostgreSQL data, replicas, exports, object storage, logs, and backups.
`app_users` is removed last after FK checks. Destruction evidence records the
outcome without retaining the erased PII.

Backups require bounded retention and an erasure-replay register keyed by safe
technical identifiers before a restore is opened for service. Final retention
periods are launch decisions; preliminary examples in the source specification
are not approvals and must not be presented as final values.

## Security And Web Session Boundaries

- TLS, HSTS, CSP, `frame-ancestors`, strict referrer policy, CORS allowlisting,
  backend validation, rate limits, honeypot/server-side abuse rules, CSRF
  protection, and capacity-race protection are required.
- No foreign analytics, advertising pixels, reCAPTCHA, or third-party trackers
  are included in the MVP.
- Verification/magic-link secrets are exchanged for a session and removed from
  the URL immediately.
- Public/cookie-auth web sessions use Secure, HttpOnly, SameSite cookies, a
  `__Host-` prefix where applicable, short access lifetime, refresh rotation,
  and CSRF tokens. Refresh tokens are never stored in `localStorage`. Mobile
  continues to use bearer authorization.
- Admin access remains community-scoped. Unconfirmed intents are not final
  registrations and do not appear as occupied capacity. Identity conflicts
  require a minimal-data review queue.
- `prayer_activity_logs` remain private and must not be exposed in admin.

## Implementation Sequence

1. `docs/web-registration-contracts` — this documentation-only contract PR.
2. `feature/api-web-registration-identity-schema` — claim/source/legal schema (implemented).
3. `feature/api-web-registration-intents` — intent, normalization, dedupe,
   conflict policy, and idempotency without email delivery (implemented).
4. `feature/api-web-registration-email-finalize` — hash-only codes, SMTP
   templates, verification, and transactional capacity finalization (implemented).
5. `feature/api-web-event-publication` — `web_visibility`, admin publication,
   and computed UUID links.
6. `feature/public-web-event-registration-shell` — create the separate
   `apps/web` Vite + React shell and form through intent submission.
7. `feature/admin-event-web-registration-link` — read-only links and publication
   controls in web-admin.
8. `feature/public-web-registration-account-claim` — intent confirmation,
   passwordless path, and account claim.
9. `feature/api-privacy-self-service-erasure` — scoped access, export, erasure,
   destruction evidence, and tests; split schema/worker if needed.
10. `feature/admin-web-registration-operations` — source/status, conflict, and
    privacy due-date operations.
11. `feature/web-event-questionnaires-basic` — allowlisted ordinary questions
    with purpose/retention only.
12. `ops/public-web-production-deploy` — Russian hosting, TLS/CSP/CORS, SMTP,
    restore-erasure drill, and owner launch checklist.
13. After MVP: `feature/public-web-events-directory` — paginated `listed` event
    cards; never expose `unlisted` events.

## Open Launch Decisions

No value is invented for these unresolved decisions:

- exact legal entity acting as operator;
- public personal-data contact;
- production public-web domain;
- Russian SMTP provider and confirmation of its infrastructure location;
- retention periods for intents, codes, registrations, profiles, logs, backups,
  and destruction evidence;
- whether the MVP is restricted to users aged 18 and older;
- legal basis for processing participation in religious-organization events;
- final privacy-policy and separate consent text;
- whether capacity should ever be temporarily reserved before email
  confirmation (baseline MVP: no reservation).
