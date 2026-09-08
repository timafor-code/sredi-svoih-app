# Public web local development

The public event-registration shell is a standalone Vite application in
`apps/web`. It reads the dedicated public Python API contract and does not use
the admin or mobile runtime.

## Install

```powershell
npm install --prefix apps/web
```

## Start the canonical API contour

```powershell
docker compose -f infra/docker-compose.api.yml up -d
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

## Start public web

```powershell
npm run web:dev
```

Open a fixture event at:

```text
http://localhost:5174/events/<public-slug>
```

An occurrence may be preselected without adding any participant data to the
URL:

```text
http://localhost:5174/events/<public-slug>?occurrence=<occurrence-uuid>
```

Legacy `/events/<event-uuid>` links remain supported and are replaced in-place
with the backend-returned canonical slug path after a successful form read.

The default `VITE_WEB_API_BASE_URL=/api` uses the local Vite proxy. The proxy
forwards to `http://127.0.0.1:8000` and removes the `/api` prefix. A developer
may override the local proxy destination through
`VITE_WEB_API_PROXY_TARGET`; neither value is a credential.

## Backend fixture requirements

The event fixture must have all of these values and related data:

- `status = published`;
- `visibility = public`;
- `registration_mode = internal_free` or `internal_paid`;
- `web_visibility = unlisted` or `listed`;
- one active `event_registration_consent` legal document.

An active `special_category_consent` legal document is optional. When present,
the registration-form response includes it and the browser offers the
participant-lineage question (see "Participant lineage declaration" below).
Its absence never blocks the registration form; only `event_registration_consent`
is mandatory.

Both registration modes are available simultaneously after this ordinary API
start. `internal_free` accepts only free non-donation options. `internal_paid`
supports the existing free, paid, and donation option contract; confirmation
finishes with registration and payment statuses `pending/pending` because no
real payment gateway is implemented.

The consent must be a current, non-retired document returned by the registration-form
endpoint. The browser submits that document's exact `id` and `content_hash`.
The privacy policy is displayed as an informational link and is not submitted
as another acceptance. Do not create a temporary local consent document and
treat it as a production seed.

## Email delivery configuration

Intent confirmation and the fallback set-password flow require working backend
email delivery. Configure these backend variables with local or reviewed test
values; never place SMTP credentials in `apps/web` or a Vite environment:

- `API_EMAIL_ENABLED`;
- `API_EMAIL_FROM_ADDRESS`;
- `API_EMAIL_FROM_NAME`;
- `API_EMAIL_SMTP_HOST`;
- `API_EMAIL_SMTP_PORT`;
- `API_EMAIL_SMTP_USERNAME`;
- `API_EMAIL_SMTP_PASSWORD`;
- `API_EMAIL_SMTP_STARTTLS`;
- `API_PUBLIC_APP_BASE_URL` for links emitted by the shared auth email flow.

The relevant local timing controls are
`API_WEB_REGISTRATION_INTENT_TTL_HOURS`,
`API_WEB_REGISTRATION_CODE_TTL_MINUTES`,
`API_WEB_REGISTRATION_CODE_MAX_ATTEMPTS`, and
`API_WEB_REGISTRATION_RESEND_COOLDOWN_SECONDS`. Disabled or failed email
delivery produces a safe temporary-unavailable response; the browser must not
pretend that a code was sent.

## Remembered participant browser state

Successful first-time email confirmation also sets an opaque, HTTP-only
remembered-participant cookie. The raw token is not present in the response
body, browser storage, or application JavaScript. Its server lifetime defaults
to 30 days through `API_WEB_PARTICIPANT_SESSION_TTL_DAYS`; leave
`API_WEB_PARTICIPANT_SESSION_COOKIE_DOMAIN` blank for the local host-only
cookie. The API derives the `Secure` attribute from the configured trusted
`PUBLIC_WEB_BASE_URL`, not browser-provided forwarding headers.

`GET /web/participant-session` returns either anonymous state or the canonical
registration identity for this browser. `DELETE /web/participant-session`
forgets only this browser by revoking its one server session and clearing the
matching cookie. Neither endpoint is an account-login API.

## Participant lineage declaration

`GET/PUT/DELETE /web/participant-profile/lineage` are cookie-authenticated
(`credentials: "include"`) and let a browser with a resolved identity —
a remembered-participant session or a signed-in account — see, change, or
withdraw its Jewish-lineage/giyur declaration once, independent of any single
event registration. The browser never shows this question to an unidentified
browser and never learns whether a declaration exists until identity is
resolved.

The public web renders one shared component (`LineageDeclarationPanel`) in two
places:

- on the registration page, next to the remembered-participant block, once
  identity is already resolved and no declaration exists yet;
- in the post-registration flow dialog's success step, alongside the optional
  password creation, because the remembered-participant cookie is only issued
  after email confirmation — this is the first point a first-time participant
  is identified.

When a declaration already exists, both placements render the same compact
`Вы уже указывали: …` summary with `Изменить` and withdrawal actions instead of
the question. The declaration's own consent checkbox is entirely separate from
the `event_registration_consent` checkbox: it links the current
`special_category_consent` document and is submitted only through
`PUT .../lineage`, never inside `POST /web/registration-intents`. Saving or
withdrawing the declaration is unrelated to registration submission — a
missing consent document, a skipped question, or a failed save never blocks or
rolls back the registration.

## Public registration flow

The browser performs this sequence:

1. Read and runtime-validate `GET /web/events/{public_slug}/registration-form`
   for a slug route, or the legacy
   `GET /events/{event_id}/registration-form?channel=web` for a UUID route. The
   browser accepts only a safe relative `canonical_public_path` from the API and
   replaces alias/UUID paths without reloading.
2. Render and validate the returned ordinary questionnaire fields, then
   validate the occurrence, selected participation options, seat count,
   participant fields, and separate event-registration consent.
3. Submit `POST /web/registration-intents` with the questionnaire version and
   normalized answers, only selected option quantities, and an in-memory Web
   Crypto idempotency key.
4. Confirm the six-digit email code through
   `POST /web/registration-intents/{flow_id}/confirm-email`, or explicitly
   request a new code through `POST .../{flow_id}/resend-code`.
5. Use `GET .../{flow_id}/status` only for a completed create replay or an
   ambiguous confirmation result. There is no background polling.
6. Display the canonical `confirmed`, `pending`, or `waitlisted` registration
   result. The registration is saved before optional password creation, so
   skipping password always leaves the registration intact.
7. On a fresh successful email confirmation for a participant without a
   password, the result includes a one-time direct `set_password` handoff for
   `POST /auth/confirm-set-password`. The participant may use it immediately
   or continue without a password. Confirmed-flow and status replays never
   return that handoff; they return `request_set_password`, which first calls
   `POST /auth/request-set-password` and then confirms the delivered code
   through the same confirm endpoint. `sign_in` only explains that the
   existing password can be used later; this flow does not create a web login
   session.
8. `Записаться ещё раз` is a browser UI reset only. It clears the completed
   attempt and returns to occurrence selection when required, but never
   creates a registration until the participant submits a new form.

When no published questionnaire exists, the registration-form response and
intent request use `questionnaire_form_id = null` and `answers = []`. When a
published questionnaire exists, the browser submits the exact
`questionnaire_form_id` returned by the registration-form API. Each answer
contains only `field_id` and its normalized value. If the published version
changes before submission, the API returns the safe `questionnaire_changed`
error; the participant must reload and complete the current questionnaire.

The flow credential, idempotency key, email code, set-password code, passwords,
participant data, and questionnaire answers stay in React memory only. The
application does not write them to `localStorage`, `sessionStorage`, cookies,
IndexedDB, the URL, or the console. Reloading the page may therefore discard an
unfinished flow, which is expected for this release.

## Manual smoke

Codex does not run browser or Expo smoke. On the pushed PR branch, the project
owner should manually verify:

- a synthetic registration without a password, including received email code;
- Create account followed by setting a password on the same user and
  registration;
- an existing claimed account completing registration without forced login;
- invalid and expired codes, explicit resend, and resend cooldown;
- confirmed, pending, waitlisted, full, closed-window, and unavailable results;
- double-click and same-payload network retry without duplicate intents or
  registrations;
- rendering and input behavior for all five ordinary questionnaire field types:
  short text, long text, single select, multi-select, and explicit yes/no;
- required questionnaire validation and focus movement to the first invalid
  questionnaire control;
- questionnaire version change and safe stale-form handling through
  `questionnaire_changed`;
- successful email-confirmed registration with questionnaire answers;
- absence of questionnaire answers from the URL, `localStorage`,
  `sessionStorage`, cookies, and console output;
- absence of participant data and all flow/password credentials from URLs,
  browser storage, and console output;
- mobile and desktop layouts, visible loading states, keyboard order, and focus
  movement to the first invalid field and email-code field;
- the lineage question is absent for a fresh/unidentified browser, appears for
  a remembered participant with no declaration, and is replaced by the
  collapsed summary once a declaration exists;
- `Я не знаю` clears other lineage selections and vice versa;
- `Изменить` and withdrawal on an existing lineage declaration;
- a skipped or failed lineage save never blocks or rolls back the completed
  registration.

Browser smoke is performed manually by the project owner on the pushed PR
branch before merge.
