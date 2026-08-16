# API PostgreSQL data promotion

## Purpose

This owner-run runbook promotes durable product data from one **Sredi Svoih FastAPI/PostgreSQL** environment to another environment on the **same Alembic head**. It is intended for the first controlled population of an empty API PostgreSQL target, including the Selectel test/production-like contour.

The implementation is `scripts/migration/promote_api_data.py`.

This is not a Supabase migration path. It does not read Supabase, `auth.users`, a service-role key, frontend env, or any client credential.

## Durable data that is preserved

The promotion keeps primary UUIDs and the reviewed durable graph, including:

- `app_users`, including existing Argon2 `password_hash` values;
- profiles, communities, memberships, contact visibility, synced contacts;
- events, public slugs, occurrences, participation options, capacity, registrations, questionnaire definitions/answers, and legal acceptance evidence;
- seating layouts/tables/connections/assignments;
- prayer activity logs as private backend data;
- admin feedback/audit and event import history;
- avatar and event-image **database metadata**.

Users with an existing API password keep that password. The stored Argon2 password hash is portable between API environments and is not recalculated by the promotion utility.

## State that is intentionally not promoted

Environment-bound or in-flight state is excluded:

- auth sessions and one-time verification/reset/set-password codes;
- invite-code hashes, because they depend on `API_TOKEN_HASH_SECRET` and must be reissued in the target;
- public-web registration intents/codes/identity-conflict workflow state;
- privacy-access sessions/codes and secret-bound erasure evidence/workflow state;
- device tokens and push job/delivery state.

Existing sessions therefore do not survive promotion; users sign in again. Users whose `password_hash` is null still use the normal set-password flow after real email delivery is enabled.

The script never logs row values or database URLs. Console output is limited to safe table names, counts, checksums, status, and redacted failure categories.

## Fail-closed guarantees

Promotion is refused when any of these conditions is true:

- source or target Alembic head differs from the script's reviewed head;
- a public application table is new, missing, or not explicitly classified as promoted/excluded;
- a promoted table's columns, types, primary key, or foreign-key dependency metadata differ between artifact and target;
- the artifact has missing, changed, undeclared, malformed, symlinked, or duplicate-primary-key data;
- the target contains rows in any promotion-managed table;
- the source has an active deletion lifecycle;
- the source has an unexpired email-verification-required public-web registration intent;
- the source has queued/processing push jobs;
- active invites exist without explicit owner acknowledgement that they will be reissued;
- excluded privacy workflow/evidence rows exist without a separate owner acknowledgement appropriate only to an owner-approved temporary test/staging promotion;
- avatar/event-image metadata exists but the owner has not confirmed the corresponding required objects were copied and verified under the same object keys.

Apply uses one serializable transaction. It never truncates, deletes, updates, disables foreign keys, or changes schema. Any insert or exact post-insert verification failure rolls the complete transaction back.

## Object-storage boundary

Database promotion does **not** copy object bytes. `profile_avatars` and `event_images` metadata can be promoted only after the objects that should exist for their current lifecycle state have been copied to the reviewed target object storage with the same `object_key` values and verified there.

Do not use `--ack-object-storage-ready` as a bypass. It means the required object copy has actually been completed and checked. S3 provider, credentials, bucket names, and endpoints remain deployment decisions and must not be embedded in this script or repository.

## Prerequisites

Before any owner run:

1. Source and target are on the exact Alembic head expected by the checked-out promotion script.
2. Source is the reviewed current API PostgreSQL data set, not Supabase.
3. Target has the API schema but no rows in promotion-managed tables.
4. Database URLs stay only in owner-controlled environment or backend container environment. Never paste them into Git, chat, tickets, command arguments, or frontend config.
5. The artifact directory is protected and outside the repository. Artifacts contain personal data and must never be committed or shared.
6. Before `apply`, a current target logical backup has passed the disposable restore test in `docs/infra/postgres-backup-restore.md`.
7. Source writes are stopped for the final export window, or the owner accepts that writes after the snapshot are not in the artifact.
8. **Target application writes are stopped before final preflight and remain stopped through apply and validation.** Do not allow admin, public-web, mobile, worker, or other application writes to race the empty-target gate.

The script produces one repeatable-read source snapshot. It is not replication or change-data-capture.

## Local API export on Windows

These examples use the canonical local API Compose contour. `api_postgres` must already be healthy. The utility runs through the API image so host Python packages are not required.

Create a protected directory outside the repository:

```powershell
$promotionDir = "F:\2026\SS-App\private\api-promotion-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $promotionDir | Out-Null
```

After this PR is merged and local `main` is synchronized, build the current API image and export:

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

If active invites exist, export reports only their count and stops. After reviewing that they will be reissued in the target, rerun with:

```text
--ack-reissue-active-invites
```

If excluded privacy workflow/evidence rows exist, do not bypass the stop for a final production cutover. For an owner-approved temporary test/staging promotion only, after explicitly accepting that those environment-bound rows are not being promoted, the additional switch is:

```text
--ack-excluded-privacy-history
```

A successful export contains only:

```text
<promotion-dir>/
  manifest.json
  checksums.sha256
  tables/*.jsonl
```

Do not open, print, attach, or paste JSONL contents.

## Artifact verification and transfer

The script re-verifies every checksum before target preflight/apply. For owner inventory, hashes can also be computed without opening row files:

```powershell
Get-FileHash -Algorithm SHA256 "$promotionDir\manifest.json"
Get-ChildItem "$promotionDir\tables\*.jsonl" | Get-FileHash -Algorithm SHA256
```

Transfer the complete protected directory to an owner-controlled protected path on the Selectel host using the approved SSH/SCP path. Do not put it under the Git checkout or in a public bucket. Restrict host permissions to the deploy owner before use.

## Write-free target gate

Before final preflight/apply:

- do not expose admin/public-web/mobile clients to the target;
- keep push and privacy workers stopped;
- stop the normal FastAPI application service if there is any possibility of writes;
- keep PostgreSQL running privately because the one-off promotion container needs it;
- Nginx may temporarily return an unavailable response during this maintenance window.

The one-off `docker compose run ... api_backend` command below can connect to the private database even when the normal `api_backend` service is stopped.

## Target preflight on Selectel

Run through the production Compose API service so `DATABASE_URL` comes from the ignored backend production env file instead of shell history. Mount the artifact read-only:

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

Preflight is read-only. It checks exact schema/head compatibility and requires every promotion-managed target table to be empty.

If the artifact reports avatar/event-image metadata, do not proceed until the target S3 copy is complete. After object copy and verification, rerun preflight with:

```text
--ack-object-storage-ready
```

## Mandatory backup gate

Immediately before apply:

1. follow `docs/infra/postgres-backup-restore.md` for the current target;
2. create a custom-format logical backup;
3. verify checksum/list structure;
4. restore it into a separate disposable verification database;
5. record successful restore evidence.

A disk snapshot alone does not replace this gate. Do not apply when the latest target backup has not passed its restore test.

## Apply

Apply is a separate explicit owner action. Keep normal target application/worker writes stopped for the entire operation.

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

The target is checked again for emptiness inside the serializable transaction. Durable tables are inserted in foreign-key dependency order. Before commit, every target table is re-read in primary-key order and must match the artifact's exact row count and SHA-256 stream checksum. Excluded transient tables must remain empty.

Any failure exits non-zero and rolls the complete transaction back.

## Read-only post-apply validation

Keep target application/worker writes stopped until this succeeds:

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

Expected final line:

```text
validation_ok tables=<reviewed-table-count>
```

Only after successful validation may the owner restart the normal API and later enable clients/workers according to their separate deployment gates.

## Expected behavior after promotion

- Existing API users and UUIDs are preserved.
- Existing Argon2 password hashes are preserved; password-capable users use the same password.
- Login/refresh sessions are intentionally not promoted; users sign in again.
- Users with no API password still use set-password after real email delivery is enabled.
- Active invites are not copied; create new target invites after promotion.
- Events, occurrences, options, registrations, questionnaire answers, seating, and legal evidence retain relationships through preserved UUIDs.
- Prayer tracker data remains private backend data and is never exposed in admin by this procedure.
- Device/push state starts clean.
- Pending public-web verification flows do not cross environments.

## Manual smoke

Not run by the agent. Manual smoke is performed by the project owner.

After the later admin/public-web/email/storage deployment, manually verify at minimum:

- an existing password-capable admin can sign in with the same password;
- member/profile counts are plausible without exposing prayer data;
- existing events and registrations appear with correct relationships;
- seating loads for events that have seating data;
- public event slugs resolve;
- a new public-web registration completes using a newly sent target email code;
- new invites generated in the target work;
- avatar/event images resolve only after target S3 objects are present.

## Rollback boundary

Promotion never authorizes destructive rollback. If apply fails, its transaction rolls back automatically. If a later application problem appears after successful apply, stop expansion and follow the data-preserving rollback/restore rules in `docs/infra/api-production-deploy.md` and `docs/infra/postgres-backup-restore.md`.

Do not run `alembic downgrade`, truncate tables, delete the target volume, or restore over the target merely because an application artifact is rolled back.
