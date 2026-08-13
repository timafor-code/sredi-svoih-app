# Event image storage boundary

Event-image writes are owned by the FastAPI backend. Administrators and other
clients must never receive object-storage credentials, choose authoritative
object keys, write directly to the bucket, or connect directly to PostgreSQL.
This foundation does not expose an upload route; authorized lifecycle endpoints
are intentionally deferred to a later PR.

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
