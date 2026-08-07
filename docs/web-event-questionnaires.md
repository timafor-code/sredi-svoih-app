# Web Event Questionnaires

This document describes the backend-only first part of the split webreg PR 11
implementation on `feature/web-event-questionnaires-basic`.

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

No retention value is inferred or defaulted. The preliminary retention concept
elsewhere in the specification is not an approved universal value. This PR
stores no answers and therefore calculates no answer purge timestamp.

## Versioning and publication

`event_registration_forms` is unique by event, channel, and positive version.
At most one draft and one published version may exist for an event/channel.
Publishing atomically retires the previous published version. PostgreSQL
triggers prevent published or retired definitions and their fields from being
mutated; editing after publication creates or uses the next draft version.
Deleting the canonical event cascades its questionnaire definitions.

`event_registration_form_fields` enforces the five-type allowlist, ordinary
category, positive retention, non-empty field metadata, unique `field_key`
inside a form, and type-appropriate option shape. There is deliberately no
answer table in this PR.

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

now returns `questions`. It is an empty array when no published version exists
and contains only ordered fields from the active published ordinary version
otherwise. Draft and retired definitions and actor/database metadata are never
public. Existing `disabled`, `unlisted`, and `listed` publication rules remain
unchanged.

## Explicit boundaries

This PR adds definition storage and API contracts only:

- no admin questionnaire UI;
- no public questionnaire rendering;
- no answer submission;
- no answer persistence;
- no activation of the existing registration-intent answer column;
- no document upload, hidden field, arbitrary markup, executable script, or
  fingerprint mechanism;
- no special-category fields, including health, allergy or dietary data,
  religious or Jewish status, conversion/giyur, nationality, child data,
  passport/migration data, disability, documents, photos, or biometrics;
- no relationship to prayer tracking.

`POST /web/registration-intents` continues to reject non-empty `answers` with
`Questionnaire answers are not available`. Publication changes neither
capacity nor identity matching and creates no registration.

## Next PR

`feature/admin-web-event-questionnaires-basic-ui`
