# Local API source cleanup before production promotion

## Purpose

This owner-run procedure prepares the working local FastAPI/PostgreSQL database for one-time production promotion after the read-only hygiene audit.

Implementation:

- `scripts/migration/cleanup_api_source_hygiene.py`
- `scripts/migration/tests/test_cleanup_api_source_hygiene.py`

The cleanup utility is intentionally local-only, dry-run-first, aggregate-only in its output, and fail-closed. It does not authorize production promotion.

## Safety contract

The utility accepts only this exact local Docker target shape:

```text
host: api_postgres
port: 5432
database: sredi_api
user: sredi_api
API environment: APP_ENV=local
```

Remote hosts, `localhost`/`127.0.0.1` tunnel targets, other database names, other users, non-default ports, URI query parameters, and production targets are rejected before mutation. The connection must use the fixed local Docker development credential from `infra/env/api.env.example`; the password is not printed in reports.

The process must have `APP_ENV=local`. A missing, staging, or production `APP_ENV` is rejected before the database connection is opened. This is a separate safety gate because production Compose intentionally uses the same `api_postgres` service name.

The utility reuses the production-promotion schema guard and therefore requires the reviewed Alembic head and full public-table classification to match `promote_api_data.py`.

Current reviewed head:

```text
20260816184500
```

The cleanup now has an additional hard stop: if any `app_users` row still has `status='deletion_pending'` or a non-null `deletion_requested_at`, cleanup refuses to start before any DELETE statement is executed. Resolve those users through the canonical privacy-erasure worker first.

It never:

- runs `db reset`;
- truncates the database;
- blanket-deletes `app_users`, `events`, or `legal_documents`;
- prints row values, UUIDs, names, email addresses, phone numbers, prayer rows, questionnaire answers, password hashes, tokens, codes, or secrets;
- connects to production;
- creates a production promotion artifact.

## What the cleanup targets

### Environment-bound/transient tables

Every table already classified in `promote_api_data.py` as `EXCLUDED_TABLES` is cleared as local environment-bound state only after the active-deletion lifecycle guard passes. This includes auth/session/code, invite, web-registration intent/code/conflict, device-token, push queue/delivery, privacy-access, and privacy workflow/evidence state.

`privacy_financial_review_evidence` is included in this excluded state because its pseudonymous subject hash is bound to deployment secrets and must not be promoted between environments.

### Deterministic synthetic durable roots

Durable deletion is limited to direct high-confidence signature matches in these reviewed root tables:

```text
app_users
events
event_registrations
communities
```

The signatures are exactly the deterministic sentinels already reviewed by the read-only hygiene audit:

- reserved `.invalid` test email/domain values;
- `Synthetic ` prefix;
- `synthetic-` token.

There is no fuzzy classification and no deletion of unclassified rows. Existing foreign-key behavior may remove dependent rows of a directly matched synthetic root. The dry run reports aggregate before/after table counts so that this effect is visible before any commit is authorized.

### Leaked synthetic legal documents

The known leaked synthetic `legal_documents` fixtures are also eligible only by those same deterministic signatures. They are not blanket-deleted.

They are deliberately deleted **after** synthetic user/event roots. `legal_acceptances.legal_document_id` uses `ON DELETE RESTRICT`, so this order ensures synthetic acceptances disappear through the existing user cascade before their synthetic legal document is removed. A remaining real acceptance therefore continues to protect its legal document from deletion.

## Dry-run behavior

Dry run is the default.

The utility first snapshots aggregate state and checks the active deletion lifecycle count. If that count is non-zero, the command fails closed and executes no cleanup DELETE statements.

When the lifecycle count is zero, the utility executes the exact cleanup plan inside one PostgreSQL transaction, collects aggregate before/after counts and the hygiene verdict, then rolls the entire transaction back.

Therefore the dry run validates actual foreign-key behavior without persisting changes. If any statement fails, the transaction is rolled back and the command fails closed. The report contains counts only.

## Mandatory backup gate before apply

Do not run `--apply` until a fresh logical backup of the working local source has been created and successfully restored into a disposable database. A backup is not valid merely because `pg_dump` returned success; the restore must succeed.

The restored Alembic head must be:

```text
20260816184500
```

Keep the backup artifact outside the repository. Do not commit it.

## Owner-run dry run

The working `api_postgres` service must already be running and the canonical privacy-erasure worker must have reduced the active deletion lifecycle aggregate to zero.

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app

$env:API_PROMOTION_PG_URI = "postgresql://sredi_api:sredi_api@api_postgres:5432/sredi_api"

docker compose -f infra/docker-compose.api.yml run --rm --no-deps `
  -e API_PROMOTION_PG_URI `
  -v "${PWD}/scripts/migration:/app/scripts/migration:ro" `
  api_backend `
  python /app/scripts/migration/cleanup_api_source_hygiene.py --json

Remove-Item Env:API_PROMOTION_PG_URI
```

Review at minimum:

- target is `local_docker_api_postgres/sredi_api`;
- mode is `dry_run_rollback`;
- `cleanup_performed` is `false`;
- active deletion lifecycle users are zero;
- transient-table deletion counts are expected;
- deterministic synthetic-root counts are expected;
- synthetic `legal_documents` candidate/deletion count is expected;
- promoted table before/after counts do not imply removal of owner-required users/events/registrations;
- no row values or identifiers appear in the report.

**Stop after the dry run.** Do not run apply until the project owner separately approves that exact dry-run result and confirms a fresh backup restore made after the current database state was finalized.

## Apply gate

Apply has three independent gates:

1. `--apply`;
2. both owner flags:
   - `--ack-dry-run-reviewed`;
   - `--ack-backup-restored`;
3. exact environment acknowledgement:

```text
API_LOCAL_CLEANUP_ACK=OWNER_APPROVED_LOCAL_DATA_CLEANUP_APPLY
```

If any gate is missing, the utility refuses to mutate.

After separate owner approval, the command shape is:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app

$env:API_PROMOTION_PG_URI = "postgresql://sredi_api:sredi_api@api_postgres:5432/sredi_api"
$env:API_LOCAL_CLEANUP_ACK = "OWNER_APPROVED_LOCAL_DATA_CLEANUP_APPLY"

docker compose -f infra/docker-compose.api.yml run --rm --no-deps `
  -e API_PROMOTION_PG_URI `
  -e API_LOCAL_CLEANUP_ACK `
  -v "${PWD}/scripts/migration:/app/scripts/migration:ro" `
  api_backend `
  python /app/scripts/migration/cleanup_api_source_hygiene.py `
    --apply `
    --ack-dry-run-reviewed `
    --ack-backup-restored `
    --json

Remove-Item Env:API_PROMOTION_PG_URI
Remove-Item Env:API_LOCAL_CLEANUP_ACK
```

The cleanup runs in one serializable transaction. Any failure before commit rolls the transaction back.

## Mandatory post-apply audit

Immediately after a successful apply, rerun the read-only hygiene audit. Do not proceed to production promotion until the post-cleanup aggregate report has been reviewed and explicitly accepted by the project owner.

A remaining `review_required` result is not permission to broaden cleanup. It means the remaining state needs another explicit classification decision.

## Focused automated checks for this PR

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app

python scripts/migration/tests/test_promote_api_data.py
python scripts/migration/tests/test_audit_api_source_hygiene.py
python scripts/migration/tests/test_cleanup_api_source_hygiene.py

npm run typecheck
git diff --check origin/main...HEAD
```

Run the project forbidden scan before commit. Smoke tests are not run by the agent. Browser smoke and Expo/iPhone smoke are performed manually by the project owner.

## Exit gate

This cleanup stage is complete when:

- the guarded utility and focused tests are merged;
- the local database is migrated to `20260816184500`;
- the canonical privacy-erasure worker reduces active deletion lifecycle users to zero;
- the owner creates and restore-tests a fresh local source backup;
- the owner runs and reviews cleanup dry-run output;
- the owner separately authorizes apply;
- apply completes transactionally;
- the read-only hygiene audit is rerun;
- the resulting aggregate state is explicitly accepted for production promotion.

Only then continue with a new timestamped artifact using `scripts/migration/promote_api_data.py`.
