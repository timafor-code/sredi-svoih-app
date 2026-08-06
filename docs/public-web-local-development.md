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
docker compose -f infra/docker-compose.api.yml up -d --build api_postgres api_object_storage api_object_storage_init api_backend
docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
```

## Start public web

```powershell
npm run web:dev
```

Open a fixture event at:

```text
http://localhost:5174/events/<event-uuid>
```

An occurrence may be preselected without adding any participant data to the
URL:

```text
http://localhost:5174/events/<event-uuid>?occurrence=<occurrence-uuid>
```

The default `VITE_WEB_API_BASE_URL=/api` uses the local Vite proxy. The proxy
forwards to `http://127.0.0.1:8000` and removes the `/api` prefix. A developer
may override the local proxy destination through
`VITE_WEB_API_PROXY_TARGET`; neither value is a credential.

## Backend fixture requirements

The event fixture must have all of these values and related data:

- `status = published`;
- `visibility = public`;
- `registration_mode = internal_free`;
- `web_visibility = unlisted` or `listed`;
- one active `event_registration_consent` legal document.

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

1. Read and runtime-validate
   `GET /events/{event_id}/registration-form?channel=web`.
2. Validate the occurrence, selected participation options, seat count,
   participant fields, and separate event-registration consent.
3. Submit `POST /web/registration-intents` with `answers: []`, only selected
   option quantities, and an in-memory Web Crypto idempotency key.
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

The flow credential, idempotency key, email code, set-password code, passwords,
and participant data stay in React memory only. The application does not write
them to `localStorage`, `sessionStorage`, cookies, IndexedDB, the URL, or the
console. Reloading the page may therefore discard an unfinished flow, which is
expected for this release.

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
- absence of participant data and all flow/password credentials from URLs,
  browser storage, and console output;
- mobile and desktop layouts, visible loading states, keyboard order, and focus
  movement to the first invalid field and email-code field.

Browser smoke is performed manually by the project owner on the pushed PR
branch before merge.
