# Avatar Storage

PR 32G adds the backend-only foundation for API-owned avatar storage. PR 32H
switches the mobile avatar service behind `EXPO_PUBLIC_AVATAR_PROVIDER=api`
while keeping Supabase Storage as the default and fallback provider until
cutover.

## Architecture

Avatar objects are stored in a private S3-compatible bucket. The mobile client
does not receive bucket credentials, bucket names, object keys, endpoint
configuration, or public-read ACLs.

The API stores durable metadata in PostgreSQL:

- `profile_avatars.id` is the opaque avatar UUID returned to clients.
- `profile_avatars.object_key` is generated only by the backend.
- `profiles.avatar_id` points to the current active API-owned avatar.
- legacy `profiles.avatar_url` remains for migration compatibility and is
  cleared when a new API-owned avatar becomes active or when the user deletes
  their avatar.

Signed upload and read URLs are short-lived bearer URLs. They are returned only
in API responses and are never stored in PostgreSQL.

The backend uses two object-storage endpoints. `API_OBJECT_STORAGE_ENDPOINT_URL`
is the internal server-to-storage endpoint used for `HEAD`, delete, and other
backend requests. `API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL` is used only by the
presigning client so returned upload/read URLs point at an address reachable by
the testing client. Presigning does not require the API container to connect to
that public address.

## Mobile Provider Switch

Mobile keeps Supabase behavior when `EXPO_PUBLIC_AVATAR_PROVIDER` is unset,
`supabase`, or any unknown value. When `EXPO_PUBLIC_AVATAR_PROVIDER=api`, the
mobile avatar facade uses the Python API at `EXPO_PUBLIC_API_URL` for upload,
read, and delete operations. API avatar errors are surfaced to the current UI;
the client never retries a failed API-provider upload, read, or delete through
Supabase.

During the mixed-auth bridge period, the shared mobile `apiClient` supplies the
same bearer token source used by other API provider switches: API auth tokens
when `EXPO_PUBLIC_AUTH_PROVIDER=api`, otherwise the current Supabase access
token for bridge-authenticated API calls. The object-storage `PUT` is separate
from API calls and sends only the exact headers returned by
`POST /me/avatar/upload-url`; it must not include the application bearer token
and must not JSON-encode or base64-wrap the image bytes.

For Expo/iPhone smoke with API avatars, both `EXPO_PUBLIC_API_URL` and the
presigned object-storage URLs must be reachable from the phone. Set
`EXPO_PUBLIC_API_URL` to the computer LAN API address, set
`API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL` to the computer LAN IP plus the MinIO
API port, and expose that object-storage port for the run. A localhost or
container-internal presigned URL will work for desktop tools but not for an
iPhone on the LAN.

Signed read URLs are transient bearer URLs. The mobile client may hold them only
in memory, may refresh them before `expires_at` with a safety margin, and must
never persist them to Supabase, PostgreSQL, AsyncStorage, SecureStore, logs, or
another durable client store. The client must not append cache-busters or any
other query parameters to signed URLs. The legacy cache-buster remains valid
only for Supabase public avatar URLs.

In API mode, the current user's avatar is resolved by reading `profile.avatar_id`
from `GET /auth/me` and then requesting `GET /avatars/{avatar_id}`. Legacy
`avatar_url` is ignored in API avatar mode so old Supabase public URLs do not
silently mask missing, deleted, unauthorized, unavailable, or expired API
avatars; those cases degrade to initials.

## Local And Production Storage

Local development may use the private MinIO service in
`infra/docker-compose.api.yml`:

- `api_object_storage` runs S3-compatible object storage.
- `api_object_storage_init` creates the local `avatars` bucket and disables
  anonymous access.
- the internal API endpoint is `http://api-object-storage:9000`.
- the default local public presigned-URL endpoint is
  `http://127.0.0.1:59000`.
- for Expo/iPhone smoke, set `API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL` to
  `http://<computer-lan-ip>:59000` before starting `api_backend`. Also expose
  the MinIO API port for that local run by setting
  `API_OBJECT_STORAGE_HOST_BIND=0.0.0.0` or a specific LAN interface address;
  keep the internal endpoint as `http://api-object-storage:9000`.
- host ports are bound to `127.0.0.1` by default for local owner inspection
  only.
- credentials in `infra/env/api.env.example` are synthetic local values.

Production storage must be a Russia-hosted S3-compatible endpoint with a
private bucket. MinIO is only the local smoke-test provider. This document does
not claim 152-FZ or other legal compliance; production deployment still needs
owner/legal review.

## Lifecycle

1. `POST /me/avatar/upload-url` validates declared MIME type and size, creates
   a pending `profile_avatars` row, and returns a short-lived presigned `PUT`
   URL plus required headers.
2. The client uploads directly to object storage with the required
   `Content-Type`.
3. `POST /me/avatar/confirm` verifies the uploaded object with server-side
   `HEAD`, creates the new signed read URL before activation, removes the
   previous active object before committing replacement metadata, updates
   `profiles.avatar_id`, clears legacy `profiles.avatar_url`, and returns the
   short-lived signed read URL. If previous-object removal fails, the new
   avatar remains pending so confirmation can be retried.
4. `GET /avatars/{avatar_id}` authorizes the caller and returns a fresh
   short-lived signed read URL for an active confirmed avatar.
5. `DELETE /me/avatar` deletes the active storage object, clears
   `profiles.avatar_id`, clears legacy `profiles.avatar_url`, and marks the
   metadata row deleted. Repeating delete with no active avatar is safe.

Only one active avatar is allowed per user through a partial unique index.
Replacement confirmation does not delete the previous active object before the
new object has been uploaded and verified. Retrying confirmation for an avatar
that is already the caller's current active avatar is idempotent and returns
the active metadata with a fresh signed read URL.

## Accepted Files

The API accepts only these avatar MIME types:

- `image/jpeg`
- `image/png`
- `image/webp`
- `image/heic`
- `image/heif`

`image/jpg` is normalized to `image/jpeg`. SVG, HTML, arbitrary binaries,
executables, caller-selected unsupported content types, base64 image payloads,
filenames, and device paths are not accepted. The default maximum size is
5 MiB and is controlled by backend-only `API_AVATAR_MAX_SIZE_BYTES`.

Confirmation trusts only object-storage `HEAD` metadata. Zero-byte objects,
objects over the configured maximum, and objects whose actual content type is
outside the allowlist are rejected and cleaned up when possible.

## Authorization

All avatar endpoints require `Authorization: Bearer <access_token>`.

Owners may read their own active avatar. A non-owner may read an avatar only
when both users have active membership in the same community and the target
profile is visible under the existing community-directory
`profile_visibility` rules:

- `members` and `public` are readable by active members in the same community.
- `rabbi_only` is readable only by `admin` or `rabbi` actors in that same
  community.
- `member` and `event_manager` actors do not receive `rabbi_only` avatars.

Missing, foreign, inactive, deleted, and unauthorized avatar ids return the
same safe `not_found` response.

## PII And Logging

Avatars are personal data. The API must not log:

- signed URLs or authorization query parameters;
- object-storage credentials;
- raw image bytes or base64 data;
- request bodies;
- raw storage provider errors that may contain signed request data;
- object keys together with user identity.

API responses never include object keys, bucket names, ETags, storage
credentials, or internal endpoint configuration.

## Known Limitation

PR 32G does not add a general background worker. Stale pending-upload cleanup is
limited to validation-time cleanup during confirmation; a scheduled cleanup job
can be added later if needed.
