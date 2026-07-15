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
