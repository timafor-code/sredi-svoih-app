# PostgreSQL backup and restore runbook

## Non-negotiable rule

**A backup is not considered valid until a restore test succeeds in a separate,
disposable verification database.** A successful `pg_dump`, upload, checksum,
or job exit code alone is not sufficient.

This owner-run procedure applies to the API-owned PostgreSQL deployment in
[the production deployment runbook](api-production-deploy.md). It does not
authorize connecting to, backing up, restoring, or changing a production or
staging database from this repository.

| Label | Meaning |
| --- | --- |
| **Repository-defined** | Verified from the repository. |
| **Placeholder** | A value such as `<backup-destination>` or `<verification-db>` that the owner must replace after approval. |
| **Owner decision** | A retention, provider, access, recovery, or operational choice not defined by the repository. |
| **Secret** | Supplied only to an authorized backup/restore workload by the production secret-management mechanism. |

The local reference in `infra/docker-compose.api.yml` uses PostgreSQL 16
(`postgres:16-alpine`) and Alembic migrations in `apps/api/alembic`.
Production PostgreSQL must be in Russia according to the owner’s provider
decision. This document does not claim legal compliance for a provider,
location, encryption, or retention policy.

Database backups do not include avatar objects in S3-compatible object storage.
The owner must separately select, document, and exercise object-storage
versioning or backup/export recovery so that DB metadata and objects can be
recovered consistently.

## Backup prerequisites

Before scheduling a backup job, confirm all of the following:

- PostgreSQL host, database name, network route, backup storage, and recovery
  copies are approved as Russia-hosted where required by owner policy.
- A dedicated backup identity has only the database privileges necessary for
  the intended logical backup. It is distinct from API runtime and human
  break-glass administration.
- The backup runner uses an owner-approved PostgreSQL client version. Prefer a
  `pg_dump` version compatible with the selected server; the repository’s local
  reference is PostgreSQL 16.
- The runner receives connection details as a **Secret**. The API's DB
  connection is backend-only; a backup tool may receive a standard
  `postgresql://...` URI or discrete PostgreSQL client variables. Neither is
  mobile, Vite, admin, or static-build configuration.
- The backup destination is encrypted, access-controlled, capacity-monitored,
  and protected from casual deletion. The owner decides whether an immutable or
  isolated copy is required.
- Jobs emit only artifact ID, timestamp, byte count, checksum, exit status,
  and redacted error category. They must not emit database rows, connection
  strings, raw PII, tokens, passwords, invite codes, registration comments, or
  query output.
- A named owner, on-call operator, restore-test cadence, and production-restore
  decision maker are recorded.

## Owner decisions: frequency, retention, recovery

The repository defines no retention policy. Record and approve at least these
values before production:

| Decision | Owner-recorded value |
| --- | --- |
| Backup schedule and timezone | `<for example: daily logical backup at an owner-approved UTC time>` |
| Point-in-time/WAL strategy, if any | `<provider-specific decision>` |
| Retention tiers and rotation | `<daily / weekly / monthly durations>` |
| Recovery point/recovery time objective | `<owner-approved targets>` |
| Primary and isolated/immutable destinations | `<Russia-hosted destination(s)>` |
| Encryption/key ownership and rotation | `<owner-approved mechanism>` |
| Restore-test frequency and permitted source | `<synthetic staging or specifically approved protected data>` |
| Object-storage metadata/object recovery | `<versioning/export/snapshot procedure>` |

These are **Placeholders**, not a recommended policy. Values depend on owner
risk, provider contracts, capacity, and legal review.

## Documented logical backup procedure

Run only in an owner-approved backup environment. Commands intentionally use
placeholders rather than real hosts, users, passwords, or destinations.
`PG_BACKUP_DATABASE_URL` is an **Owner-defined secret-delivery name**, not a
repository setting.

1. Confirm the target identity/database without printing the full connection
   URI. Confirm space locally and at `<backup-destination>`.
2. Generate an artifact name containing no personal data, for example
   `sredi-api-<UTC-timestamp>.dump`.
3. Create a custom-format logical backup. PowerShell shape:

   ```powershell
   $backupFile = "<backup-destination>/sredi-api-<UTC-timestamp>.dump"
   pg_dump --format=custom --no-owner --no-privileges --file "$backupFile" --dbname "$env:PG_BACKUP_DATABASE_URL"
   ```

   Do not paste a URI into command history. Custom format supports inspection
   and restore with `pg_restore`.
4. If `pg_dump` fails, mark the attempt failed, retain only redacted diagnostics,
   alert the owner, and do not overwrite the last known-good artifact.
5. Inspect structure without printing data:

   ```powershell
   pg_restore --list "$backupFile" | Select-Object -First 20
   Get-FileHash -Algorithm SHA256 "$backupFile"
   ```

   Store artifact ID, size, checksum, creation time, backup-tool version, and
   destination reference in a protected inventory; never store the URI there.
6. Finalize the artifact in approved encrypted storage and verify the stored
   copy’s checksum by the owner-selected mechanism. Record retention class.
7. Schedule and record a disposable restore test. Until it succeeds, label the
   artifact **unverified**.

This creates only a database backup. Coordinate it with the owner’s object
storage recovery procedure and record whether the artifact predates or follows
related object changes.

## Secure storage and access expectations

- Separate backup read, write, list, restore, and deletion permissions. A
  deployment runner must not automatically delete recovery artifacts.
- Encrypt in transit and at rest using the owner-selected mechanism. Record
  key recovery/rotation ownership outside this repository.
- Keep backups, connection credentials, signed URLs, and restore logs out of
  source control, issue trackers, chat, client builds, and normal shell history.
- Monitor job success, duration, size anomalies, destination capacity, checksum
  mismatch, and age of last successful restore test. An overdue test is a
  recovery failure, not merely an administrative task.
- Retire artifacts only under approved retention. Never delete the last
  known-good, restore-tested backup during normal rotation.

## Restore-test prerequisites

Do not start a restore test until the owner has independently verified:

1. The target is a newly created, separate, disposable verification database
   named like `<verification-db>`, not production and not normal staging.
2. The restore identity can write only to that verification target. Its details
   are injected as a **Secret**. `PG_RESTORE_VERIFY_DATABASE_URL` below is an
   **Owner-defined secret-delivery name**, not a repository setting.
3. The verification DB has private network access, restricted operators,
   capacity, and an approved disposal method.
4. Artifact ID/checksum/source time, expected PostgreSQL version, release image
   SHA, and Alembic head are recorded.
5. Operators understand that restore-test failure never authorizes restoring
   production. Production restoration needs separate owner decision and the
   escalation in [incident response](incident-response.md).

If a provider creates the disposable DB through a console/API, use the approved
process. If client tooling creates it, review its target first: it must only be
the new `<verification-db>`. Never use `dropdb`, `--clean`, or a production URI
in a restore test.

## Restore into a disposable verification database

1. Validate artifact checksum against protected inventory. Stop on mismatch or
   unknown provenance.
2. Confirm the connection targets only the separate disposable DB. A second
   operator/owner verifies database name and host before `pg_restore`.
3. Restore into the empty verification DB:

   ```powershell
   pg_restore --exit-on-error --no-owner --no-privileges --dbname "$env:PG_RESTORE_VERIFY_DATABASE_URL" "<backup-artifact-path>"
   ```

   Do not add `--clean`; a test restore uses an empty disposable DB. Do not
   display the URI or restored data in terminal transcripts.
4. Capture only result, artifact ID, duration, tool versions, and redacted
   error category. If it fails, preserve the artifact, stop, and discard the
   partial verification DB only through the approved disposable procedure.
5. Confirm migration state with the approved API image configured only for the
   verification database. `apps/api/alembic/env.py` reads API configuration; an
   owner-run container check may be shaped as:

   ```powershell
   docker run --rm --env-file <verification-secret-delivery-file> sredi-svoih-api:<immutable-release> alembic current
   ```

   Angled values are **Placeholders** and must point only to the disposable
   verification DB; the secret delivery file remains outside the repository.
6. Destroy the verification DB only after recording successful evidence or
   completing failure analysis. Its disposal must not affect production,
   backups, storage artifacts, or ordinary staging.

## Restore-test checklist

- [ ] Artifact checksum, size, and source timestamp match protected inventory.
- [ ] A second operator/owner confirmed host/database are the separate disposable target.
- [ ] `pg_restore` completed with `--exit-on-error`; no unreviewed warnings were ignored.
- [ ] `alembic current` matches expected migration state for the release under test.
- [ ] Run read-only integrity checks returning counts/metadata only: confirm
  `alembic_version` and compare counts for an owner-reviewed set of current API
  tables. Do not export rows or inspect raw profiles, contacts, messages,
  tokens, codes, or other personal data.
- [ ] Verify expected constraints/indexes and a representative read-only API
  path against an isolated staging API only with owner approval. `/health` is
  liveness only; migration/read-only checks provide DB evidence.
- [ ] Verify related object-storage recovery independently. Restored avatar
  metadata may require separate object versioning/export recovery.
- [ ] Record artifact ID/checksum, start/end, runner/tool versions, release SHA,
  migration state, pass/fail, and owner signoff. No raw database data belongs
  in the record.

## Integrity and application-level verification

| Evidence | Establishes | Limitation |
| --- | --- | --- |
| `pg_restore --list` and checksum | Artifact is readable and unchanged from inventory. | Does not prove it can restore. |
| Successful restore into `<verification-db>` | Artifact recreates a separate DB with selected toolchain. | Does not prove an API release can use it. |
| Alembic current-state check | Restored schema is visible to current migration configuration. | Not an application-flow test. |
| Read-only count/constraint checks | Selected structures/aggregates are plausible without exposing PII. | Cannot prove every workflow or storage asset. |
| Isolated staging API verification | Release performs approved least-privilege reads on restored schema. | Never direct normal traffic or writes to restore-test DB. |

Mark a backup **restore-tested** only when all applicable evidence passes.

## Failure handling and production-restore escalation

### Backup or restore-test failure

1. Stop the failed job; do not retry blindly against a different or production
   target.
2. Preserve source artifact and only redacted diagnostics, tool versions,
   timestamps, and IDs.
3. Keep the last restore-tested artifact protected. Investigate access,
   capacity, PostgreSQL/client compatibility, integrity, and target isolation.
4. Use a fresh disposable verification target for a new attempt. Do not use
   `--clean` or any command that can alter production.
5. Notify the owner if recovery objective, schedule, or restore-test deadline
   is missed. Treat untested backup as unverified.

### Possible production restoration

Production restore is incident recovery, not routine deployment/rollback.
Before considering it, owner decides acceptable data-loss window, write
freeze/maintenance state, artifact, object-storage consistency action, client
communication, and recovery verification. Follow
[incident response](incident-response.md) and the data-preserving rollback
rules in [the deployment runbook](api-production-deploy.md). Never use a
restore test as authority to overwrite production.
