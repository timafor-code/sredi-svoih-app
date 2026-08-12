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
| `payment_status=succeeded` with a positive, single-currency canonical option total | Snapshot minimal evidence, then delete the live graph | `financial_evidence` |
| `payment_status=paid` with a positive, single-currency canonical option total | Snapshot minimal evidence, then delete the live graph | `financial_evidence` |
| `payment_status=refunded` with a positive, single-currency canonical option total | Snapshot minimal evidence, then delete the live graph | `financial_evidence` |
| Unsupported payment state or finalized state with missing/non-positive/mixed-currency amount evidence | Fail closed for manual review; do not restore access | None until classified |

Registration mode, event price, payment identifier, a priced participation
option, and a donation marker are not retention decisions. In particular,
`internal_paid` does not qualify by itself. Only the canonical finalized
payment states `succeeded`, `paid`, and `refunded` are candidates.

## Deleted data

The worker preserves the immediate `deletion_pending` access termination. On
successful physical erasure it deletes credentials, sessions, codes, profile
and contact fields, private avatar object and metadata, device state and tokens,
synced contacts and visibility, memberships, questionnaire answers, web
registration intents, registrations and their option/capacity/seating graph,
legal acceptances, feedback, privacy-request text, and the live `app_users`
identity row. The identity row is deleted last.

Non-finalized financial attempts and all non-retained registration data are
deleted with the live registration graph. Selective retention does not preserve
the profile, registration, questionnaire, or seating graph.

## Minimal retained evidence

One `privacy_retained_financial_evidence` row is created per qualifying source
registration. Its unique source-registration constraint makes creation
idempotent. The row contains only:

- pseudonymous `subject_ref_hash`;
- `source_registration_id` and non-PII `source_event_id` references without
  foreign keys to the deleted graph;
- canonical finalized `financial_state`;
- aggregate canonical option `amount` and `currency`;
- `retention_basis_code=finalized_event_registration_financial`;
- `retention_until` and `created_at`.

It contains no name, email, phone, address, profile/avatar data, registration
comment, option title/description, questionnaire answer, credential/session,
contact, device, prayer, or generic JSON payload.

## Retention duration

The repository contains no approved numeric financial-retention period. A
positive backend-only `API_PRIVACY_ERASURE_FINANCIAL_RETENTION_DAYS` value is
therefore mandatory when finalized financial evidence is present. It is not
required for an erasure with no retained category.

`retention_until` is the physical-erasure completion timestamp plus the exact
configured number of calendar days. Missing configuration fails closed with
`privacy_erasure_retention_configuration_unavailable`; the worker does not set
`execution_started_at`, invent a date, touch avatar storage, delete the live
account, or restore account access. Owner/legal approval of the configured
value remains a production prerequisite.

## Completion and exceptions

When no snapshot is created, destruction evidence records
`result_status=completed`, `categories_retained=[]`, and
`retention_until=null`. When one or more snapshots are created, it records
`result_status=completed_with_retention`,
`categories_retained=["financial_evidence"]`, and the actual shared retention
deadline. Completion notification uses the existing data-minimal
`completed_with_retention` copy and does not claim that every record has been
destroyed.

Routine paid history does not require manual review. Manual review remains for
unsupported, unknown, or inconsistent finalized financial data that cannot be
classified safely. Configuration failure is retryable after an approved value
is supplied. Neither path changes `deletion_pending` or restores credentials.

## Automatic runtime operations

Production automation runs as the separate
`python -m app.workers.privacy_erasure` process, never inside FastAPI. Its
backend-only enable flag, bounded poll interval, and bounded batch size are
documented in the production deploy runbook. PostgreSQL queue claiming prevents
concurrent execution and releases recoverably if a worker crashes; the runtime
still delegates all classification, deletion, retention, evidence, and
notification behavior to the canonical idempotent single-request worker.

Only canonical retryable failures are polled again. Completed, cancelled, and
manual-review requests do not hot-loop. When the runtime is disabled, eligible
requests stay queued as `deletion_pending` with access revoked. The existing
single-request CLI remains available only for owner/debug/recovery use.

Automatic execution does not relax the retention prerequisite above. If a
request contains finalized financial evidence and
`API_PRIVACY_ERASURE_FINANCIAL_RETENTION_DAYS` is unavailable, it fails closed
and remains retryable after an approved duration is configured.

## Prayer privacy boundary

Prayer tracker data is never selected, read, serialized, logged, retained, or
included in destruction evidence. The only permitted operation remains the
existing direct user-scoped `DELETE` from `prayer_activity_logs`, without
`RETURNING`.
