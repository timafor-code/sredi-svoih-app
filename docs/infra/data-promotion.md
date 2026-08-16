# API PostgreSQL data promotion

## Purpose

This owner-run runbook promotes durable product data from one **Sredi Svoih FastAPI/PostgreSQL** environment to another environment on the **same Alembic head**. It is intended for the first controlled population of an empty API PostgreSQL target, including the Selectel test/production-like contour.

The implementation is `scripts/migration/promote_api_data.py`.

This is not a Supabase migration path. It does not read Supabase, `auth.users`, a service-role key, frontend env, or any client credential.

## Scope and safety boundary

The promotion preserves durable API data and primary UUIDs so relationships remain stable. The reviewed durable set includes, among other domains:

- `app_users`, including existing Argon2 `password_hash` values;
- profiles, communities, memberships, contact visibility, synced contacts;
- events, public slugs, occurrences, participation options, capacity, registrations, questionnaire definitions/answers, and legal acceptance evidence;
- seating layouts/tables/connections/assignments;
- prayer activity logs as private backend data;
- admin feedback/audit and event import history;
- avatar and event-image **database metadata**.

The utility intentionally excludes environment-bound or in-flight state, including:

- auth sessions and one-time verification/reset/set-password codes;
- active invite-code hashes, because they depend on `API_TOKEN_HASH_SECRET` and must be reissued in the target;
- web-registration intents/codes/identity-conflict workflow state;
- privacy-access sessions/codes and secret-bound erasure evidence/workflow state;
- device tokens and push job/delivery state.

Users therefore keep the same API password when `app_users.password_hash` is already present, but existing sessions are not promoted. Users sign in again in the target. Users whose `password_hash` is null still use the normal set-password flow.

The script never logs row values or database URLs. Its console output is limited to safe table names, counts, checksums, status, and redacted failure categories.

## Fail-closed guarantees

Promotion is refused when any of these conditions is true:

- source or target Alembic head differs from the script's reviewed head;
- a public application table is new, missing, or not explicitly classified as promoted/excluded;
- a promoted table's columns, types, primary key, or foreign-key dependency metadata differ between artifact and target;
- the artifact has missing, changed, undeclared, malformed, or duplicate-primary-key data;
- the target contains rows in any promotion-managed table;
- the source has an active deletion lifecycle;
- the source has an unexpired email-verification-required public-web registration intent;
- the source has queued/processing push jobs;
- active invites exist without explicit owner acknowledgement that they will be reissued;
- excluded privacy workflow/evidence rows exist without a separate owner acknowledgement appropriate only to an owner-approved test/staging promotion;
- avatar/event-image metadata exists but the owner has not confirmed the corresponding objects were copied and verified under the same object keys.

Apply uses one serializable transaction. It never truncates, deletes, updates, disables foreign keys, or changes schema. Any insert or exact post-insert verification failure rolls the complete transaction back.

## Object-storage boundary

Database promotion does **not** copy object bytes. `profile_avatars` and `event_images` metadata can be promoted only after the corresponding objects have been copied to the reviewed target object storage with the same `object_key` values and verified there.

Do not use `--ack-object-storage-ready` as a bypass. It means the object copy has actually been completed and checked. The S3 copy/verification procedure is a separate owner operation because production object-storage provider, credentials, bucket names, and endpoints are deployment decisions and must not be embedded in this script or repository.

## Prerequisites

Before any owner run:

1. Source and target must be on the exact Alembic head expected by the checked-out promotion script.
2. Source must be the reviewed current API PostgreSQL data set, not Supabase.
3. Target must have the API schema but no rows in promotion-managed tables.
4. Keep source/target connection URLs only in owner-controlled environment or the backend container environment. Never paste them into Git, chat, tickets, command arguments, or frontend config.
5. Use a protected artifact directory outside the repository. Artifacts contain personal data and must never be committed or shared.
6. Before `apply`, take a current logical backup of the target and complete the restore verification required by `docs/infra/postgres-backup-restore.md`.
7. Stop writes to the source for the final export/cutover window, or accept that writes after the export are not in the artifact. The script produces one repeatable-read snapshot; it is not replication or change-data-capture.

## Commands: local API source on Windows

These examples assume the canonical local API Compose contour and that `api_postgres` is healthy. They intentionally run the owner utility through the API image so host Python packages are not required.

Create a protected directory outside the repository, for example:

```powershell
$promotionDir = "F:\2026\SS-App\private\api-promotion-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $promotionDir | Out-Null
```

Build the current API image after the promotion PR is merged, then run export with the root migration directory mounted read-only:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app

docker compose -f infra/docker-compose.api.yml build api_backend

$env:API_PROMOTION_RUN_ACK = "OWNER_APPROVED_API_PROMOTION_EXPORT"
docker compose -f infra/docker-compose.api.yml run --rm --no-deps `
  -e API_PROMOTION_RUN_ACK `
  -v "${PWD}/scripts/migration:/migration:ro" `
  -v "${promotionDir}:/promotion" `
  api_backend `
  python /migration/promote_api_data.py export --output-dir /promotion
Remove-Item Env:API_PROMOTION_RUN_ACK
```

If the source has active invites, export stops and reports only the count. Review that they will be reissued in the target, then rerun with:

```text
--ack-reissue-active-invites
```

If excluded privacy workflow/evidence rows exist, do not bypass the stop for a final production cutover. For an owner-approved temporary test/staging promotion only, after explicitly accepting that those environment-bound records are not being promoted, the additional switch is:

```text
--ack-excluded-privacy-history
```

A successful export creates only:

```text
<promotion-dir>/
  manifest.json
  checksums.sha256
  tables/*.jsonl
```

Do not open, print, attach, or paste JSONL contents. They contain personal data.

## Verify and transfer the artifact

Verify the checksum index without opening row files:

```powershell
Get-FileHash -Algorithm SHA256 "$promotionDir\manifest.json"
Get-ChildItem "$promotionDir\tables\*.jsonl" | Get-FileHash -Algorithm SHA256
```

The script itself re-verifies all hashes before target preflight/apply. Transfer the entire protected directory to an owner-controlled protected path on the Selectel host using the approved SSH/SCP path. Do not place it under the Git checkout and do not put it in a public bucket.

After transfer, restrict host permissions to the deploy owner only before use.

## Target preflight on Selectel

Run through the production Compose API service so the database URL comes from the ignored backend production env file and is not exposed in command history. Mount the promotion artifact read-only.

Shape:

```bash
cd /opt/sredi-svoih

sudo docker compose \
  --env-file infra/env/.env.compose.production \
  -f infra/docker-compose.prod.yml \
  run --rm --no-deps \
  -v /opt/sredi-svoih/scripts/migration:/migration:ro \
  -v <protected-promotion-dir>:/promotion:ro \
  api_backend \
  python /migration/promote_api_data.py preflight --input-dir /promotion
```

If the artifact reports avatar/event-image metadata, preflight/apply must not proceed until the Selectel S3 object copy is complete. After the copy and verification, add:

```text
--ack-object-storage-ready
```

Preflight is read-only. It requires the target schema to match exactly and all promotion-managed target tables to be empty.

## Mandatory backup gate before apply

Immediately before apply:

1. Follow `docs/infra/postgres-backup-restore.md` for the current target.
2. Create a custom-format logical backup.
3. Verify its checksum/list structure.
4. Restore it into a separate disposable verification database.
5. Record successful restore evidence.

A disk snapshot alone does not replace this gate.

Do not run promotion apply when the latest target backup has not passed its restore test.

## Apply to the target

`apply` is a separate explicit owner action from export and preflight. Supply the acknowledgement only in the process environment:

```bash
cd /opt/sredi-svoih

export API_PROMOTION_RUN_ACK='OWNER_APPROVED_API_PROMOTION_APPLY'
sudo -E docker compose \
  --env-file infra/env/.env.compose.production \
  -f infra/docker-compose.prod.yml \
  run --rm --no-deps \
  -e API_PROMOTION_RUN_ACK \
  -v /opt/sredi-svoih/scripts/migration:/migration:ro \
  -v <protected-promotion-dir>:/promotion:ro \
  api_backend \
  python /migration/promote_api_data.py apply \
    --input-dir /promotion \
    --allow-production-target-with-owner-command \
    <add --ack-object-storage-ready only when required and actually complete>
unset API_PROMOTION_RUN_ACK
```

The target is checked again for emptiness inside the serializable transaction. Every durable table is inserted in foreign-key dependency order. Before commit, each target table is re-read in primary-key order and must match the artifact's exact row count and SHA-256 stream checksum. Excluded tables must remain empty.

If any check fails, apply exits non-zero and the transaction rolls back.

## Read-only post-apply validation

Run after successful apply:

```bash
cd /opt/sredi-svoih

sudo docker compose \
  --env-file infra/env/.env.compose.production \
  -f infra/docker-compose.prod.yml \
  run --rm --no-deps \
  -v /opt/sredi-svoih/scripts/migration:/migration:ro \
  -v <protected-promotion-dir>:/promotion:ro \
  api_backend \
  python /migration/promote_api_data.py validate --input-dir /promotion
```

Expected terminal result ends with:

```text
validation_ok tables=<reviewed-table-count>
```

Validation compares exact durable-table row counts and deterministic table checksums and confirms every excluded transient table remains empty. It does not print row content.

## Expected post-promotion behavior

- Existing API users and UUIDs are preserved.
- Existing Argon2 password hashes are preserved; password-capable users use the same password.
- Existing login/refresh sessions are intentionally invalidated by omission; users sign in again.
- Users with no API password still use set-password after real email delivery is enabled.
- Active invites are not copied; create new target invites after promotion.
- Events, occurrences, options, registrations, questionnaire answers, seating, and legal evidence keep their relationships through preserved UUIDs.
- Prayer tracker data remains private backend data and is never exposed in admin by this procedure.
- Device/push state starts clean; production push is enabled only through its separately reviewed deployment path.
- Pending public-web verification flows do not cross environments; new flows start against the target.

## Manual smoke

Not run by the agent. Manual smoke is performed by the project owner.

After the later admin/public-web deployment and email/storage configuration, manually verify at minimum:

- an existing password-capable admin can sign in with the same password;
- member/profile counts are plausible without exposing prayer data;
- existing events and registrations appear with correct relationships;
- seating loads for events that have seating data;
- public event slugs resolve;
- a new public-web registration completes using a newly sent target email code;
- new invites generated in the target work;
- avatar/event images resolve only after their target S3 objects are present.

## Rollback boundary

Promotion never authorizes destructive rollback. If apply fails, the transaction rolls back automatically. If a later application problem appears after a successful apply, stop expansion and follow the data-preserving rollback/restore rules in `docs/infra/api-production-deploy.md` and `docs/infra/postgres-backup-restore.md`. Do not run `alembic downgrade`, truncate tables, delete the target volume, or restore over the target merely because an application artifact is rolled back.
