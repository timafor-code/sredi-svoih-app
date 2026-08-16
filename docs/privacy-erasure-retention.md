# Privacy erasure selective retention

This document is the canonical engineering retention matrix for physical
privacy erasure. It defines classification and data minimization; it does not
create a legal retention period or approve production use by itself.

## Erasure matrix

| Source state or category | Worker action | Retained category |
| --- | --- | --- |
| No registration financial history | Delete | None |
| `payment_status=not_required` | Delete | None |
| `payment_status=pending` | Delete | None |
| `payment_status=failed` | Delete | None |
| `payment_status=cancelled` | Delete | None |
| `payment_status=succeeded` with a positive, single-currency canonical option total | Snapshot minimal canonical evidence, then delete the live graph | `financial_evidence` |
| `payment_status=paid` with a positive, single-currency canonical option total | Snapshot minimal canonical evidence, then delete the live graph | `financial_evidence` |
| `payment_status=refunded` with a positive, single-currency canonical option total | Snapshot minimal canonical evidence, then delete the live graph | `financial_evidence` |
| Canonical finalized state with missing/non-positive/mixed-currency option evidence | First pass fails closed for review; canonical runtime then snapshots only the observed inconsistent financial facts and deletes the live graph | `financial_evidence` |
| Unsupported payment state outside the database contract | Fail closed; requires a code/schema classification decision | None until classified |

Registration mode, event price, payment identifier, a priced participation
option, and a donation marker are not retention decisions. In particular,
`internal_paid` does not qualify by itself. Only the canonical finalized
payment states `succeeded`, `paid`, and `refunded` are financial-retention
candidates under the current database contract.

## Deleted data

The worker preserves the immediate `deletion_pending` access termination while
physical erasure is being processed. On successful physical erasure it deletes
credentials, sessions, codes, profile and contact fields, private avatar object
and metadata, device state and tokens, synced contacts and visibility,
memberships, questionnaire answers, web registration intents, registrations
and their option/capacity/seating graph, legal acceptances, feedback,
privacy-request text, and the live `app_users` identity row. The identity row is
deleted last.

`deletion_pending` is a processing state, not an account-retention state. A
financial-classification checkpoint must not become an indefinite reason to
keep the live account identity. The canonical runtime therefore has a bounded
recovery path for inconsistent finalized financial evidence.

Non-finalized financial attempts and all non-retained registration data are
deleted with the live registration graph. Selective retention does not preserve
the profile, registration, questionnaire, or seating graph.

## Minimal canonical financial evidence

One `privacy_retained_financial_evidence` row is created per qualifying source
registration when the finalized financial state has a positive, single-currency
canonical option total. Its unique source-registration constraint makes
creation idempotent. The row contains only:

- pseudonymous `subject_ref_hash`;
- `source_registration_id` and non-PII `source_event_id` references without
  foreign keys to the deleted graph;
- canonical finalized `financial_state`;
- aggregate canonical option `amount` and `currency`;
- `retention_basis_code=finalized_event_registration_financial`;
- `retention_until` and `created_at`.

It contains no name, email, phone, address, profile/avatar data, registration
comment, option title/description, questionnaire answer, credential/session,
contact, device, prayer, or generic user payload.

## Inconsistent finalized financial evidence recovery

A finalized state can exist while its canonical option evidence is incomplete,
for example when the observed option total is zero/missing or the observed
currencies are missing/mixed. The first worker pass still fails closed with
`privacy_erasure_manual_review_required`; it does not invent an amount or choose
a currency.

That marker is a classification checkpoint rather than a terminal account
state. On a later canonical worker pass, the retention planner records one
`privacy_financial_review_evidence` row per affected registration and continues
physical erasure. This review-evidence row contains only:

- pseudonymous `subject_ref_hash`;
- `source_registration_id` and non-PII `source_event_id`;
- the existing canonical finalized `financial_state`;
- the non-negative option total actually observed by the database;
- the sorted set of currency codes actually observed, which may be empty or
  contain more than one code;
- `retention_basis_code=inconsistent_finalized_event_registration_financial`;
- `retention_until` and `created_at`.

It deliberately contains no user id foreign key, name, email, phone, payment
identifier, event-registration comment, option title/description, profile,
questionnaire answer, prayer data, credential, session, or device data. It does
not normalize, estimate, or fabricate missing financial facts.

The review-evidence table is deployment-secret-bound through
`subject_ref_hash`. It must be classified as environment-bound in the promotion
contract before production data promotion resumes.

## Retention duration

The repository contains no approved numeric financial-retention period. A
positive backend-only `API_PRIVACY_ERASURE_FINANCIAL_RETENTION_DAYS` value is
therefore mandatory when either canonical or inconsistent finalized financial
evidence must be retained. It is not required for an erasure with no retained
category.

`retention_until` is the physical-erasure completion timestamp plus the exact
configured number of calendar days. Missing configuration fails closed with
`privacy_erasure_retention_configuration_unavailable`; the worker does not
invent a retention date or delete the live account until the configured
prerequisite is available. Once configuration is available, the request remains
eligible for retry. Owner/legal approval of the configured value remains a
production prerequisite.

## Completion and exceptions

When no snapshot is created, destruction evidence records
`result_status=completed`, `categories_retained=[]`, and
`retention_until=null`. When one or more canonical or review snapshots are
created, it records `result_status=completed_with_retention`,
`categories_retained=["financial_evidence"]`, and the actual shared retention
deadline. Completion notification uses the existing data-minimal
`completed_with_retention` copy and does not claim that every record has been
destroyed.

Erasure authorization is origin-aware without creating another deletion
engine. The `self_service` origin covers mobile, public-web signed-in deletion,
and the public-web passwordless verified flow; it requires subject identity
verification. The `admin` origin is created by web-admin member deletion and
instead provides the acting admin's app-user id and an admin-authorization
timestamp without populating the subject's identity-verification timestamp.
Both origins execute the same worker, retention classifier, deletion manifest,
and destruction-evidence path.

The self-service canonical-email and notification requirements are unchanged.
For a valid admin-origin request only, a target without a canonical email does
not block physical erasure. The completion outbox is omitted, no recipient
placeholder is stored, destruction evidence is still created, and the worker
reports `skipped_no_recipient` as the intentional notification outcome.

Routine paid history does not require a review pass. Inconsistent finalized
financial evidence gets one fail-closed classification marker and is then
eligible for canonical recovery without restoring account access. Configuration
failure remains retryable after an approved value is supplied.

## Automatic runtime operations

Production automation runs as the separate
`python -m app.workers.privacy_erasure` process, never inside FastAPI. Its
backend-only enable flag, bounded poll interval, and bounded batch size are
documented in the production deploy runbook. PostgreSQL queue claiming prevents
concurrent execution and releases recoverably if a worker crashes; the runtime
still delegates all classification, deletion, retention, evidence, and
notification behavior to the canonical idempotent single-request worker.

The canonical runtime may requeue `privacy_erasure_manual_review_required`
requests so the data-minimal review-evidence recovery path can finish physical
erasure. Test/custom executors keep the ordinary retry contract and do not gain
this recovery privilege. Completed and cancelled requests are never reprocessed.

The local Compose contour enables this same worker with clearly synthetic,
local-only notification-encryption and retention prerequisites. The local
retention duration exists only to exercise the existing financial-retention
paths; it is not a production policy, legal decision, or approved production
value. This local default does not enable production automatically. Production
still requires owner-approved worker configuration, secrets, retention
duration, storage, email, process supervision, and deployment decisions.

Automatic execution does not relax the retention prerequisite above. If a
request contains financial evidence that requires retention and
`API_PRIVACY_ERASURE_FINANCIAL_RETENTION_DAYS` is unavailable, it fails closed
and remains retryable after an approved duration is configured.

## Prayer privacy boundary

Prayer tracker data is never selected, read, serialized, logged, retained, or
included in destruction evidence. The only permitted operation remains the
existing direct user-scoped `DELETE` from `prayer_activity_logs`, without
`RETURNING`.
