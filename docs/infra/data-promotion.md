# API PostgreSQL data promotion

## Purpose

This owner-run runbook promotes durable product data from one **Sredi Svoih FastAPI/PostgreSQL** environment to another environment on the **same Alembic head**. It is intended for the first controlled population of an empty API PostgreSQL target, including the Selectel test/production-like contour.

Implementation: `scripts/migration/promote_api_data.py`.

This path does not read Supabase, `auth.users`, a service-role key, frontend env, or any client credential.

## Durable data preserved

The promotion preserves primary UUIDs and the reviewed durable graph, including:

- `app_users`, including existing Argon2 `password_hash` values;
- profiles, communities, memberships, contact visibility, and synced contacts;
- events, public slugs, occurrences, participation options, capacity, registrations, questionnaire definitions/answers, and legal acceptance evidence;
- seating layouts/tables/connections/assignments;
- prayer activity logs as private backend data;
- admin feedback/audit and event import history;
- avatar and event-image database metadata.

Existing API password hashes are copied unchanged. Existing sessions are not copied.

## State intentionally excluded

Environment-bound or in-flight state is excluded:

- auth sessions and one-time verification/reset/set-password codes;
- invite-code hashes, because they depend on `API_TOKEN_HASH_SECRET` and must be reissued in the target;
- public-web registration intents/codes/identity-conflict workflow state;
- privacy-access sessions/codes and secret-bound erasure evidence/workflow state;
- device tokens and push job/delivery state.

Users with `password_hash = null` still require the normal set-password flow after real email delivery is enabled.

## Fail-closed guarantees

Promotion stops when any of these conditions is true:

- source or target Alembic head differs from the script's reviewed head;
- a public application table is new, missing, or not explicitly classified as promoted/excluded;
- promoted-table columns, types, primary keys, or foreign-key dependency metadata differ between artifact and target;
- the artifact has missing, changed, undeclared, malformed, symlinked, or duplicate-primary-key data;
- the target contains rows in a promotion-managed table;
- the source has an active deletion lifecycle;
- the source has an unexpired public-web email-verification intent;
- the source has queued/processing push jobs;
- active invites exist without explicit owner acknowledgement that they will be reissued;
- excluded privacy workflow/evidence rows exist without the explicit test/staging-only acknowledgement;
- avatar/event-image metadata exists without explicit acknowledgement that required objects were copied and verified under the same object keys.

Apply runs in one serializable transaction. It does not truncate, delete, update, disable foreign keys, or change schema. Any insert or exact verification failure rolls back the complete transaction.

## Object-storage boundary

Database promotion does **not** copy object bytes. `profile_avatars` and `event_images` metadata may be promoted only after the required objects are copied to the reviewed target object storage with identical `object_key` values and verified there.

Do not use `--ack-object-storage-ready` as a bypass. It means the required object copy has actually been completed and checked.

## Dedicated PostgreSQL secret

The utility reads its PostgreSQL connection only from:

```text
API_PROMOTION_PG_URI
```

There is no fallback to frontend configuration, dotenv discovery, or a hard-coded endpoint. Keep the value backend-only and never print it.

For a production one-off run, add `API_PROMOTION_PG_URI` temporarily to the ignored, permission-restricted server file `infra/env/.env.api.production`. Remove it after post-apply validation.

## Important Docker path rule

The utility contains a repository-root safeguard for export paths. When bind-mounting it into a container, preserve the repository-relative `scripts/migration` path.

Use `/app/scripts/migration`. Do **not** flatten the directory to `/migration`.

## Prerequisites

Before any owner run:

1. Source and target are on the exact Alembic head expected by the checked-out promotion script.
2. Source is the reviewed current API PostgreSQL data set.
3. Target has the API schema but no rows in promotion-managed tables.
4. Connection values stay only in owner-controlled environment or backend container environment.
5. The artifact directory is protected and outside the repository. Artifacts contain personal data and must never be committed or shared.
6. Before `apply`, a current target logical backup has passed the disposable restore test in `docs/infra/postgres-backup-restore.md`.
7. Source writes are stopped for the final export window, or the owner accepts that writes after the snapshot are not in the artifact.
8. Target application writes are stopped before final preflight and remain stopped through apply and validation.

The script produces one repeatable-read source snapshot. It is not replication or change-data-capture.

## Focused verification before merge

This is not browser/Expo smoke. Run through the existing API image; no rebuild is required when only the bind-mount path changes:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app

git fetch origin
git switch feature/api-production-data-promotion
git pull --ff-only origin feature/api-production-data-promotion

docker compose -f infra/docker-compose.api.yml run --rm --no-deps `
  -v "${PWD}/scripts/migration:/app/scripts/migration:ro" `
  api_backend `
  python /app/scripts/migration/tests/test_promote_api_data.py

npm run typecheck
git diff --check origin/main...HEAD

git diff --name-only origin/main...HEAD | ForEach-Object {
  Select-String -Path $_ `
    -Pattern ("service_role|sb_secret|SUPABASE_SERVICE|DATA" + "BASE_URL") `
    -SimpleMatch:$false `
    -ErrorAction SilentlyContinue
}
```

Expected: focused tests end with `OK`; typecheck succeeds; `git diff --check` and the forbidden scan print nothing.

Smoke tests are not run by the agent.

## Local API export on Windows

`api_postgres` must already be healthy. Create a protected directory outside the repository:

```powershell
$promotionDir = "F:\2026\SS-App\private\api-promotion-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $promotionDir | Out-Null
```

Build the current API image if required, then export:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app

docker compose -f infra/docker-compose.api.yml build api_backend

$env:API_PROMOTION_PG_URI = "postgresql://sredi_api:sredi_api@api_postgres:5432/sredi_api"
$env:API_PROMOTION_RUN_ACK = "OWNER_APPROVED_API_PROMOTION_EXPORT"

docker compose -f infra/docker-compose.api.yml run --rm --no-deps `
  -e API_PROMOTION_PG_URI `
  -e API_PROMOTION_RUN_ACK `
  -v "${PWD}/scripts/migration:/app/scripts/migration:ro" `
  -v "${promotionDir}:/promotion" `
  api_backend `
  python /app/scripts/migration/promote_api_data.py export --output-dir /promotion

Remove-Item Env:API_PROMOTION_PG_URI
Remove-Item Env:API_PROMOTION_RUN_ACK
```

If active invites exist, review reissue and rerun with `--ack-reissue-active-invites`.

If excluded privacy workflow/evidence rows exist, do not bypass the stop for a final production cutover. The `--ack-excluded-privacy-history` switch is only for an explicitly approved temporary test/staging promotion.

Successful export layout:

```text
<promotion-dir>/
  manifest.json
  checksums.sha256
  tables/*.jsonl
```

Do not open, print, attach, or paste JSONL contents.

## Artifact transfer

Transfer the complete protected directory to an owner-controlled protected path on Selectel through the approved SSH/SCP path. Do not put it under the Git checkout or in a public bucket.

## Write-free target gate

Before final preflight/apply:

- do not expose admin/public-web/mobile clients to the target;
- keep push and privacy workers stopped;
- stop the normal FastAPI service if writes are possible;
- keep PostgreSQL running privately because the one-off promotion container needs it.

## Target preflight on Selectel

Add temporary `API_PROMOTION_PG_URI` to the ignored backend env file, then run:

```bash
cd /opt/sredi-svoih

sudo docker compose \
  --env-file infra/env/.env.compose.production \
  -f infra/docker-compose.prod.yml \
  run --rm --no-deps \
  -v /opt/sredi-svoih/scripts/migration:/app/scripts/migration:ro \
  -v <protected-promotion-dir>:/promotion:ro \
  api_backend \
  python /app/scripts/migration/promote_api_data.py preflight --input-dir /promotion
```

Preflight is read-only and requires every promotion-managed target table to be empty.

If avatar/event-image metadata exists, copy and verify the target objects first, then rerun preflight with `--ack-object-storage-ready`.

## Mandatory backup gate

Immediately before apply:

1. follow `docs/infra/postgres-backup-restore.md`;
2. create a current custom-format logical backup;
3. verify checksum/list structure;
4. restore it into a separate disposable verification database;
5. record successful restore evidence.

A disk snapshot alone does not replace this gate.

## Apply

Keep normal target application/worker writes stopped:

```bash
cd /opt/sredi-svoih
export API_PROMOTION_RUN_ACK='OWNER_APPROVED_API_PROMOTION_APPLY'

sudo -E docker compose \
  --env-file infra/env/.env.compose.production \
  -f infra/docker-compose.prod.yml \
  run --rm --no-deps \
  -e API_PROMOTION_RUN_ACK \
  -v /opt/sredi-svoih/scripts/migration:/app/scripts/migration:ro \
  -v <protected-promotion-dir>:/promotion:ro \
  api_backend \
  python /app/scripts/migration/promote_api_data.py apply \
    --input-dir /promotion \
    --allow-production-target-with-owner-command \
    <add --ack-object-storage-ready only when required and actually complete>

unset API_PROMOTION_RUN_ACK
```

The target is checked again for emptiness inside the serializable transaction. Durable tables are inserted in foreign-key dependency order and re-read for exact count/checksum verification. Any failure rolls the complete transaction back.

## Read-only post-apply validation

Keep target writes stopped until this succeeds:

```bash
cd /opt/sredi-svoih

sudo docker compose \
  --env-file infra/env/.env.compose.production \
  -f infra/docker-compose.prod.yml \
  run --rm --no-deps \
  -v /opt/sredi-svoih/scripts/migration:/app/scripts/migration:ro \
  -v <protected-promotion-dir>:/promotion:ro \
  api_backend \
  python /app/scripts/migration/promote_api_data.py validate --input-dir /promotion
```

Expected final line:

```text
validation_ok tables=<reviewed-table-count>
```

Remove temporary `API_PROMOTION_PG_URI` after successful validation. Only then restart normal API/client/worker traffic according to separate deployment gates.

## Expected behavior after promotion

- Existing API users and UUIDs are preserved.
- Existing Argon2 password hashes are preserved.
- Login/refresh sessions are intentionally not promoted; users sign in again.
- Users with no API password use set-password after real email delivery is enabled.
- Active invites are not copied; create new target invites after promotion.
- Events, registrations, questionnaire answers, seating, and legal evidence retain relationships through preserved UUIDs.
- Prayer tracker data remains private backend data and is never exposed in admin by this procedure.
- Device/push state starts clean.
- Pending public-web verification flows do not cross environments.

## Manual smoke

Not run by the agent. Manual smoke is performed by the project owner.

After later admin/public-web/email/storage deployment, manually verify existing admin login, members/profiles, events/registrations, seating, public slugs, new email-code registration, newly issued target invites, and media after S3 objects are present.

## Rollback boundary

Promotion never authorizes destructive rollback. If apply fails, its transaction rolls back automatically. For later application problems, follow `docs/infra/api-production-deploy.md` and `docs/infra/postgres-backup-restore.md`.

Do not run `alembic downgrade`, truncate tables, delete the target volume, or restore over the target merely because an application artifact is rolled back.
