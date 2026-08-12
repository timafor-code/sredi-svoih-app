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
   result. A password is not required to finish registration.
7. When the result returns a one-time `set_password` handoff, send it to
   `POST /auth/confirm-set-password`. For a replay that returns
   `request_set_password`, first call `POST /auth/request-set-password`, then
   confirm the delivered code through the same confirm endpoint. `sign_in`
   only explains that the existing password can be used later; this flow does
   not create a web login session.

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
  movement to the first invalid field and email-code field.

Browser smoke is performed manually by the project owner on the pushed PR
branch before merge.
