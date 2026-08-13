# Event image storage boundary

Event-image writes are owned by the FastAPI backend. Administrators and other
clients must never receive object-storage credentials, choose authoritative
object keys, write directly to the bucket, or connect directly to PostgreSQL.
Authorized event-image writes are exposed only through the event-scoped
`PUT /admin/events/{event_id}/image` and
`DELETE /admin/events/{event_id}/image` lifecycle routes. There is no general
media or direct-storage endpoint.

## Public promotional-media boundary

Event images are public promotional media. The dedicated `event-images` bucket
may grant anonymous `s3:GetObject` for individual objects so existing consumers
can continue rendering a normal HTTP(S) `events.image_url`. The anonymous policy
must not grant bucket listing, writes, deletes, policy changes, multipart upload
management, or any administrative action. Everything not explicitly allowed is
denied.

The event-image bucket is separate from the private `avatars` bucket. Avatars
remain private and continue using the existing short-lived presigned URL flow.
Public event-image policy must never be copied to `avatars`.

An event-image URL can be shared independently of event visibility, including
for a members-only event. Administrators must not upload participant lists,
tickets, identity documents, private correspondence, prayer information, access
codes, or any other sensitive or identity-linked material as an event image.

## Backend-only configuration

The API reuses its backend S3 endpoint, region, access key, secret key, and path
style settings. Event images add two independent settings:

- `API_OBJECT_STORAGE_EVENT_IMAGES_BUCKET` names the separate writable bucket;
- `API_EVENT_IMAGE_PUBLIC_BASE_URL` is the externally reachable base URL that
  already includes the public bucket or CDN path.

The public base URL must be an absolute HTTP(S) URL without credentials, query
parameters, fragments, private addresses, internal container hostnames, or
filesystem paths. HTTPS is required outside localhost/loopback development.
Production must use a stable public hostname whose routing maps only the public
event-image namespace. Internal S3 endpoints, object keys, ETags, content hashes,
and credentials are backend-only and must not be returned to clients.

Published compatibility URLs append a non-secret UUID version token as
`?v=<version_token>` for cache invalidation. The token is not authorization and
does not make an object private.

## Production hosting contour

Before release, the primary event-image bucket, every replica, and every backup
must be provisioned and retained entirely inside the project owner's approved
Russian hosting contour. Cross-border replication, failover, backup export, or
CDN origin replication is prohibited unless the owner separately approves a
revised contour. Infrastructure review must verify region placement, anonymous
object-read-only policy, backend write identity, encryption, retention, backup
restore capability, and public-host routing.

The public bucket policy is deliberately narrower than the backend identity.
The backend identity needs only the object operations required by the lifecycle
service; bucket policy administration should use a separate operational role.

## Normalization and metadata

Caller-provided bytes are never stored or served directly. The API enforces the
source byte and decoded pixel limits, accepts only single-frame JPEG, PNG, or
WebP raster images, applies EXIF orientation, bounds dimensions, removes source
metadata, and emits a fresh WebP object. PostgreSQL stores the normalized size,
dimensions, SHA-256, optional provider ETag, version token, and lifecycle state.
`events.image_url` remains the consumer compatibility projection; historical
values are neither changed nor backfilled by this migration.

## Authorized lifecycle and transaction ordering

Both routes reuse the admin-event manageable-community contract: the caller
must be authenticated and have an active `admin` or `event_manager` membership
in the event's community. Unknown and cross-community event ids share the safe
`404 not_found` result. Authorization precedes normalization and storage work.

Upload accepts exactly one multipart uploaded-file part named `file`. The
backend does not trust filename, extension, MIME declaration, dimensions, or
`Content-Length`. Normalization runs off the async event loop and outside the
activation lock. Before storage readiness, metadata may exist only as
non-active `pending`; an active row can therefore never point at an object
whose write did not complete.

First activation and different-content replacement use this ordering:

1. authorize and close the authorization-only read transaction;
2. retry at most four eligible stale rows for the same event;
3. normalize to WebP and compute the normalized SHA-256;
4. under a short event lock, return immediately if the current active managed
   image already has the same hash;
5. create a `pending` row with a new opaque object key and non-secret version
   UUID, then commit it;
6. write the normalized object with backend-only credentials;
7. lock the scoped event, pending row, and current active row;
8. recheck same-content replay and verify both `event_id` and `community_id`;
9. in one PostgreSQL transaction, activate the ready row, update
   `events.image_url`, and mark the previous managed row `delete_pending`;
10. after commit, attempt deletion of the previous object and mark that row
    `deleted` only after deletion succeeds.

The old URL and active row stay unchanged through normalization and object
write. A write or activation failure therefore cannot clear a current image.
If a concurrent request activated the same normalized content first, the
losing ready object remains non-active and is deleted through the same safe
cleanup path; the existing URL and version token are returned unchanged.

A legacy/external `events.image_url` has no managed active row. Replacement
activates the new managed object but never attempts to delete the external
resource.

## Removal, failure, and retry states

Removal is idempotent. No image returns the event unchanged. A legacy/external
URL with no active managed row is cleared only in PostgreSQL. For a managed
image, an event lock protects one transaction that clears `events.image_url`
and marks the active row `delete_pending`. Object deletion happens only after
that commit. Failure does not restore the public URL; it leaves retryable
metadata and returns no provider detail. Success advances the row to `deleted`
with `deleted_at`.

If a new object write succeeds but activation fails, the row remains
non-active, the session is rolled back explicitly, and deletion is attempted
best-effort. Successful cleanup marks it `deleted`; failed cleanup leaves a
non-active retry state that cannot later become visible without another
authorized activation.

Every later event-image mutation opportunistically examines only the four
oldest stale `pending` or `delete_pending` rows for that event, using
`updated_at` and a one-hour age threshold. Each candidate is rechecked under
row locks. Cleanup refuses `active` metadata and refuses any object whose key
is still referenced by the current event URL. Object deletion and metadata
finalization are idempotent. This bounded retry is the only cleanup runtime in
this PR; no scheduler or worker is added.

All client-visible failures use safe codes: `event_image_too_large`,
`unsupported_event_image_type`, `invalid_event_image`,
`event_image_storage_unavailable`, or scoped `not_found`. Messages never
contain filenames, multipart content, object keys, hashes, ETags, provider
payloads, internal endpoints, or credentials.

The public-media boundary is unchanged: only normalized promotional event
images are anonymously readable, while writes/deletes remain backend-only and
the private avatar bucket remains private. Ordinary admin event JSON create
and update continue to accept nullable `image_url` temporarily until the later
upload-only hardening PR; importer behavior is unchanged.

## Rollback and orphan cleanup

Migration downgrade is suitable only for disposable development environments.
Dropping `event_images` cannot delete bucket objects and can erase the mapping
needed for safe cleanup. Before any non-disposable rollback, operators must:

1. stop event-image lifecycle writes;
2. inventory non-deleted metadata and bucket objects without exposing object
   identifiers in user-linked logs;
3. reconcile active URLs and decide whether objects must remain reachable;
4. delete confirmed orphans using backend operational credentials;
5. verify bucket inventory and backups before dropping metadata.

Future lifecycle code must leave a failed write non-active. If an object write
succeeds but database activation fails, it should mark or retain the row for
cleanup and attempt best-effort object deletion. Cleanup must be idempotent,
bounded, observable through non-sensitive counts, and safe to retry. Rollback
must not silently invalidate existing managed URLs or orphan objects.
