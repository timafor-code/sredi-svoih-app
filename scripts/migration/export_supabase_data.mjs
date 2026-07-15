#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;

const FORMAT_VERSION = '1.0.0';
export const POSTGRES_DATE_OID = 1082;
const ACKNOWLEDGEMENT = 'LOCAL_OR_OWNER_APPROVED_EXPORT';
const DATABASE_URL_ENV = 'SUPABASE_EXPORT_DATABASE_URL';
const ACK_ENV = 'SUPABASE_EXPORT_RUN_ACK';
const AVATAR_BUCKET = 'avatars';
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT_ENTRIES = new Set(['manifest.json', 'checksums.sha256', 'tables', 'storage']);
const FORBIDDEN_SENSITIVE_COLUMN_NAMES = new Set([
  'access_token',
  'encrypted_password',
  'jwt',
  'jwt_token',
  'oauth_provider_payload',
  'password',
  'password_hash',
  'provider_payload',
  'provider_refresh_token',
  'provider_token',
  'refresh_token',
]);

// This is deliberately an explicit, ordered allowlist. It is not discovered by
// enumerating public tables. Required entries are the baseline data domain;
// later feature tables are recorded as skipped when absent on an older source.
const PUBLIC_TABLES = [
  { table: 'profiles', required: true },
  { table: 'communities', required: true },
  { table: 'community_memberships', required: true },
  { table: 'invites', required: true },
  { table: 'events', required: true },
  { table: 'event_occurrences', required: false },
  { table: 'event_categories', required: false },
  { table: 'event_participation_options', required: false },
  { table: 'event_participation_option_capacity_units', required: false },
  { table: 'event_registration_option_selections', required: false },
  { table: 'event_capacity_units', required: false },
  { table: 'event_registrations', required: true },
  { table: 'event_registration_capacity_reservations', required: false },
  { table: 'event_seating_layout_templates', required: false },
  { table: 'event_seating_layouts', required: false },
  { table: 'event_seating_tables', required: false },
  { table: 'event_seating_table_connections', required: false },
  { table: 'event_seating_assignments', required: false },
  { table: 'event_import_sources', required: false },
  { table: 'event_import_runs', required: false },
  { table: 'event_import_items', required: false },
  { table: 'admin_feedback', required: false },
  { table: 'device_tokens', required: false },
  { table: 'prayer_activity_logs', required: false },
  { table: 'profile_contact_visibility', required: false },
  { table: 'community_contacts', required: true },
  { table: 'synced_contacts', required: true },
  { table: 'community_event_locations', required: false },
  { table: 'push_notification_jobs', required: false },
  { table: 'push_notification_deliveries', required: false },
];

class ExportError extends Error {}

// node-postgres otherwise materializes PostgreSQL DATE as a local-time Date.
// Keep its source text so JSON serialization cannot change its calendar day.
export function parsePostgresDate(value) {
  return value;
}

export function configurePostgresDateParser(typeRegistry = pg.types) {
  typeRegistry.setTypeParser(POSTGRES_DATE_OID, parsePostgresDate);
}

configurePostgresDateParser();

function printUsage() {
  console.log(`
Usage:
  SUPABASE_EXPORT_DATABASE_URL=<owner-local-postgres-url> \\
  SUPABASE_EXPORT_RUN_ACK=${ACKNOWLEDGEMENT} \\
  node scripts/migration/export_supabase_data.mjs --output-dir <secure-directory>

Required environment variables:
  ${DATABASE_URL_ENV}  Owner-local PostgreSQL connection string. No default exists.
  ${ACK_ENV}           Must equal ${ACKNOWLEDGEMENT}.

Required option:
  --output-dir <path>  Empty or owner-approved output directory outside this repository.

Safety options:
  --overwrite                         Replace a prior exporter-only artifact set.
  --allow-output-in-repository        Explicitly allow an output path inside this repository.
                                      Generated artifacts must never be staged or committed.
  --allow-hosted-with-owner-command   Required when the connection is not clearly local.

Other options:
  --help, -h                          Print this help without connecting to a database.
`);
}

function requireOptionValue(argv, index, option) {
  const value = argv[index + 1];

  if (!value || value.startsWith('--')) {
    throw new ExportError(`${option} requires a non-empty value.`);
  }

  return value;
}

function parseArgs(argv) {
  const options = {
    allowHostedWithOwnerCommand: false,
    allowOutputInRepository: false,
    help: false,
    outputDir: null,
    overwrite: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--output-dir') {
      options.outputDir = requireOptionValue(argv, index, '--output-dir');
      index += 1;
      continue;
    }

    if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length);
      if (!options.outputDir) {
        throw new ExportError('--output-dir requires a non-empty value.');
      }
      continue;
    }

    if (arg === '--overwrite') {
      options.overwrite = true;
      continue;
    }

    if (arg === '--allow-output-in-repository') {
      options.allowOutputInRepository = true;
      continue;
    }

    if (arg === '--allow-hosted-with-owner-command') {
      options.allowHostedWithOwnerCommand = true;
      continue;
    }

    throw new ExportError(`Unknown option: ${arg}`);
  }

  if (options.help) {
    return options;
  }

  if (!options.outputDir || !options.outputDir.trim()) {
    throw new ExportError('An explicit non-empty --output-dir is required.');
  }

  return options;
}

function isPathInside(candidate, parent) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === ''
    || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent));
}

async function assertOutputDirectory(options) {
  const outputDir = resolve(options.outputDir);

  if (outputDir === dirname(outputDir)) {
    throw new ExportError('The output directory must not be a filesystem root.');
  }

  if (isPathInside(outputDir, REPOSITORY_ROOT) && !options.allowOutputInRepository) {
    throw new ExportError(
      'Refusing an output directory inside the repository. Choose an owner-controlled directory outside it, or use --allow-output-in-repository deliberately.',
    );
  }

  try {
    const details = await lstat(outputDir);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new ExportError('The output path must be a real directory, not a file or symbolic link.');
    }

    const entries = await readdir(outputDir, { withFileTypes: true });
    if (entries.length > 0 && !options.overwrite) {
      throw new ExportError('The output directory is not empty. Pass --overwrite only for a prior exporter artifact set.');
    }

    if (entries.length > 0 && options.overwrite) {
      await assertPreviousArtifactSet(entries);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const parent = dirname(outputDir);
      const parentDetails = await lstat(parent).catch((parentError) => {
        if (parentError?.code === 'ENOENT') {
          throw new ExportError('The parent directory for --output-dir does not exist.');
        }
        throw parentError;
      });
      if (!parentDetails.isDirectory() || parentDetails.isSymbolicLink()) {
        throw new ExportError('The parent directory for --output-dir must be a real directory.');
      }
      return outputDir;
    }
    throw error;
  }

  return outputDir;
}

async function assertPreviousArtifactSet(entries) {
  for (const entry of entries) {
    if (!OUTPUT_ENTRIES.has(entry.name) || entry.isSymbolicLink()) {
      throw new ExportError(
        'Refusing --overwrite because the output directory contains files that are not a prior exporter artifact set.',
      );
    }

    if ((entry.name === 'tables' || entry.name === 'storage') && !entry.isDirectory()) {
      throw new ExportError('Refusing --overwrite because a prior artifact directory has an unexpected type.');
    }

    if ((entry.name === 'manifest.json' || entry.name === 'checksums.sha256') && !entry.isFile()) {
      throw new ExportError('Refusing --overwrite because a prior artifact file has an unexpected type.');
    }
  }
}

function validateOwnerAcknowledgements(options) {
  const connectionString = process.env[DATABASE_URL_ENV];

  if (!connectionString) {
    throw new ExportError(`${DATABASE_URL_ENV} is required. This utility has no default database URL.`);
  }

  if (process.env[ACK_ENV] !== ACKNOWLEDGEMENT) {
    throw new ExportError(`${ACK_ENV} must exactly equal ${ACKNOWLEDGEMENT}.`);
  }

  if (isLikelyHostedConnection(connectionString) && !options.allowHostedWithOwnerCommand) {
    throw new ExportError(
      'The connection string is not clearly local. Re-run only with separate owner approval and --allow-hosted-with-owner-command.',
    );
  }

  return connectionString;
}

function isLikelyHostedConnection(connectionString) {
  let hostname;

  try {
    hostname = new URL(connectionString).hostname.toLowerCase();
  } catch {
    throw new ExportError(`${DATABASE_URL_ENV} must be a valid PostgreSQL connection URL.`);
  }

  const localHostnames = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);
  return !localHostnames.has(hostname) && !hostname.endsWith('.local');
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(identifier)) {
    throw new ExportError('An internal allowlist identifier is invalid.');
  }
  return `"${identifier}"`;
}

function relationName(schema, table) {
  return `${schema}.${table}`;
}

async function relationExists(client, schema, table) {
  const result = await client.query(
    'select to_regclass($1) is not null as exists',
    [relationName(schema, table)],
  );
  return result.rows[0]?.exists === true;
}

async function getColumns(client, schema, table) {
  const result = await client.query(
    `select column_name, data_type, udt_name
     from information_schema.columns
     where table_schema = $1 and table_name = $2
     order by ordinal_position`,
    [schema, table],
  );
  return result.rows;
}

async function getPrimaryKeyColumns(client, schema, table) {
  const result = await client.query(
    `select attribute.attname as column_name
     from pg_index as index_definition
     join unnest(index_definition.indkey) with ordinality as key_column(attnum, ordinality)
       on true
     join pg_attribute as attribute
       on attribute.attrelid = index_definition.indrelid
      and attribute.attnum = key_column.attnum
     where index_definition.indrelid = $1::regclass
       and index_definition.indisprimary
     order by key_column.ordinality`,
    [relationName(schema, table)],
  );
  return result.rows.map((row) => row.column_name);
}

function assertNoForbiddenSensitiveColumns(table, columns) {
  const forbiddenColumns = columns
    .map((column) => column.column_name)
    .filter((column) => FORBIDDEN_SENSITIVE_COLUMN_NAMES.has(column)
      || (table === 'invites' && (column === 'code' || column === 'invite_code')));

  if (forbiddenColumns.length > 0) {
    throw new ExportError(
      `Refusing public.${table}: unexpected plaintext credential or invite-code columns are not exportable.`,
    );
  }
}

async function inspectPublicTables(client) {
  const inspected = [];
  const missingRequired = [];

  for (const definition of PUBLIC_TABLES) {
    const exists = await relationExists(client, 'public', definition.table);
    if (!exists) {
      if (definition.required) {
        missingRequired.push(definition.table);
      }
      inspected.push({ ...definition, exists: false, primaryKey: [] });
      continue;
    }

    const [columns, primaryKey] = await Promise.all([
      getColumns(client, 'public', definition.table),
      getPrimaryKeyColumns(client, 'public', definition.table),
    ]);
    const binaryColumns = columns.filter((column) => column.udt_name === 'bytea');

    assertNoForbiddenSensitiveColumns(definition.table, columns);

    if (binaryColumns.length > 0) {
      throw new ExportError(
        `Refusing public.${definition.table}: inline binary columns are not supported by this JSONL exporter.`,
      );
    }

    if (primaryKey.length === 0) {
      throw new ExportError(
        `Refusing public.${definition.table}: no primary key is available for deterministic row order.`,
      );
    }

    inspected.push({ ...definition, exists: true, primaryKey });
  }

  if (missingRequired.length > 0) {
    throw new ExportError(`Required core tables are missing: ${missingRequired.map((table) => `public.${table}`).join(', ')}.`);
  }

  return inspected;
}

async function inspectAvatarStorage(client) {
  const schema = 'storage';
  const table = 'objects';

  if (!await relationExists(client, schema, table)) {
    return {
      exists: false,
      reason: 'storage.objects is not present in the source database.',
    };
  }

  const [columns, primaryKey] = await Promise.all([
    getColumns(client, schema, table),
    getPrimaryKeyColumns(client, schema, table),
  ]);
  const availableColumns = new Set(columns.map((column) => column.column_name));

  if (!availableColumns.has('bucket_id') || !availableColumns.has('name')) {
    return {
      exists: false,
      reason: 'storage.objects does not expose the required bucket_id and name metadata columns.',
    };
  }

  if (primaryKey.length === 0) {
    return {
      exists: false,
      reason: 'storage.objects has no primary key for deterministic row order.',
    };
  }

  return {
    availableColumns,
    exists: true,
    primaryKey,
  };
}

export function normalizeForJson(value, context) {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    throw new ExportError(`Refusing to write inline binary data in ${context}.`);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeForJson(entry, `${context}[${index}]`));
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ExportError(`Refusing a non-finite numeric value in ${context}.`);
    }
    return value;
  }

  if (typeof value === 'object') {
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeForJson(entry, `${context}.${key}`);
    }
    return normalized;
  }

  if (typeof value === 'undefined') {
    throw new ExportError(`Refusing an undefined value in ${context}.`);
  }

  return value;
}

async function writeJsonLines(filePath, rows, context) {
  const handle = await open(filePath, 'wx');
  const hash = createHash('sha256');
  let rowCount = 0;

  try {
    for (const row of rows) {
      const line = `${JSON.stringify(normalizeForJson(row, context))}\n`;
      const bytes = Buffer.from(line, 'utf8');
      await handle.write(bytes);
      hash.update(bytes);
      rowCount += 1;
    }
  } finally {
    await handle.close();
  }

  return {
    rowCount,
    sha256: hash.digest('hex'),
  };
}

async function sha256File(filePath) {
  const hash = createHash('sha256');

  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });

  return hash.digest('hex');
}

function tableSelectQuery(table, primaryKey) {
  const qualifiedTable = `${quoteIdentifier('public')}.${quoteIdentifier(table)}`;
  const orderBy = primaryKey.map((column) => `${quoteIdentifier(column)} asc nulls last`).join(', ');
  return `select * from ${qualifiedTable} order by ${orderBy}`;
}

async function exportPublicTable(client, definition, stagingDir) {
  const result = await client.query(tableSelectQuery(definition.table, definition.primaryKey));
  const relativePath = `tables/${definition.table}.jsonl`;
  const artifact = await writeJsonLines(join(stagingDir, relativePath), result.rows, `public.${definition.table}`);

  console.log(`[export] public.${definition.table} rows=${artifact.rowCount} sha256=${artifact.sha256}`);

  return {
    artifact: relativePath,
    primary_key: definition.primaryKey,
    required: definition.required,
    row_count: artifact.rowCount,
    schema: 'public',
    sha256: artifact.sha256,
    status: 'exported',
    table: definition.table,
  };
}

function avatarSelectQuery(storageDefinition) {
  const columns = storageDefinition.availableColumns;
  const ownerColumn = columns.has('owner_id') ? 'owner_id' : (columns.has('owner') ? 'owner' : null);
  const ownerSelect = ownerColumn ? `object_row.${quoteIdentifier(ownerColumn)}::text` : 'null::text';
  const metadataSelect = columns.has('metadata') ? `object_row.${quoteIdentifier('metadata')}` : 'null::jsonb';
  const contentTypeSelect = columns.has('metadata')
    ? `object_row.${quoteIdentifier('metadata')} ->> 'mimetype'`
    : 'null::text';
  const sizeSelect = columns.has('metadata')
    ? `case when object_row.${quoteIdentifier('metadata')} ? 'size' then object_row.${quoteIdentifier('metadata')} -> 'size' else null end`
    : 'null::jsonb';
  const createdAtSelect = columns.has('created_at') ? `object_row.${quoteIdentifier('created_at')}` : 'null::timestamptz';
  const updatedAtSelect = columns.has('updated_at') ? `object_row.${quoteIdentifier('updated_at')}` : 'null::timestamptz';
  const orderBy = [
    `object_row.${quoteIdentifier('bucket_id')} asc`,
    `object_row.${quoteIdentifier('name')} asc`,
    ...storageDefinition.primaryKey.map((column) => `object_row.${quoteIdentifier(column)} asc nulls last`),
  ].join(', ');

  return `select
      object_row.${quoteIdentifier('bucket_id')} as bucket,
      object_row.${quoteIdentifier('name')} as object_key,
      ${ownerSelect} as owner_id,
      ${contentTypeSelect} as content_type,
      ${sizeSelect} as size_bytes,
      ${createdAtSelect} as created_at,
      ${updatedAtSelect} as updated_at,
      profile.id::text as profile_id,
      ${metadataSelect} as source_metadata
    from ${quoteIdentifier('storage')}.${quoteIdentifier('objects')} as object_row
    left join ${quoteIdentifier('public')}.${quoteIdentifier('profiles')} as profile
      on profile.id::text = split_part(object_row.${quoteIdentifier('name')}, '/', 1)
    where object_row.${quoteIdentifier('bucket_id')} = $1
    order by ${orderBy}`;
}

async function exportAvatarManifest(client, storageDefinition, stagingDir) {
  if (!storageDefinition.exists) {
    console.log(`[warning] storage.objects skipped: ${storageDefinition.reason}`);
    return {
      reason: storageDefinition.reason,
      required: false,
      row_count: null,
      schema: 'storage',
      status: 'skipped',
      table: 'objects',
    };
  }

  const result = await client.query(avatarSelectQuery(storageDefinition), [AVATAR_BUCKET]);
  const relativePath = 'storage/avatar_objects.jsonl';
  const artifact = await writeJsonLines(join(stagingDir, relativePath), result.rows, 'storage.objects avatars manifest');

  console.log(`[export] storage.objects avatar manifest rows=${artifact.rowCount} sha256=${artifact.sha256}`);

  return {
    artifact: relativePath,
    primary_key: storageDefinition.primaryKey,
    required: false,
    row_count: artifact.rowCount,
    schema: 'storage',
    sha256: artifact.sha256,
    status: 'exported',
    table: 'objects',
    where: { bucket_id: AVATAR_BUCKET },
  };
}

async function createStagingDirectory(outputDir) {
  const stagingDir = await mkdtemp(join(dirname(outputDir), `.${basename(outputDir)}.supabase-export-${randomUUID()}-`));
  await mkdir(join(stagingDir, 'tables'));
  await mkdir(join(stagingDir, 'storage'));
  return stagingDir;
}

async function removePreviousArtifacts(outputDir) {
  const entries = await readdir(outputDir, { withFileTypes: true });
  await assertPreviousArtifactSet(entries);

  for (const entry of entries) {
    await rm(join(outputDir, entry.name), { force: true, recursive: entry.isDirectory() });
  }
}

async function commitStagingDirectory(stagingDir, outputDir, overwrite) {
  let outputExists = true;
  let outputDetails = null;
  try {
    outputDetails = await lstat(outputDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      outputExists = false;
    } else {
      throw error;
    }
  }

  if (!outputExists) {
    await mkdir(outputDir);
  } else {
    if (!outputDetails.isDirectory() || outputDetails.isSymbolicLink()) {
      throw new ExportError('The output path changed during export and is no longer a real directory.');
    }
    const entries = await readdir(outputDir, { withFileTypes: true });
    if (entries.length > 0 && !overwrite) {
      throw new ExportError('The output directory became non-empty during export; refusing to replace it.');
    }
    if (entries.length > 0) {
      await removePreviousArtifacts(outputDir);
    }
  }

  for (const name of ['tables', 'storage', 'manifest.json', 'checksums.sha256']) {
    await rename(join(stagingDir, name), join(outputDir, name));
  }

  await rm(stagingDir, { force: true, recursive: true });
}

async function writeManifestAndChecksums(stagingDir, tableRecords) {
  const exportedArtifacts = tableRecords
    .filter((record) => record.status === 'exported')
    .map((record) => ({ path: record.artifact, sha256: record.sha256 }));
  const manifest = {
    format_version: FORMAT_VERSION,
    created_at: new Date().toISOString(),
    export_scope: {
      public_tables: 'explicit ordered allowlist only',
      storage: `storage.objects rows limited to bucket_id=${AVATAR_BUCKET}`,
    },
    checksum_algorithm: 'sha256',
    checksum_index: 'checksums.sha256',
    tables: tableRecords,
  };
  const manifestPath = join(stagingDir, 'manifest.json');

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  const manifestSha256 = await sha256File(manifestPath);
  const checksumLines = [
    `${manifestSha256}  manifest.json`,
    ...exportedArtifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`),
  ];
  await writeFile(join(stagingDir, 'checksums.sha256'), `${checksumLines.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' });

  console.log(`[manifest] rows=${tableRecords.reduce((total, record) => total + (record.row_count ?? 0), 0)} sha256=${manifestSha256}`);
}

async function runExport(connectionString, options, outputDir) {
  const client = new Client({
    application_name: 'sredi-svoih-supabase-export',
    connectionString,
  });
  let transactionOpen = false;
  let stagingDir = null;

  try {
    await client.connect();
    await client.query('begin transaction isolation level repeatable read, read only');
    transactionOpen = true;

    const publicDefinitions = await inspectPublicTables(client);
    const storageDefinition = await inspectAvatarStorage(client);
    stagingDir = await createStagingDirectory(outputDir);
    const records = [];

    for (const definition of publicDefinitions) {
      if (!definition.exists) {
        const reason = 'Optional feature table is not present in the source database.';
        console.log(`[warning] public.${definition.table} skipped: ${reason}`);
        records.push({
          reason,
          required: false,
          row_count: null,
          schema: 'public',
          status: 'skipped',
          table: definition.table,
        });
        continue;
      }

      records.push(await exportPublicTable(client, definition, stagingDir));
    }

    records.push(await exportAvatarManifest(client, storageDefinition, stagingDir));
    await client.query('commit');
    transactionOpen = false;
    await writeManifestAndChecksums(stagingDir, records);
    await commitStagingDirectory(stagingDir, outputDir, options.overwrite);
    stagingDir = null;
    console.log(`[complete] output=${outputDir}`);
  } catch (error) {
    if (transactionOpen) {
      await client.query('rollback').catch(() => undefined);
    }
    throw error;
  } finally {
    if (stagingDir) {
      await rm(stagingDir, { force: true, recursive: true }).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

function safeErrorMessage(error) {
  if (error instanceof ExportError) {
    return error.message;
  }
  return 'A database or filesystem operation failed. Inspect owner-local configuration and permissions without printing credentials or source rows.';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const outputDir = await assertOutputDirectory(options);
  const connectionString = validateOwnerAcknowledgements(options);
  await runExport(connectionString, options, outputDir);
}

const isEntrypoint = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error(`[error] ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
