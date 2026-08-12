# Web Event Registration

Specification source: `webreg.md`, version 1.3, dated 2026-08-05. The current
FastAPI/PostgreSQL implementation is verified against the repository code.

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
- authenticated and verified privacy self-service request flows are implemented;
- the complete split privacy self-service and erasure series is implemented:
  canonical-email verification issues hash-only codes and a short-lived,
  fixed-scope privacy session for own-data summary, limited JSON export, and
  request creation; reversible erasure lifecycle, irreversible worker,
  encrypted completion notification, external restore-erasure register, and
  owner-run restore replay are implemented;
- the intent, email verification/finalization, identity/source/legal schema,
  and canonical public-web registration path are implemented;
- event publication, computed UUID links, and the public registration-form API
  are implemented;
- ordinary web-event questionnaires now work end-to-end in the public web UI,
  including strict validation, version binding, final persistence, retention,
  and privacy coverage. This completes webreg PR 11;
- public web registration supports `internal_free` and `internal_paid`
  contracts simultaneously after an ordinary API start.

Mobile, public web, and web-admin must use one FastAPI API and one canonical
PostgreSQL model. They must not create a second backend, a separate web-user
database, or direct frontend access to PostgreSQL. Supabase is not restored as
the production data or authentication runtime.

The public frontend is the separate Vite + React application at `apps/web`.
It remains separate from the closed administrative application at `apps/admin`.

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

The backend derives the absolute URL from the backend-only
`PUBLIC_WEB_BASE_URL` configuration and the stable event UUID. The setting is
normalized without a trailing slash and rejects credentials, query strings,
fragments, and non-loopback HTTP. Host, Origin, Referer, and forwarded headers
never influence the canonical link. The API returns the URL to web-admin as a
read-only value. Administrators never enter, edit, or persist a full public
URL. Renaming an event must not invalidate its UUID URL. Disabling and later
re-enabling web publication must restore the same URL.

Implemented `web_visibility` values are:

- `disabled`: page and form unavailable even when the UUID is known;
- `unlisted`: accessible only by direct link and excluded from the future
  public directory and its search output;
- `listed`: also eligible for the future public events directory when the
  event satisfies the normal publication rules.

Existing and new events default to `disabled`. The value is a constrained,
non-null event column, but neither the full URL nor a slug is stored in the
database. `listed` is not enabled by the MVP admin PATCH, although direct form
reads support fixtures/future data using it. The MVP operator may explicitly switch an event
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
special-category questionnaire data. It also excludes real payment collection
or payment-provider integration, Apple Sign-In, Google OIDC, SMS verification,
public participant lists, marketing email, and registration by a minor in
their own name. Later ordinary event
questions are now defined by a versioned questionnaire contract and configured
through the admin-only event editor. They require an explicit purpose and
retention period. High-risk or special-category questions remain technically
unavailable and outside scope. Public rendering and strict submission are
implemented for the five ordinary field types only.

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
   `event_registrations` and any canonical questionnaire answer rows.
7. Return `confirmed`, `pending`, or `waitlisted` according to the event rules;
   an `internal_paid` confirmation returns registration `pending` with
   `payment_status=pending`, and the existing set-password path remains
   available when account creation was selected.
8. Purge expired intents and their temporary PII on the approved short
   retention schedule.

`email_verification_required` is an intent state, never a final registration
state and never an occupied place. The result may change between submit and
confirmation because capacity is checked again. Retries must be idempotent and
must not create duplicate flows, users, registrations, or capacity usage.

For the current implementation, `internal_free` events remain processable with
free, non-donation options only. `internal_paid` events are processable at the
same time and support canonical active free, paid, and donation options. Email
verification is mandatory for both modes.

For `internal_paid`, the canonical backend owns option validity,
quantity, `is_donation`, `counts_toward_capacity`, seat calculation, current
price and currency, mixed-currency rejection, final capacity, and option
snapshots. Client `seats_count` is revalidated. Donation and non-capacity
options do not consume seats, intents do not reserve capacity, and confirmation
rechecks capacity transactionally. The browser calculates display totals only
and must not claim that payment completed. No real payment provider is part of
this implementation.

Exactly one active `event_registration_consent` with its exact content hash is
mandatory;
an active `privacy_policy` may accompany it, while marketing consent is outside
this MVP. When a published questionnaire exists, the request must submit its
exact `questionnaire_form_id` and strict field-ID answers. Normalized answers
remain temporary on the intent until email confirmation.

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

The identity/source/legal, intent, verification-code, publication, and complete
privacy self-service/access/erasure contracts below are implemented.
Versioned ordinary questionnaire definitions, admin/public read contracts,
admin configuration, public rendering, answer submission, final persistence,
retention metadata, and privacy handling are implemented. Event managers
neither render the admin questionnaire card nor call its endpoints. Draft save
is explicit, publishing is explicit and confirmed, and published definitions
remain immutable. See
[`docs/web-event-questionnaires.md`](web-event-questionnaires.md).

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
in the intent. Mobile, public-web, and admin-created registrations remain rows
in this same canonical `event_registrations` table. The source value is
visibility/filtering metadata and does not change capacity accounting or status
transitions.

### `web_registration_intents`

```text
id
flow_token_hash
event_id
occurrence_id null
questionnaire_form_id null
first_name
last_name
email_normalized
phone_normalized
seats_count
option_payload
answer_payload null | normalized temporary [{field_id, value}]
legal_acceptance_payload
account_choice
status                 email_verification_required | confirmed | expired | failed
idempotency_key_hash
expires_at
confirmed_at null
created_at
```

Intent access uses only an opaque flow token. Flow tokens, intent PII, and
idempotency values and questionnaire answers must not appear in logs. The
request fingerprint includes the questionnaire form and answers. Successful
completion creates canonical answers in the registration transaction, clears
`answer_payload`, and retains only the technical immutable form binding.

Implementation status: the intent table, public create/status endpoints,
normalization, hash-only flow/idempotency lookup, database-backed idempotency,
minimal identity-conflict persistence, initial SMTP delivery, resend, and
transactional confirmation are implemented. The provisional
24-hour TTL is backend-configurable through
`API_WEB_REGISTRATION_INTENT_TTL_HOURS`; final retention approval is still a
launch gate. No capacity is reserved before confirmation. Questionnaire answers
are never stored in browser storage, URLs, cookies, analytics, or logs.
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

The database foundation and runtime store privacy access codes as globally unique
`code_hash` values and stores privacy session credentials as globally unique
`token_hash` values. It stores no plaintext code, session token, email, or
phone in either credential table. Privacy sessions have the single fixed scope
`privacy_self_service`; they are not auth sessions and confer no login,
password, profile-editing, ordinary account, or admin rights. Runtime issuance,
confirmation, and authorization are implemented only for the privacy endpoints
described below.

Implemented execution lifecycle fields in `privacy_requests` are:

```text
identity_verified_at
processing_stopped_at
execution_started_at
completed_at
due_at
failure_code null
destruction_evidence_id null
```

`privacy_requests.user_id` is nullable with `ON DELETE SET NULL`, so a completed
minimal request record may remain after final user deletion. The implemented
`privacy_destruction_evidence` table has no user foreign key or raw contact,
profile, address, or request-message fields. It permits only technical category
codes and `completed` or `completed_with_retention` result status. The worker
creates this evidence atomically with an encrypted completion-notification
outbox; no retention duration is implied by the schema.

## Public API Contracts

All endpoints in this table are implemented. They use the repository's
standard JSON envelope and generic, enumeration-safe errors.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/events/{event_id}/registration-form?channel=web` | Return the form only for an otherwise publishable `unlisted`/`listed` event; `disabled` remains inaccessible by UUID. |
| GET | `/web/events/{public_slug}/registration-form` | Resolve a strict lowercase canonical or alias slug and return the same minimized form; unknown, invalid, and unavailable targets share `404 registration_unavailable`. |
| POST | `/web/registration-intents` | Create/reuse a short-lived, non-capacity-holding flow after validation. |
| POST | `/web/registration-intents/{flow_id}/resend-code` | Rate-limited generic resend; do not reveal identity state. |
| POST | `/web/registration-intents/{flow_id}/confirm-email` | Consume the code, resolve identity, re-check capacity transactionally, and create the final registration. |
| GET | `/web/registration-intents/{flow_id}/status` | Return only the state authorized by the opaque flow credential. |

Form reads and new intents require the event to be simultaneously `published`,
`public`, and `unlisted` or `listed`, with registration mode `internal_free` or
`internal_paid`. Both modes are supported simultaneously after an ordinary API
start. Unsupported states share one generic `registration_unavailable`
response.

Both reads return `canonical_public_path` from the current stored canonical slug
and a strict boolean `resolved_from_alias`. `apps/web` uses that relative path
with `history.replaceState` for aliases and legacy UUID links, without a reload
or second form request. UUIDs remain the identifiers in form and registration
payloads.

Intent creation accepts the event/occurrence, the four MVP identity fields,
seat and option selections, questionnaire answers when applicable, and
versioned legal acceptances including exactly one event-registration consent,
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
confirmation rechecks current publication under an event row lock, then
re-resolves identity, revalidates legal versions, and calls the canonical
registration service with `source_channel=public_web`. Capacity failure or a
move to `disabled` leaves the intent unconfirmed and the valid code unconsumed,
with no user/profile/registration/legal/set-password mutation. Re-enabling
allows retry while the intent and code are valid; existing confirmed
registrations are not removed.

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

## Administrative Publication Contracts

These endpoints are implemented with existing authenticated, community-scoped
admin authorization:

```text
GET   /admin/events/{event_id}/web-registration
PATCH /admin/events/{event_id}/web-registration
```

The read response contains `event_id`, `web_visibility`, `public_slug`, computed
canonical-slug `public_registration_url`, and deprecated occurrence URLs using
the same slug plus an occurrence UUID query. `PATCH` accepts managed settings
such as `web_visibility` and `public_slug`; it never accepts a caller-provided
URL. Existing admin
authorization guards scope access to the event's community, and publication
changes produce a PII-free audit record. PATCH locks the event and commits the
event change plus `admin_event_audit_entries` row atomically. The row contains
only technical IDs/action/old/new/timestamp; repeated same-state PATCH creates
no row. Enabling `unlisted` through this conservative admin PATCH requires
`registration_mode=internal_free` or `registration_mode=internal_paid`;
`none` and `external_link` remain unsupported.

The public registration-form read is available only for events that are
simultaneously `published`, `public`, and `unlisted` or `listed`, with
registration mode `internal_free` or `internal_paid`. For `internal_free` it
returns active free non-donation options; for `internal_paid` it returns
canonical active free, paid, and donation options.
It also returns one current event-registration consent, an optional privacy
policy, the published
`questionnaire_form_id` plus exactly its ordered ordinary questions, and a canonical
`open`, `not_yet_open`, `closed`, `full`, or `unavailable` state. Closed and
full pages remain readable and the endpoint never reserves capacity. No event
catalog is included. Questionnaire administration remains the unchanged
admin-only UI from PR #355.

## Privacy Self-Service Contracts

These access behaviors are implemented:

```text
POST /privacy/access/request
POST /privacy/access/confirm
GET  /privacy/data-summary
POST /privacy/data-export
POST /privacy/requests
```

`POST /privacy/access/request` normalizes the submitted email and looks up only
`lower(app_users.email)`. It always returns HTTP 202 with the same
`accepted=true` envelope for known, unknown, erased, rate-limited, SMTP-disabled,
and SMTP-failure cases. Eligible users receive a six-digit code. The database
stores only a server-secret HMAC produced from the user-id-separated code input;
failed delivery rolls back the new code and leaves no usable credential.
Every valid request schedules the same managed post-response handler, which
opens its own database session and performs the hashed per-email rate limit,
canonical lookup, code transaction, and SMTP delivery only after the 202
response has been sent. No raw `asyncio.create_task` is used.

`POST /privacy/access/confirm` uses one enumeration-safe
`invalid_or_expired_privacy_code` error for an unknown or erased subject and for
wrong, expired, consumed, or attempt-exhausted codes. Successful confirmation
atomically consumes the code, revokes earlier privacy sessions, and returns one
opaque plaintext token. Only its domain-separated hash is stored. The privacy
session has a 15-minute local default, fixed `privacy_self_service` scope, no
refresh credential, and is neither a JWT nor an ordinary auth session.

`GET /privacy/data-summary` returns only own-data counts/presence for account,
profile, memberships, registrations and option snapshots, legal acceptances,
privacy requests, device metadata, synced-contact summary, and avatar metadata.
`POST /privacy/data-export` supports only synchronous `{"format":"json"}` and
returns `privacy-self-service-v1` with explicit field allowlists. It creates no
file, object-storage artifact, background job, attachment, or download link.
Push tokens, synced-contact hashes/data, avatar binary/object keys/signed URLs,
password/session hashes, other users' records, and feedback content are absent.
Prayer activity is represented only by an excluded-category marker; the
summary and export do not query or count `prayer_activity_logs`.
Access request/confirmation, summary, and export responses include
`Cache-Control: no-store`.

The existing `POST /privacy/requests` accepts either ordinary API auth or a
verified privacy session. Privacy-session creation forces the verified user id,
sets `identity_verified_at`, and applies the existing active-membership
community resolution. It only records the request. `GET /privacy/requests`
remains ordinary-auth-only.

The destructive lifecycle endpoints are implemented:

```text
POST /privacy/requests/{request_id}/confirm-erasure
POST /privacy/requests/{request_id}/cancel-erasure
```

Creating a deletion request alone does not change user status or run erasure.
Explicit privacy-session confirmation performs the reversible processing stop;
the separate operational worker CLI performs irreversible execution for one
request id. Cancellation remains available only before worker claim.

Real SMTP smoke is deferred to the production SMTP/deploy stage; automated
coverage uses fakes/mocks around the existing SMTP boundary. The current
email limiter is process-local with 900-second/five-attempt local defaults.
A distributed production limiter is a launch gate; no provider is selected here.

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
  use an admin-only minimal-data review queue. The queue exposes only technical
  identifiers and lifecycle state; it never returns submitted contact/form
  payloads and never merges identities automatically.
- `prayer_activity_logs` remain private and must not be exposed in admin.

The backend operations foundation exposes canonical registration
`source_channel` (`mobile`, `public_web`, or `admin`) and an optional source
filter through the existing admin registration list. Web-admin displays this
canonical value as a source badge and sends source filtering to FastAPI instead
of filtering one loaded page in the browser. It also exposes
`GET /admin/web-registration/operations-summary`,
`GET /admin/web-registration/conflicts`, and
`PATCH /admin/web-registration/conflicts/{conflict_id}` for active admins only.
Summary data is aggregate-only. Active verification intents must be unexpired
and do not reserve registration capacity. Conflict resolution records only
`open`/`resolved` state and backend resolution time; it cannot edit users,
profiles, login email/phone, intents, or registrations.

The admin-only privacy due-date UI consumes only request id, request type,
status, creation time, and the FastAPI-provided `due_at` from
`GET /admin/privacy/requests`. Its default view omits `overdue_only`; the single
`Просроченные` filter reloads through FastAPI with `overdue_only=true`.
Overdue means a non-terminal (`resolved`, `rejected`, and `closed` are terminal)
request with a non-null past `due_at`. The browser does not derive a deadline
from `created_at`.

The Registrations page now renders an admin-only web-registration operations
surface. Its summary shows active unexpired email-verification intents, open
identity conflicts, open privacy requests, and overdue privacy requests.
Confirmed and expired intents are excluded from the active count. The two
privacy counts remain unchanged, and the compact privacy due-date list below
the conflict queue provides their read-only detail.

The conflict queue exposes only allowlisted technical metadata and masks user,
event, occurrence, and conflict identifiers in the primary UI. It never shows
submitted names, email addresses, phone numbers, answers/comments, credentials,
codes, or hashes. Resolve/reopen changes only the conflict operational status;
it does not merge users or edit profiles, login identities, intents, or
registrations. Automatic identity merge remains prohibited. `event_manager`
users do not render or call this admin-only surface.

The privacy due-date list shows only Russian request-type/status labels,
creation time, the authoritative due time or `Срок не установлен`, a shortened
technical request id, and an explicit overdue badge where applicable. It does
not display request contents, resolution notes, user identity or contact data,
or privacy lifecycle execution fields. It has no status-changing, erasure,
restore-replay, or other privacy execution action. `event_manager` users do not
call the privacy endpoint. No profile, event-participation, or prayer data is
joined or requested; the prayer tracker remains private.

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
9. Privacy self-service and erasure are split into six implemented PRs:
   - `feature/api-privacy-self-service-foundation` — PostgreSQL/Alembic
     credentials, scoped-session, lifecycle, nullable ownership, destruction
     evidence, and schema/regression tests (implemented);
   - `feature/api-privacy-self-service-access` — access request/confirmation,
     privacy session runtime, summary, limited JSON export, and verified request
     creation (implemented);
   - `feature/api-privacy-erasure-lifecycle` — destructive confirmation,
     reversible `deletion_pending` processing stop, credential revocation,
     pending-intent invalidation, future free-registration cancellation, and
     safe cancellation before execution (implemented);
   - `feature/api-privacy-erasure-worker` — irreversible PostgreSQL/S3
     deletion and evidence completion (implemented);
   - `feature/api-privacy-erasure-completion-notification` — encrypted
     transactional completion outbox, Russian templates, post-commit delivery,
     and one-request CLI retry (implemented);
   - `feature/api-privacy-erasure-restore-replay` — private external PII-free
     register, shared deletion manifest, and owner-run restore replay
     (implemented; closes the split PR 9 implementation series).
10. Web-registration admin operations — source/status, conflict queue, and
    privacy due dates, split across these implemented branches:
    - `feature/api-admin-web-registration-operations-foundation` — backend
      contracts and aggregate summary;
    - `feature/admin-registration-source-status` — canonical source badges and
      FastAPI-backed source filtering;
    - `feature/admin-web-registration-operations-ui` — admin-only summary and
      safe identity-conflict queue;
    - `feature/admin-privacy-due-dates` — read-only privacy due-date detail
      (implemented; completes webreg PR 10).
11. Web event questionnaires — allowlisted ordinary questions with explicit
    purpose/retention, split into focused PRs:
    - `feature/web-event-questionnaires-basic` — versioned backend definition,
      admin contracts, and published public read foundation (implemented);
    - `feature/admin-web-event-questionnaires-basic-ui` — admin questionnaire
      configuration UI (implemented);
    - `feature/web-event-questionnaires-public-ui` — public rendering, strict
      submission, email-confirmed canonical answers, retention metadata, and
      privacy access/erasure coverage (implemented; completes webreg PR 11).
12. `ops/public-web-production-deploy` — Russian hosting, TLS/CSP/CORS, SMTP,
    restore-erasure drill, and owner launch checklist.
13. After MVP: `feature/public-web-events-directory` — paginated `listed` event
    cards; never expose `unlisted` events.

The next implementation PR is `ops/public-web-production-deploy`. Periodic
execution of answer retention purge by indexed `purge_at` is a production
launch dependency if scheduling is not already wired.

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

## Reversible Privacy Erasure Lifecycle

`POST /privacy/requests/{request_id}/confirm-erasure` accepts only a valid
`privacy_self_service` session and the exact confirmation literal
`delete_my_data`. Before changing state, the API fails closed when any
registration has a non-`internal_free` mode, payment identifier, financial
payment status, priced option snapshot, or donation marker. Such requests need
manual review until an approved retention matrix exists.

A successful confirmation atomically moves the canonical user to
`deletion_pending`, revokes auth/privacy sessions and one-time codes, removes
only unfinished web-registration intents matched by canonical normalized
`app_users.email`, and cancels future free registrations in canonical
cancellable statuses. Past, attended, no-show, paid, and donation records are
unchanged. Cancelled registrations stop counting toward capacity through the
existing registration-status rules; capacity reservation rows are not deleted.

`POST /privacy/requests/{request_id}/cancel-erasure` is available through a new
privacy session only until worker execution begins. It restores the saved user
status but never restores old credentials or cancelled registrations. The user
must authenticate again and re-register, subject to current capacity. Existing
and new public web-registration flows return generic identity/flow outcomes for
`deletion_pending` users without exposing account status.

## Privacy Erasure Worker

Irreversible erasure is an explicit one-request operational action, not an HTTP
endpoint or automatic queue consumer:

```text
python scripts/run_privacy_erasure.py --request-id <UUID>
```

The worker first claims and commits the confirmed request under PostgreSQL row
locks by setting `execution_started_at`. A separate execution transaction
locks the request and canonical user again, repeats lifecycle and financial
fail-closed checks, and holds the request lock through private-S3 deletion and
PostgreSQL completion. Concurrent runs therefore serialize; retries preserve
the original claim timestamp, and a run after completion returns
`already_completed` without another S3 call or evidence row.

All recorded avatar objects are deleted from private S3 before PostgreSQL PII.
An S3 failure rolls the execution transaction back and leaves database PII for
retry. PostgreSQL deletion removes the verified subject's credentials,
sessions, profile/contact surfaces, memberships, free registrations and their
dependents, legal acceptances, feedback, web intents, device data, synced
contacts, and avatar metadata. Prayer activity is removed only by a direct
user-scoped `DELETE`; its rows and content are never selected, serialized,
counted by type, or logged.

Privacy-request content is scrubbed while minimal technical lifecycle rows
remain. `app_users` is deleted last. Operational actor references, including
admin event-publication audit history, remain and become `NULL` through
verified `ON DELETE SET NULL` foreign keys. The same transaction creates one
evidence row containing a keyed subject reference and sorted technical category
codes, never raw identifiers, counts, contact data, object keys, payment data,
request text, or prayer data.

Migration `20260806200000` adds one encrypted completion-notification row per
successful execution. It is created in the same PostgreSQL transaction as
destruction evidence, request completion, and final `app_users` deletion. It
stores no raw email or message body. The canonical recipient is protected with
a dedicated backend-only AES-256-GCM key and authenticated row identifiers.

After commit, the worker sends one of two plain-text Russian transactional
templates for `completed` or `completed_with_retention`. A normal concurrent
retry is serialized by a PostgreSQL row lock. SMTP failure does not roll back
erasure: rerunning the same one-request CLI retries only pending delivery,
without another S3 or PostgreSQL deletion. Encrypted recipient bytes are
cleared after delivery or expiry. Delivery remains at-least-once because a
crash after SMTP acceptance but before outbox commit can cause a duplicate.

Pre-migration worker-v1 completions without an outbox remain completed and
report `legacy_notification_unavailable`; no recipient is reconstructed.
Before avatar or PostgreSQL deletion, worker-v3 validates the external private
register's version and non-secret hash-key fingerprint and writes an idempotent
PII-free subject marker. Failure leaves all personal data intact for retry.
The owner-run restore replay defaults to dry-run, preflights every marker before
mutation, reuses the same deletion manifest, writes PII-free replay evidence,
and never creates a request or notification. Automatic scheduling, backup
creation/purge, final retention periods, production SMTP/storage residency
approval, and a real restore drill remain launch responsibilities.
