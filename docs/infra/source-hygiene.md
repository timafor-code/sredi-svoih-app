# API source-data hygiene audit

## Purpose

Before production data promotion resumes, audit the working local FastAPI/PostgreSQL source for historical synthetic test contamination and live workflow state.

Implementation:

- `scripts/migration/audit_api_source_hygiene.py`
- `scripts/migration/tests/test_audit_api_source_hygiene.py`

This audit is intentionally read-only and aggregate-only. It does not delete, update, insert, truncate, migrate, or rewrite database rows.

## Safety boundary

The audit:

- validates the same Alembic head and public-table classification used by `promote_api_data.py`;
- audits every table in `PROMOTED_TABLES`;
- separately audits the four privacy workflow/evidence tables that are excluded from environment promotion;
- reports only table names, aggregate row counts, static signature labels, and aggregate live-state counts;
- never emits email addresses, phone numbers, names, UUIDs, messages, prayer rows, questionnaire answers, object keys, password hashes, tokens, or other database row values;
- runs inside a repeatable-read, read-only PostgreSQL transaction;
- never authorizes automatic cleanup.

`prayer_activity_logs` is treated only as a backend aggregate count/signature scan. No prayer activity row or value is returned.

## High-confidence direct signatures

Direct synthetic classification is deliberately narrow and deterministic. The current reviewed sentinels are:

- reserved `.invalid` test email/domain values;
- values beginning with the repository test label `Synthetic `;
- values containing the repository test token `synthetic-`;
- the two known leaked privacy-request fixture messages from `test_privacy_self_service_access.py`.

Signature hit counts can overlap. `direct_synthetic_rows` is a deduplicated row count using the union of those signatures.

Rows without a direct sentinel are reported as `unclassified_rows`. They may be real product data or indirectly related synthetic graph rows. They are never automatic cleanup candidates.

## Privacy history

The audit separately counts:

- `privacy_destruction_evidence`;
- `privacy_erasure_notification_outbox`;
- `privacy_requests`;
- `privacy_retained_financial_evidence`.

Any row in these tables keeps the audit verdict at `review_required` because this state is excluded from the current environment-promotion contract and requires an explicit continuity/cleanup decision.

## Live promotion blockers

The audit also reports aggregate counts for:

- users with an active deletion lifecycle;
- unexpired web-registration email-verification intents;
- active invites;
- queued/processing push jobs.

These are the same classes of source state that must be resolved or explicitly handled before production promotion.

## Exit codes

- `0` — no direct hygiene blockers were detected by this audit;
- `1` — operational/configuration/schema failure;
- `2` — review is required.

Exit code `2` is expected while known historical test contamination or excluded privacy-history state is still present. It is not permission to delete anything.

## Focused verification

Run the unit tests without connecting them to the working local database:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app

docker compose -f infra/docker-compose.api.yml run --rm --no-deps `
  -v "${PWD}/scripts/migration:/app/scripts/migration:ro" `
  api_backend `
  python /app/scripts/migration/tests/test_audit_api_source_hygiene.py

npm run typecheck
git diff --check origin/main...HEAD
```

Smoke tests are not run. Browser smoke and Expo/iPhone smoke are performed manually by the project owner.

## Owner-run read-only audit of the working local source

The working `api_postgres` / `sredi_api` database is intentionally the audit target. This is not an automated test run; it is an owner-run read-only inspection before migration.

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app

$env:API_PROMOTION_PG_URI = "postgresql://sredi_api:sredi_api@api_postgres:5432/sredi_api"

docker compose -f infra/docker-compose.api.yml run --rm --no-deps `
  -e API_PROMOTION_PG_URI `
  -v "${PWD}/scripts/migration:/app/scripts/migration:ro" `
  api_backend `
  python /app/scripts/migration/audit_api_source_hygiene.py --json

Remove-Item Env:API_PROMOTION_PG_URI
```

The JSON output is safe to review because it contains aggregates only. Do not replace this tool with ad-hoc SQL that prints rows or PII.

## Interpretation

A `review_required` result means one or more of these are true:

- a promoted table contains a direct high-confidence synthetic sentinel;
- excluded privacy-history rows exist;
- live promotion-blocking workflow state exists.

Do not infer that every `unclassified_row` is real, and do not infer that it is synthetic. The audit intentionally refuses that classification without stronger evidence.

## Next step after audit

1. Save/review only the aggregate report.
2. Classify every detected high-confidence signature and any remaining uncertain graph relationship.
3. Create a fresh source backup before any cleanup.
4. Define cleanup as a separate owner-reviewed procedure/PR with deterministic targets and a dry run.
5. Perform no destructive action until the project owner gives a separate explicit approval.
6. Re-run this read-only audit after cleanup.
7. Resume `docs/infra/data-promotion.md` only after the source is reviewed and promotion guards are satisfied.

This PR does not perform cleanup and does not change the production promotion artifact/apply implementation.
