# Controlled Supabase data export

`export_supabase_data.mjs` is an owner-run utility for producing local migration artifacts from the existing Supabase PostgreSQL data. It is the export half of Phase 7 PR 34. PR 35 will add the separate API PostgreSQL importer and import validation; this utility does not import, validate against the API database, upload, delete, or otherwise mutate source data.

No export was run while this tooling was created.

## Safety boundary

The utility is fail-closed. It reads a connection string only from the owner-local `SUPABASE_EXPORT_DATABASE_URL` environment variable and does not load `.env`, `.env.local`, or any default URL. It requires this separate acknowledgement:

```text
SUPABASE_EXPORT_RUN_ACK=LOCAL_OR_OWNER_APPROVED_EXPORT
```

It uses a repeatable-read, read-only PostgreSQL transaction. It does not print records or raw values. Console output is limited to progress, table names, row counts, checksums, warnings, and the output path.

The utility treats any connection that is not clearly local (`localhost`, loopback, `host.docker.internal`, or a `.local` hostname) as hosted. Such a run additionally requires the explicit `--allow-hosted-with-owner-command` switch. This is an owner approval boundary, not a convenience flag. Do not use it without a separately authorized owner command.

`--help` needs no database connection:

```powershell
node scripts/migration/export_supabase_data.mjs --help
```

## Prerequisites and safe command shape

- Run from a checkout with the root dependencies installed; the script uses the repository's existing Node `pg` package.
- Choose an owner-controlled output directory outside this repository.
- Supply credentials only through the process environment. Do not paste them into commands, documentation, chats, issues, or PRs.
- Confirm the source and output location with the project owner before any hosted or production run.

Use placeholders only when preparing a command for another owner-controlled shell:

```powershell
$env:SUPABASE_EXPORT_DATABASE_URL = '<owner-local-postgresql-connection-url>'
$env:SUPABASE_EXPORT_RUN_ACK = 'LOCAL_OR_OWNER_APPROVED_EXPORT'
node scripts/migration/export_supabase_data.mjs --output-dir '<secure-owner-controlled-output-directory>'
```

The target must be empty. A non-empty target is refused unless `--overwrite` is supplied. Even then, the script replaces only a directory containing its prior `manifest.json`, `checksums.sha256`, `tables/`, and `storage/` artifacts; it refuses arbitrary contents and symbolic links.

The script refuses a repository-contained output path by default. `--allow-output-in-repository` is an intentional exception for a carefully reviewed local case only. Any artifact produced there is still private: never stage or commit it, and verify that it does not appear in `git status --short`.

## Export format

The selected output directory receives UTF-8, no-BOM artifacts:

```text
<output-directory>/
  manifest.json
  checksums.sha256
  tables/
    profiles.jsonl
    communities.jsonl
    ...
  storage/
    avatar_objects.jsonl
```

Each exported table is a JSON Lines file. Table order is fixed by the explicit allowlist, and records are ordered by the table's verified primary key. UUIDs remain strings; PostgreSQL timestamp values are serialized as stable ISO timestamps; JSON/JSONB stays structured JSON; null remains `null`; and byte/binary columns are refused instead of being dumped inline.

### Date and timestamp values

PostgreSQL `DATE` values are exported exactly as their source `YYYY-MM-DD` text, without any timezone conversion. This is independent of the operating-system timezone, the Node.js `TZ` setting, UTC offset, and daylight-saving time. PostgreSQL `timestamp` and `timestamptz` values remain separate values and continue to be serialized as ISO timestamps.

Do not use any export artifact created before this DATE-only fix: affected values may already have the wrong calendar day. Do not manually edit old JSONL files, `manifest.json`, or `checksums.sha256` to repair them. Instead, create a new owner-local export in a new directory after this fix so that it has a new `manifest.json` and `checksums.sha256`.

`manifest.json` includes the format version, creation timestamp, schema/table name, required/optional state, exported/skipped state, row count, verified primary-key order, artifact path, and SHA-256 checksum for every JSONL artifact. Missing optional feature tables are listed as `skipped` with a reason. Missing required core tables, a table without a primary key, or a binary column fail the export before it can report success.

`checksums.sha256` is a standard verification index for `manifest.json` and every JSONL artifact. It permits checksum verification without opening or sharing the personal-data files.

## Explicit table allowlist

The script does not enumerate `public` dynamically. It exports only the following ordered public tables:

```text
profiles
communities
community_memberships
invites
events
event_occurrences
event_categories
event_participation_options
event_participation_option_capacity_units
event_registration_option_selections
event_capacity_units
event_registrations
event_registration_capacity_reservations
event_seating_layout_templates
event_seating_layouts
event_seating_tables
event_seating_table_connections
event_seating_assignments
event_import_sources
event_import_runs
event_import_items
admin_feedback
device_tokens
prayer_activity_logs
profile_contact_visibility
community_contacts
synced_contacts
community_event_locations
push_notification_jobs
push_notification_deliveries
```

The required core tables are `profiles`, `communities`, `community_memberships`, `invites`, `events`, `event_registrations`, `community_contacts`, and `synced_contacts`. The remaining allowlisted feature tables are optional only to support a controlled export from an older source schema; on the current schema they are expected to be present. An absent optional table is recorded in the manifest rather than silently omitted.

The legacy/dead `user_settings` and `calendar_cache` tables are intentionally excluded. Payments and other non-allowlisted public tables are also excluded.

## Auth boundary

This exporter never reads or exports `auth.users`, `auth.identities`, sessions, password hashes, JWTs, refresh tokens, OAuth provider payloads, vault data, realtime data, or Supabase internal schemas. It has no service-role key handling.

Supabase Auth inventory/export is a separate owner-run migration concern under the controlled `scripts/migration/**` carve-out. Keep its artifacts separate from this public-data export and never place Auth data, keys, or tokens in mobile, web-admin, or frontend configuration.

## Avatar storage manifest

The only non-public-schema query is a tightly scoped `storage.objects` read for the verified `avatars` bucket. The output is `storage/avatar_objects.jsonl`; it does not download avatar files or export unrelated storage objects.

Each manifest row contains the bucket, object key, available owner metadata, available content type and size metadata, available timestamps, source metadata, and a `profile_id` only when the user-ID path prefix matches a public profile. The existing avatar convention is a user-owned `avatars/<profile-id>/...` object key. No Russia-hosted storage adapter is created here.

## Personal-data handling and validation

Artifacts can contain personal data. They must be stored only in an owner-controlled location and must never be committed, attached to PRs/issues, pasted into chats, or printed to console. This includes raw device tokens, contacts, registration comments, invite fields, feedback messages, and prayer tracker data. Prayer tracker data remains private: this backend migration utility may copy it into owner-controlled artifacts, but the admin UI must never read or show `prayer_activity_logs`.

After an authorized owner-run export:

1. Confirm the manifest lists every allowlisted table as exported or explicitly skipped.
2. Compare manifest row counts with owner-run source-table counts without printing records.
3. Verify `checksums.sha256` without opening or sharing data files.
4. Confirm the output is outside the repository, or that no artifacts appear in `git status --short` if the explicit repository override was used.
5. Keep the files encrypted or in another owner-controlled protected location until PR 35 uses them.
6. Securely delete temporary/test artifacts according to the storage provider and operating-system policy when they are no longer needed; do not rely on a Git cleanup.

The future importer must preserve the source authorization and privacy boundaries rather than treating these local artifacts as permission to broaden access.

## PR 35: API PostgreSQL import and validation

`import_to_api_postgres.py` and `validate_migration.py` are owner-run PR 35
utilities. They load only the controlled PR #324 artifact directory into the
Python API PostgreSQL schema, then compare aggregate results. They do not
contact Supabase, read `auth.users` or `auth.identities`, use Supabase Admin API
or a service-role key, or load `.env`, `.env.local`, API/admin/mobile/Expo/Vite
environment files.

No import or validation was run while this tooling was created.

### Prerequisites and connection boundary

- Use an owner-controlled PR #324 export directory. Never commit its artifacts.
- Run with the API Python environment, which provides the existing `asyncpg`
  dependency. The scripts do not import API settings, so they cannot use its
  development default connection string or dotenv behaviour.
- The API local Docker runtime is `infra/docker-compose.api.yml`: PostgreSQL is
  the `api_postgres` service and is normally bound to `127.0.0.1:55432`.

Set credentials only in the owner shell, with placeholders in shared commands:

```text
API_MIGRATION_DATABASE_URL=<owner-local-api-postgresql-url>
API_MIGRATION_RUN_ACK=LOCAL_OR_OWNER_APPROVED_IMPORT
```

There is no default database URL. This variable is intentionally distinct from
the PR #324 export variable. A connection is hosted unless it targets loopback,
`host.docker.internal`, or a `.local` hostname. A hosted target additionally
requires `--allow-hosted-with-owner-command` after a separate owner approval;
that flag is an approval boundary, not a convenience option.

Help never connects to PostgreSQL:

```powershell
python scripts/migration/import_to_api_postgres.py --help
python scripts/migration/validate_migration.py --help
```

### Input verification

The importer accepts one explicit `--input-dir` with this exact PR #324 layout:

```text
<export-directory>/
  manifest.json
  checksums.sha256
  tables/
    *.jsonl
  storage/
    avatar_objects.jsonl
```

Before target preflight or any write transaction, it requires format `1.0.0`,
verifies the manifest and every declared JSONL SHA-256, validates checksum-index
entries, and rejects changed/missing/undeclared artifacts, nested files,
symlinks, malformed JSONL, row-count mismatches, and duplicate public primary
keys. The avatar artifact has no exported storage primary-key value, so its
artifact identity is checked as `(bucket, object_key)`. Required PR #324 source
tables must be `exported`; optional tables may be explicitly `skipped` and are
reported as skipped, never treated as empty. Errors identify only domain, row,
field, and category—not JSONL values.

### Explicit mapping and order

This is an explicit mapping, not a dynamic same-name loader. These verified
compatible source domains preserve primary UUIDs where the API schema permits:

```text
communities -> communities                         profiles -> profiles
community_memberships -> community_memberships     invites -> invites
event_categories -> event_categories               community_event_locations -> community_event_locations
events -> events                                   event_occurrences -> event_occurrences
event_participation_options -> event_participation_options
event_capacity_units -> event_capacity_units       event_participation_option_capacity_units -> event_participation_option_capacity_units
event_registrations -> event_registrations         event_registration_option_selections -> event_registration_option_selections
event_registration_capacity_reservations -> event_registration_capacity_reservations
event_seating_layout_templates -> event_seating_layout_templates
event_seating_layouts -> event_seating_layouts     event_seating_tables -> event_seating_tables
event_seating_table_connections -> event_seating_table_connections
event_seating_assignments -> event_seating_assignments
community_contacts -> community_contacts           profile_contact_visibility -> profile_contact_visibility
synced_contacts -> synced_contacts                 admin_feedback -> admin_feedback
device_tokens -> device_tokens                     prayer_activity_logs -> prayer_activity_logs
push_notification_jobs -> push_notification_jobs   push_notification_deliveries -> push_notification_deliveries
event_import_sources -> event_import_sources       event_import_runs -> event_import_runs
event_import_items -> event_import_items
```

The source profile UUID becomes both API `profiles.id` and `profiles.user_id`.
The legacy `events.seats_total` is deliberately excluded because source
migrations backfilled compatible `events.capacity`. API-only nullable seating
fields use their verified defaults/nullability; no placeholders are invented.

The website-import schema has verified transformations: source `name` maps to
API `title`, `url` maps to `source_url`, and `parser_name` maps to API `key`
only if it satisfies the API key constraint. Parser information is retained as
legacy JSONB settings. A run's API `community_id` is derived from its source and
mode is the required `apply_review_only`; an item with null `run_id` fails
safely because the API requires that composite relationship.

`privacy_requests` is not part of PR #324's exporter allowlist and is reported
as `not_exported_by_pr324`; no privacy row is fabricated. Unknown source
columns, unsupported domains, invalid enum/check values, unresolved references,
or target schema mismatches fail closed. No Alembic migration is added.

The deterministic order is communities, identities, profiles, memberships and
invites, categories and locations, events, occurrences/options/capacity,
registrations/selections/reservations, contacts/visibility, feedback/device/
prayer, seating hierarchy, push jobs/deliveries, then import history. Foreign
keys stay enabled; the scripts never truncate, delete, disable constraints, use
`session_replication_role`, or replace source data.

### Identity bootstrap and Auth limitation

PR #324 has no Auth export. Candidate users are derived only from verified
public UUID references (profiles, memberships, invitations, events,
registrations, contacts, feedback, device tokens, prayer logs, seating, and
push records). Each UUID is preserved as `app_users.id`. Valid public profile
email/phone may be copied; invalid values are omitted and counted. Source and
target email/phone uniqueness conflicts and missing profiles are counted without
printing the values.

Every bootstrap identity has `password_hash = null`. The importer does not copy
password hashes, infer OAuth identities, create a password, or set verification
timestamps. Imported users require the separately planned set-password flow
before API authentication cutover.

### Dry run and apply

Choose exactly one mode; no default can write:

```powershell
$env:API_MIGRATION_DATABASE_URL = '<owner-local-api-postgresql-url>'
$env:API_MIGRATION_RUN_ACK = 'LOCAL_OR_OWNER_APPROVED_IMPORT'
python scripts/migration/import_to_api_postgres.py --input-dir '<owner-controlled-export-directory>' --dry-run
```

Dry run parses every artifact and validates UUIDs, JSON, date/timestamp,
integer, `Decimal`, enum/check, uniqueness, and required-reference contracts.
It performs schema and existing-data preflight in an explicit repeatable-read,
read-only transaction and commits no writes; this is not exception-dependent
rollback.

Only after dry-run review and backup creation, an owner may separately approve:

```powershell
$env:API_MIGRATION_DATABASE_URL = '<owner-local-api-postgresql-url>'
$env:API_MIGRATION_RUN_ACK = 'LOCAL_OR_OWNER_APPROVED_IMPORT'
python scripts/migration/import_to_api_postgres.py --input-dir '<owner-controlled-export-directory>' --apply
```

Apply uses one explicit transaction and rolls back the complete import on any
failure. By default any existing mapped target data is a conflict.
`--allow-existing-data` permits only primary-key-equal, value-compatible rows;
it never updates, replaces, deletes, or truncates data. Reports distinguish
inserts, unchanged compatible rows, skips, conflicts, and missing references;
automatic update count remains zero.

### Avatars, validation, and reports

PR #324's `storage/avatar_objects.jsonl` contains metadata only. PR 35 checks
object-key shape and profile linkage, then reports
`pending_storage_migration`. It does not download/upload objects, write an
object-storage provider, create active avatar metadata, or claim avatars are
migrated.

After an approved apply, validate aggregate results only:

```powershell
$env:API_MIGRATION_DATABASE_URL = '<owner-local-api-postgresql-url>'
$env:API_MIGRATION_RUN_ACK = 'LOCAL_OR_OWNER_APPROVED_IMPORT'
python scripts/migration/validate_migration.py --input-dir '<owner-controlled-export-directory>'
```

Validation uses a repeatable-read, read-only transaction. Exit code `0` means
supported checks passed; non-zero means failure or incomplete validation. It
checks mapped counts, expected target primary keys, duplicate keys,
profile/app-user and membership/app-user alignment, registration/event/
occurrence alignment, selections/reservations, seating hierarchy, contacts and
visibility, and aggregate prayer/device/contact, feedback, push, and pending
avatar counts. It never reads private prayer content, feedback messages, raw
device tokens, push payloads, contacts, or avatar metadata into a report.

Reports contain aggregate counts, domain/status data, and safe error categories.
They exclude names, emails, phones, addresses, comments, feedback/prayer text,
tokens, payloads, invite codes, JWTs, password data, and database URLs. By
default only an aggregate JSON summary is printed. To write a report, choose an
existing owner-controlled directory outside the repository:

```powershell
python scripts/migration/import_to_api_postgres.py --input-dir '<owner-controlled-export-directory>' --dry-run --report-dir '<owner-controlled-report-directory>'
python scripts/migration/validate_migration.py --input-dir '<owner-controlled-export-directory>' --report-dir '<owner-controlled-report-directory>'
```

Never commit reports or artifacts. Confirm with `git status --short` and
securely remove temporary owner-local exports/reports when no longer needed.

### Backup and rollback

Before apply, create and test an owner-controlled API PostgreSQL backup/snapshot.
The current local Docker runtime command shape, with placeholders only, is:

```powershell
docker compose -f infra/docker-compose.api.yml exec -T api_postgres pg_dump -U '<api-db-user>' -d '<api-db-name>' --format=custom > '<owner-controlled-backup-path>.dump'
```

Restoration is owner-controlled recovery, not an importer command. After
separately confirming backup and target, a local command shape is:

```powershell
Get-Content -LiteralPath '<owner-controlled-backup-path>.dump' -AsByteStream | docker compose -f infra/docker-compose.api.yml exec -T api_postgres pg_restore -U '<api-db-user>' -d '<api-db-name>' --clean --if-exists
```

Do not run either command from this PR without separate owner instruction.
Failed applies roll back automatically and dry runs write nothing. Successful
apply is intentionally not reversed by deleting rows: restore the approved
backup/snapshot instead. There is no destructive undo command.

## PR 36: live shadow read comparison

`compare_shadow_reads.py` is an owner-run, aggregate-only verification utility
for the last pre-cutover check. It compares live aggregate state in the existing
Supabase PostgreSQL source and the new API PostgreSQL target, using separate
repeatable-read, read-only transactions. It never imports, updates, deletes,
synchronizes, repairs, or backfills either database.

This is intentionally different from PR #325 validation: PR #325 compares the
controlled export snapshot with API PostgreSQL. PR 36 compares live source and
live target aggregate state shortly before provider cutover. It is not an
object-storage migration and it does not switch either mobile or admin
provider.

No shadow comparison was run while this PR was created.

### Required owner shell variables

Set only these explicit owner-local shell variables, using placeholders in
shared commands:

```text
SUPABASE_SHADOW_DATABASE_URL=<owner-local-supabase-postgresql-url>
API_SHADOW_DATABASE_URL=<owner-local-api-postgresql-url>
SHADOW_COMPARE_RUN_ACK=LOCAL_OR_OWNER_APPROVED_SHADOW_COMPARE
```

The script has no default database URL. It does not load `.env`, `.env.local`,
API, admin, mobile, Expo, or Vite environment files. `--help` never connects to
PostgreSQL.

For example, first run only against owner-controlled local or synthetic
databases:

```powershell
$env:SUPABASE_SHADOW_DATABASE_URL = '<owner-local-supabase-postgresql-url>'
$env:API_SHADOW_DATABASE_URL = '<owner-local-api-postgresql-url>'
$env:SHADOW_COMPARE_RUN_ACK = 'LOCAL_OR_OWNER_APPROVED_SHADOW_COMPARE'
python scripts/migration/compare_shadow_reads.py
```

A connection is hosted unless it is loopback, `host.docker.internal`, or a
`.local` hostname. Hosted source and target approvals are intentionally
independent owner-command boundaries:

```powershell
python scripts/migration/compare_shadow_reads.py --allow-hosted-source-with-owner-command
python scripts/migration/compare_shadow_reads.py --allow-hosted-target-with-owner-command
```

Use both flags only when the owner has separately approved both hosted
connections. Neither flag is enabled by default.

### Aggregates, reports, and exit codes

The comparison checks aggregate event, occurrence, registration, membership,
capacity-bucket, seating, Prayer Tracker, contacts/visibility, avatar,
device-token, and push-job state. IDs may be used only in memory to form
aggregate signatures; they are never printed or written into a report. Prayer
Tracker comparisons use only total counts and per-user row-count signatures;
the utility never selects or reports activity content, metadata, dates, or
user IDs.

The default output is one JSON report in the ignored repository-local
`.migration-reports/` directory, named
`shadow-read-compare-<UTC timestamp>.json`. An owner may choose a different
directory without changing the comparison boundary:

```powershell
python scripts/migration/compare_shadow_reads.py --report-dir '<owner-controlled-report-directory>'
```

Report directories and report files must be real paths, not symbolic links;
existing reports are never overwritten. Reports contain only aggregate counts,
comparison states, mismatch categories, format metadata, and generation time.
They never contain connection URLs, credentials, IDs, names, emails, phones,
addresses, comments, prayer content, contact values, tokens, push payloads,
avatar object keys, signed URLs, or database rows.

Avatar reporting is deliberately honest: it uses `match`, `mismatch`, or
`pending_storage_migration`. Because PR #325 did not migrate avatar objects, a
source with avatar objects is reported as `pending_storage_migration`, never as
a successful storage match.

Exit code `0` means every required domain matched. Any mismatch, incomplete
domain, pending storage migration, configuration error, connection error,
schema error, safety error, or report-path error returns non-zero.

### Owner manual checklist

- Confirm `.migration-reports/` is ignored by Git.
- Run the utility first only against owner-controlled local/synthetic source and target databases.
- Confirm hosted source and target connections fail without their separate explicit owner flags.
- Confirm a matching synthetic dataset returns exit code `0`.
- Confirm a deliberate aggregate mismatch returns non-zero.
- Confirm reports contain no IDs, names, emails, phones, addresses, comments, prayer content, contact data, tokens, push payloads, avatar keys, credentials, or database URLs.
- Confirm the script performs no writes.
- Confirm avatar state is shown honestly as `match`, `mismatch`, or `pending_storage_migration`.
- Confirm no generated reports appear in `git status --short`.
- Do not proceed to PR 37 provider cutover until the owner has reviewed the shadow comparison result and all cutover blockers.

## Next step

Provider cutover remains PR 37, `feature/backend-provider-cutover`.
