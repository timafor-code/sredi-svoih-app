# Web Event Questionnaires

This document describes the completed webreg PR 11 implementation: versioned
ordinary questionnaire configuration, public rendering, strict submission,
email-confirmed answer persistence, retention metadata, and privacy coverage.

## Scope

The API stores versioned questionnaire definitions for the `web` event
registration channel. Each form has a mandatory plain-text purpose. Each field
has a mandatory plain-text label and purpose, a positive explicit retention
period, and the single supported data category `ordinary`.

Supported field types are intentionally limited to:

- `short_text`;
- `long_text`;
- `single_select`;
- `multi_select`;
- `boolean`.

Select fields require a non-empty list of unique stable technical values and
plain-text labels. Text fields may use only `min_length` and `max_length`.
Multi-select fields may use only `min_selections` and `max_selections`.
Single-select and boolean fields accept no validation keys. Unknown request
properties, unsupported validation keys, control characters, markup-like
labels, and options on non-select fields are rejected.

No retention value is inferred or defaulted. Each final answer receives
`purge_at` from the participation date plus that field's configured
`retention_days`. For occurrence registration the anchor is `ends_at`, falling
back to `starts_at`; otherwise the event dates are used. Periodic production
execution of deletion by indexed `purge_at` remains a launch dependency for
`ops/public-web-production-deploy` if no scheduler is already wired.

## Versioning and publication

`event_registration_forms` is unique by event, channel, and positive version.
At most one draft and one published version may exist for an event/channel.
Publishing atomically retires the previous published version. PostgreSQL
triggers prevent published or retired definitions and their fields from being
mutated; editing after publication creates or uses the next draft version.
Deleting the canonical event cascades its questionnaire definitions and answer
rows without leaving orphans.

`event_registration_form_fields` enforces the five-type allowlist, ordinary
category, positive retention, non-empty field metadata, unique `field_key`
inside a form, and type-appropriate option shape. There is deliberately no
special-category or dormant future field type.

`event_registration_answers` stores one JSONB value per canonical registration
and field, with a unique `(registration_id, field_id)`, `created_at`, and
indexed `purge_at`. Database checks allow only string, boolean, or arrays of
strings; the server applies the authoritative field-specific validation.

## API contracts

Only an active community `admin` may configure questionnaires:

```text
GET  /admin/events/{event_id}/web-questionnaire
PUT  /admin/events/{event_id}/web-questionnaire/draft
POST /admin/events/{event_id}/web-questionnaire/publish
```

The event is always resolved through the admin's active community membership.
An `event_manager` or member cannot define fields, and foreign-community event
identifiers do not expose questionnaire contents.

The existing public contract:

```text
GET /events/{event_id}/registration-form?channel=web
```

now returns `questionnaire_form_id` and `questions`. They are respectively
`null` and an empty array when no published version exists; otherwise the
response contains only ordered fields from the active published ordinary
version. Draft and retired definitions and actor/database metadata are never
public. Existing `disabled`, `unlisted`, and `listed` publication rules remain
unchanged.

`POST /web/registration-intents` accepts the exact returned form UUID and up to
100 strict `{field_id, value}` answers. It rejects missing, stale, foreign,
unknown, duplicate, incorrectly typed, or constraint-violating answers. A stale
submission returns the safe `questionnaire_changed` code. Values are never
coerced.

Validated normalized answers exist temporarily only in
`web_registration_intents.answer_payload`. The intent is bound to the accepted
immutable `questionnaire_form_id`, so later publication cannot reinterpret an
in-flight registration. The idempotency fingerprint includes the form and
answers. Identity-failure flows do not retain answer contents.

Canonical answers are created only after successful email verification, in the
same transaction as the final registration and legal evidence. Invalid codes,
capacity changes, unavailable events, identity conflicts, and transaction
failures create no final answer rows. After successful finalization the
temporary payload is cleared; confirmed replay returns the existing
registration without duplicate answer rows.

## Admin configuration UI

The existing event edit page shows `Анкета регистрации` immediately after the
web-registration card and before the occurrence editor. The card is mounted
only for an `admin`; an `event_manager` neither sees the card nor calls the
questionnaire endpoints. Backend authorization remains authoritative. The
create-event page has no questionnaire editor because the API requires an
existing event ID.

The editor exposes only the five supported ordinary field types. Form purpose,
question label and purpose, and a positive explicit retention period are
mandatory. Select options receive stable technical values, fields receive
stable technical keys, and reordering writes deterministic sort orders. The UI
does not expose a data-category selector or sensitive/special-category
controls.

## Public questionnaire UI

The existing public registration form renders all five allowlisted controls
under `Дополнительные вопросы`: text input, textarea, accessible radio group,
checkbox group, and explicit `Да`/`Нет` boolean radios. Label, required state,
purpose, and retention days are visible. Client validation mirrors required,
length, allowlist, selection-count, and explicit-boolean rules for UX, links
errors accessibly, and focuses the first invalid questionnaire control. The
backend remains authoritative.

Answers live only in React memory and the HTTPS request flow. They are never
placed in URLs, cookies, analytics, logs, console output, local storage,
session storage, or IndexedDB, and answer text is never interpreted as HTML.

## Privacy coverage

Own-data summary and JSON export include `questionnaire_answers`. Exported rows
contain registration and field identifiers, the stable field key, question
label and purpose, value, `created_at`, and `purge_at`; queries are scoped
through the verified user's registrations. The shared privacy-erasure deletion
manifest explicitly deletes answer rows before registrations. The irreversible
worker and restore replay therefore remove restored answer data as well, while
prayer content remains outside read/export paths.

Saving a draft is an explicit action; changes are not sent on every keystroke.
Refreshing a dirty editor requires confirmation before local changes are
discarded. Publishing is a separate explicitly confirmed action. Published
versions are shown read-only and cannot be edited, deleted, unpublished, or
retired from the UI. Starting a new local version may copy the published
definition without changing it.

## Explicit boundaries

The completed end-to-end slice retains these boundaries:

- no document upload, hidden field, arbitrary markup, executable script, or
  fingerprint mechanism;
- no special-category fields, including health, allergy or dietary data,
  religious or Jewish status, conversion/giyur, nationality, child data,
  passport/migration data, disability, documents, photos, or biometrics;
- no relationship to prayer tracking.

Questionnaire publication changes neither capacity nor identity matching and
creates no registration. Only email-confirmed finalization creates canonical
answer data.

## Next PR

`ops/public-web-production-deploy`
