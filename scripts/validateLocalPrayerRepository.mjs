#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const ts = require('typescript');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

registerNativeModuleStubs();
registerTypeScriptRequireHook();

const {
  DEFAULT_LOCAL_PRAYER_HISTORY_LIMIT,
  DELETE_ALL_GUEST_PRAYERS_SQL,
  DELETE_LOCAL_PRAYER_SQL,
  INSERT_LOCAL_PRAYER_SQL,
  LOCAL_PRAYER_OWNER_SCOPE,
  LocalPrayerRepositoryError,
  MAX_LOCAL_PRAYER_HISTORY_LIMIT,
  MIN_LOCAL_PRAYER_HISTORY_LIMIT,
  PRAYER_ACTIVITY_TYPES,
  PRAYER_SYNC_STATES,
  SELECT_LOCAL_PRAYER_BY_DOMAIN_SQL,
  UPDATE_LOCAL_PRAYER_SQL,
  createLocalPrayerRepository,
} = require(path.join(repoRoot, 'src/local-data/prayerRepository.ts'));
const {
  CREATE_LOCAL_PRAYER_LOGS_SQL,
  prayerLogsMigration,
} = require(path.join(repoRoot, 'src/local-data/migrations/prayerLogs.ts'));
const { localMigrations } = require(path.join(repoRoot, 'src/local-data/migrations/index.ts'));

validateMigration();
await validateInsertAndUpsert();
await validateActivityDateResolution();
await validateHistory();
await validateSummary();
await validateDeletionAndCorruptionSafety();
validatePreparedSqlAndSourceBoundaries();

console.log('Local prayer repository validation passed');

function validateMigration() {
  assertEqual(prayerLogsMigration.version, 3, 'prayer migration version');
  assertDeepEqual(
    localMigrations.map(({ version }) => version),
    [1, 2, 3],
    'historical migration order',
  );

  const requiredColumns = [
    'local_id',
    'owner_scope',
    'activity_type',
    'activity_date',
    'started_at',
    'completed_at',
    'timezone',
    'city',
    'hebrew_date_json',
    'metadata_json',
    'created_at',
    'updated_at',
    'sync_state',
    'synced_user_id',
    'server_id',
    'last_sync_error_code',
  ];

  for (const column of requiredColumns) {
    assertEqual(
      new RegExp(`\\b${column}\\b`).test(CREATE_LOCAL_PRAYER_LOGS_SQL),
      true,
      `schema column ${column}`,
    );
  }

  for (const column of [
    'owner_scope',
    'activity_type',
    'activity_date',
    'timezone',
    'hebrew_date_json',
    'metadata_json',
    'created_at',
    'updated_at',
    'sync_state',
  ]) {
    assertEqual(
      new RegExp(`${column}\\s+TEXT\\s+NOT NULL`).test(CREATE_LOCAL_PRAYER_LOGS_SQL),
      true,
      `not-null schema constraint ${column}`,
    );
  }

  assertEqual(
    /UNIQUE\s*\(\s*owner_scope\s*,\s*activity_date\s*,\s*activity_type\s*\)/.test(
      CREATE_LOCAL_PRAYER_LOGS_SQL,
    ),
    true,
    'database uniqueness constraint',
  );
  assertEqual(
    CREATE_LOCAL_PRAYER_LOGS_SQL.includes("DEFAULT 'guest'"),
    true,
    'guest owner default',
  );

  assertDeepEqual(
    PRAYER_ACTIVITY_TYPES,
    [
      'shacharit',
      'mincha',
      'maariv',
      'shema_morning',
      'shema_evening',
      'omer_count',
    ],
    'canonical prayer activity types',
  );
  assertDeepEqual(
    PRAYER_SYNC_STATES,
    ['local_only', 'pending', 'synced', 'error'],
    'documented sync states',
  );

  for (const activityType of PRAYER_ACTIVITY_TYPES) {
    assertEqual(
      CREATE_LOCAL_PRAYER_LOGS_SQL.includes(`'${activityType}'`),
      true,
      `activity constraint ${activityType}`,
    );
  }

  for (const syncState of PRAYER_SYNC_STATES) {
    assertEqual(
      CREATE_LOCAL_PRAYER_LOGS_SQL.includes(`'${syncState}'`),
      true,
      `sync-state constraint ${syncState}`,
    );
  }
}

async function validateInsertAndUpsert() {
  const database = createFakePrayerDatabase();
  const ids = ['10000000-0000-4000-8000-000000000001'];
  const repository = createLocalPrayerRepository(database, {
    createLocalId: () => ids.shift(),
    now: createClock([
      '2026-08-09T10:00:00.000Z',
      '2026-08-09T10:01:00.000Z',
      '2026-08-09T10:02:00.000Z',
      '2026-08-09T10:03:00.000Z',
    ]),
  });

  const created = await repository.record({
    activityType: 'shacharit',
    activityDate: '2026-08-09',
    startedAt: '2026-08-09T06:00:00+03:00',
    timezone: 'Europe/Moscow',
    city: 'Synthetic City',
    hebrewDate: { day: 25, month: 'Av' },
    metadata: { source: 'synthetic', retained: true },
  });

  assertEqual(database.rows.size, 1, 'new row creation');
  assertEqual(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i.test(created.localId),
    true,
    'generated UUID identity',
  );
  assertEqual(created.ownerScope, 'guest', 'guest owner scope');
  assertEqual(created.syncState, 'local_only', 'guest sync state');
  assertEqual(created.syncedUserId, null, 'guest synced user absent');
  assertEqual(created.serverId, null, 'guest server identity absent');
  assertEqual(created.lastSyncErrorCode, null, 'guest sync error absent');

  const updated = await repository.record({
    activityType: 'shacharit',
    activityDate: '2026-08-09',
    startedAt: null,
    completedAt: '2026-08-09T06:30:00+03:00',
    city: null,
    hebrewDate: { year: 5786 },
    metadata: { source: 'updated' },
  });

  assertEqual(database.rows.size, 1, 'unique daily activity');
  assertEqual(updated.localId, created.localId, 'upsert preserves local identity');
  assertEqual(updated.createdAt, created.createdAt, 'upsert preserves creation time');
  assertEqual(updated.updatedAt !== created.updatedAt, true, 'upsert changes update time');
  assertEqual(updated.startedAt, created.startedAt, 'null timestamp does not erase value');
  assertEqual(updated.city, created.city, 'null city does not erase value');
  assertDeepEqual(
    updated.metadata,
    { source: 'updated', retained: true },
    'metadata shallow merge',
  );
  assertDeepEqual(
    updated.hebrewDate,
    { day: 25, month: 'Av', year: 5786 },
    'Hebrew date shallow merge',
  );

  const idempotent = await repository.record({
    activityType: 'shacharit',
    activityDate: '2026-08-09',
  });
  assertEqual(database.rows.size, 1, 'repeated record does not duplicate');
  assertEqual(idempotent.localId, created.localId, 'repeated record keeps identity');

  await assertRepositoryError(
    () => repository.record({
      activityType: 'unknown',
      activityDate: '2026-08-09',
      startedAt: '2026-08-09T06:00:00Z',
    }),
    'invalid_input',
    'unknown activity rejected',
  );

  assertEqual(database.transactionCount, 3, 'invalid activity rejected before transaction');
  assertEqual(
    database.preparedStatementCount,
    database.finalizedStatementCount,
    'upsert prepared statements finalized',
  );
  assertReadLifecycleOrder(database, 'first-row', 'first-row result lifecycle');

  const allTypesDatabase = createFakePrayerDatabase();
  const allTypesRepository = createLocalPrayerRepository(
    allTypesDatabase,
    createSequentialDependencies(),
  );

  for (const activityType of PRAYER_ACTIVITY_TYPES) {
    await allTypesRepository.record(createRecord(activityType, '2026-08-11'));
  }

  assertEqual(allTypesDatabase.rows.size, 6, 'all canonical activity types accepted');

  const inheritedPayload = Object.create({ synthetic: true });
  await assertRepositoryError(
    () => allTypesRepository.record({
      activityType: 'shacharit',
      activityDate: '2026-08-12',
      completedAt: '2026-08-12T12:00:00Z',
      metadata: inheritedPayload,
    }),
    'invalid_input',
    'object with inherited prototype rejected',
  );
}

async function validateActivityDateResolution() {
  const database = createFakePrayerDatabase();
  const repository = createLocalPrayerRepository(database, createSequentialDependencies());

  const explicit = await repository.record({
    activityType: 'mincha',
    activityDate: '2026-08-09',
    completedAt: '2026-08-09T15:00:00Z',
  });
  assertEqual(explicit.activityDate, '2026-08-09', 'explicit valid date');

  const fromStarted = await repository.record({
    activityType: 'maariv',
    startedAt: '2026-08-08T22:30:00Z',
    timezone: 'Europe/Moscow',
  });
  assertEqual(fromStarted.activityDate, '2026-08-09', 'date derived from started timestamp');

  const fromCompleted = await repository.record({
    activityType: 'shema_morning',
    completedAt: '2026-08-08T22:30:00Z',
    timezone: 'America/New_York',
  });
  assertEqual(fromCompleted.activityDate, '2026-08-08', 'date derived from completed timestamp');
  assertEqual(
    fromStarted.activityDate !== fromCompleted.activityDate,
    true,
    'timezone changes derived local date',
  );

  await assertRepositoryError(
    () => repository.record({
      activityType: 'omer_count',
      activityDate: '2026-02-30',
      completedAt: '2026-02-28T10:00:00Z',
    }),
    'invalid_input',
    'malformed explicit date rejected',
  );
  await assertRepositoryError(
    () => repository.record({ activityType: 'omer_count' }),
    'invalid_input',
    'new row without date or timestamp rejected',
  );
  await assertRepositoryError(
    () => repository.record({
      activityType: 'omer_count',
      startedAt: 'not-a-timeZ',
    }),
    'invalid_input',
    'invalid timestamp rejected',
  );
  await assertRepositoryError(
    () => repository.record({
      activityType: 'omer_count',
      startedAt: '2026-08-09T10:00:00',
    }),
    'invalid_input',
    'timezone-naive timestamp rejected',
  );
  await assertRepositoryError(
    () => repository.record({
      activityType: 'omer_count',
      startedAt: '2026-08-09T10:00:00Z',
      timezone: 'Mars/Synthetic',
    }),
    'invalid_input',
    'invalid timezone rejected',
  );
  await assertRepositoryError(
    () => repository.record({
      activityType: 'omer_count',
      startedAt: '2026-08-09T10:00:00Z',
      timezone: '   ',
    }),
    'invalid_input',
    'empty explicit timezone rejected',
  );
}

async function validateHistory() {
  const database = createFakePrayerDatabase();
  const repository = createLocalPrayerRepository(database, createSequentialDependencies());

  await repository.record(createRecord('shacharit', '2026-08-07'));
  await repository.record(createRecord('mincha', '2026-08-08'));
  await repository.record(createRecord('maariv', '2026-08-09'));
  await repository.record(createRecord('shacharit', '2026-08-09'));
  await repository.record(createRecord('omer_count', '2026-08-10'));

  const all = await repository.list();
  assertDeepEqual(
    all.map(({ activityDate }) => activityDate),
    ['2026-08-10', '2026-08-09', '2026-08-09', '2026-08-08', '2026-08-07'],
    'descending history ordering',
  );
  assertEqual(
    all[1].createdAt > all[2].createdAt,
    true,
    'same-day history ordered by creation time descending',
  );
  assertDeepEqual(
    (await repository.list({ fromDate: '2026-08-09' })).map(({ activityDate }) => activityDate),
    ['2026-08-10', '2026-08-09', '2026-08-09'],
    'from-date history filter',
  );
  assertDeepEqual(
    (await repository.list({ toDate: '2026-08-08' })).map(({ activityDate }) => activityDate),
    ['2026-08-08', '2026-08-07'],
    'to-date history filter',
  );
  assertDeepEqual(
    (await repository.list({ fromDate: '2026-08-08', toDate: '2026-08-09' }))
      .map(({ activityDate }) => activityDate),
    ['2026-08-09', '2026-08-09', '2026-08-08'],
    'combined history filters',
  );
  assertEqual((await repository.list({ limit: 2 })).length, 2, 'history limit');
  assertEqual((await repository.list({ limit: 0 })).length, 1, 'history limit clamps to minimum');
  assertEqual((await repository.list({ limit: 999 })).length, 5, 'history limit clamps to maximum');
  assertEqual(DEFAULT_LOCAL_PRAYER_HISTORY_LIMIT, 100, 'documented default history limit');
  assertEqual(MIN_LOCAL_PRAYER_HISTORY_LIMIT, 1, 'minimum history limit');
  assertEqual(MAX_LOCAL_PRAYER_HISTORY_LIMIT, 500, 'maximum history limit');

  await assertRepositoryError(
    () => repository.list({ fromDate: '2026-08-10', toDate: '2026-08-09' }),
    'invalid_input',
    'invalid history date range rejected',
  );
  assertReadLifecycleOrder(database, 'all-rows', 'all-row result lifecycle');
}

async function validateSummary() {
  const emptyRepository = createLocalPrayerRepository(
    createFakePrayerDatabase(),
    createSequentialDependencies(),
  );
  const empty = await emptyRepository.summary();
  assertEqual(empty.totalLogs, 0, 'empty summary total');
  assertEqual(empty.activeDays, 0, 'empty summary active days');
  assertEqual(empty.firstActivityDate, null, 'empty summary first date');
  assertEqual(empty.lastActivityDate, null, 'empty summary last date');
  assertDeepEqual(
    Object.keys(empty.countsByActivityType),
    PRAYER_ACTIVITY_TYPES,
    'empty summary includes every activity type',
  );
  assertEqual(
    Object.values(empty.countsByActivityType).every((count) => count === 0),
    true,
    'empty summary contains zero counts',
  );

  const repository = createLocalPrayerRepository(
    createFakePrayerDatabase(),
    createSequentialDependencies(),
  );
  await repository.record(createRecord('shacharit', '2026-08-07'));
  await repository.record(createRecord('mincha', '2026-08-08'));
  await repository.record(createRecord('maariv', '2026-08-08'));
  await repository.record(createRecord('shacharit', '2026-08-09'));

  const summary = await repository.summary();
  assertEqual(summary.totalLogs, 4, 'summary total logs');
  assertEqual(summary.activeDays, 3, 'summary active days');
  assertEqual(summary.firstActivityDate, '2026-08-07', 'summary first date');
  assertEqual(summary.lastActivityDate, '2026-08-09', 'summary last date');
  assertEqual(summary.countsByActivityType.shacharit, 2, 'summary activity count');
  assertEqual(summary.countsByActivityType.omer_count, 0, 'summary missing activity zero');

  const ranged = await repository.summary({ fromDate: '2026-08-08', toDate: '2026-08-08' });
  assertEqual(ranged.totalLogs, 2, 'summary date range total');
  assertEqual(ranged.activeDays, 1, 'summary date range active days');
  assertEqual(ranged.firstActivityDate, '2026-08-08', 'summary range first date');
  assertEqual(ranged.lastActivityDate, '2026-08-08', 'summary range last date');
}

async function validateDeletionAndCorruptionSafety() {
  const database = createFakePrayerDatabase();
  database.preferences.set('prayerStorageMode', 'local_only');
  const repository = createLocalPrayerRepository(database, createSequentialDependencies());
  const first = await repository.record(createRecord('shacharit', '2026-08-08'));
  await repository.record(createRecord('mincha', '2026-08-09'));

  assertEqual(await repository.deleteOne(first.localId), true, 'delete existing local row');
  assertEqual(await repository.deleteOne(first.localId), false, 'missing local identity returns false');

  database.rows.set('future-owner-id', createStoredRow({
    local_id: 'future-owner-id',
    owner_scope: 'account:synthetic',
    activity_type: 'maariv',
    activity_date: '2026-08-10',
  }));
  assertEqual(await repository.deleteAllGuestHistory(), 1, 'delete all reports guest deletion count');
  assertEqual(database.rows.has('future-owner-id'), true, 'future owner row preserved');
  assertEqual(
    database.preferences.get('prayerStorageMode'),
    'local_only',
    'preferences preserved by prayer deletion',
  );

  const corruptDatabase = createFakePrayerDatabase();
  corruptDatabase.rows.set('corrupt-id', createStoredRow({
    local_id: 'corrupt-id',
    metadata_json: '{malformed',
  }));
  const corruptRepository = createLocalPrayerRepository(
    corruptDatabase,
    createSequentialDependencies(),
  );
  await assertRepositoryError(
    () => corruptRepository.list(),
    'corrupt_data',
    'malformed stored JSON fails safely',
  );
  assertEqual(corruptDatabase.rows.size, 1, 'corrupt row is not wiped');
}

function validatePreparedSqlAndSourceBoundaries() {
  const sqlStatements = [
    SELECT_LOCAL_PRAYER_BY_DOMAIN_SQL,
    INSERT_LOCAL_PRAYER_SQL,
    UPDATE_LOCAL_PRAYER_SQL,
    DELETE_LOCAL_PRAYER_SQL,
    DELETE_ALL_GUEST_PRAYERS_SQL,
  ];
  assertEqual(
    sqlStatements.every((sql) => sql.includes('?')),
    true,
    'repository SQL uses bound parameters',
  );

  const source = fs.readFileSync(
    path.join(repoRoot, 'src/local-data/prayerRepository.ts'),
    'utf8',
  );
  const forbiddenRuntimeReferences = [
    'apiClient',
    'prayerTrackerService',
    'prayerTrackerApiService',
    'useAuthStore',
    'apiAuthTokenStore',
    '/me/prayer-logs',
  ];

  for (const reference of forbiddenRuntimeReferences) {
    assertEqual(source.includes(reference), false, `network boundary ${reference}`);
  }

  assertEqual(source.includes('console.'), false, 'repository has no payload logging');
  assertEqual(
    source.includes('initializeLocalDatabase'),
    true,
    'repository uses encrypted database initializer',
  );
  assertEqual(source.includes('openDatabaseAsync'), false, 'repository opens no independent database');
}

function createRecord(activityType, activityDate) {
  return {
    activityType,
    activityDate,
    completedAt: `${activityDate}T12:00:00Z`,
    metadata: { fixture: true },
  };
}

function createSequentialDependencies() {
  let id = 0;
  let time = 0;

  return {
    createLocalId() {
      id += 1;
      return `20000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
    },
    now() {
      time += 1;
      return new Date(Date.UTC(2026, 7, 9, 0, 0, time)).toISOString();
    },
  };
}

function createClock(values) {
  return () => {
    const value = values.shift();

    if (!value) {
      throw new Error('synthetic clock exhausted');
    }

    return value;
  };
}

function createStoredRow(overrides = {}) {
  return {
    local_id: '30000000-0000-4000-8000-000000000001',
    owner_scope: LOCAL_PRAYER_OWNER_SCOPE,
    activity_type: 'shacharit',
    activity_date: '2026-08-09',
    started_at: null,
    completed_at: '2026-08-09T12:00:00.000Z',
    timezone: 'Europe/Moscow',
    city: null,
    hebrew_date_json: '{}',
    metadata_json: '{}',
    created_at: '2026-08-09T12:00:00.000Z',
    updated_at: '2026-08-09T12:00:00.000Z',
    sync_state: 'local_only',
    synced_user_id: null,
    server_id: null,
    last_sync_error_code: null,
    ...overrides,
  };
}

function createFakePrayerDatabase() {
  const database = createDatabaseContext(new Map());
  database.preferences = new Map();
  database.transactionCount = 0;
  database.withExclusiveTransactionAsync = async (task) => {
    database.transactionCount += 1;
    const transactionRows = cloneRowMap(database.rows);
    const transaction = createDatabaseContext(transactionRows, database);
    await task(transaction);
    database.rows.clear();

    for (const [id, row] of transactionRows) {
      database.rows.set(id, row);
    }
  };
  return database;
}

function createDatabaseContext(rows, counters) {
  const context = {
    rows,
    preparedStatementCount: 0,
    finalizedStatementCount: 0,
    resultLifecycleEvents: [],
    resultLifecycleViolations: 0,
    async prepareAsync(sql) {
      const target = counters ?? context;
      target.preparedStatementCount += 1;
      const statementId = target.preparedStatementCount;
      let finalized = false;
      let activeResultReads = 0;

      async function readResult(kind, read) {
        activeResultReads += 1;
        target.resultLifecycleEvents.push({ event: 'read-started', kind, statementId });

        try {
          await Promise.resolve();

          if (finalized) {
            target.resultLifecycleViolations += 1;
            throw new Error('synthetic result read after statement finalization');
          }

          const value = await read();
          target.resultLifecycleEvents.push({ event: 'read-completed', kind, statementId });
          return value;
        } finally {
          activeResultReads -= 1;
        }
      }

      return {
        async executeAsync(parameters) {
          if (finalized) {
            throw new Error('synthetic statement already finalized');
          }

          const result = executeSyntheticSql(rows, sql, parameters);
          target.resultLifecycleEvents.push({ event: 'executed', statementId });

          return {
            changes: result.changes,
            getFirstAsync() {
              return readResult('first-row', () => result.getFirstAsync());
            },
            getAllAsync() {
              return readResult('all-rows', () => result.getAllAsync());
            },
          };
        },
        async finalizeAsync() {
          if (activeResultReads > 0) {
            target.resultLifecycleViolations += 1;
            throw new Error('synthetic statement finalized before result read completed');
          }

          if (!finalized) {
            finalized = true;
            target.finalizedStatementCount += 1;
            target.resultLifecycleEvents.push({ event: 'finalized', statementId });
          }
        },
      };
    },
  };
  return context;
}

function executeSyntheticSql(rows, sql, parameters) {
  let resultRows = [];
  let changes = 0;

  if (/INSERT INTO local_prayer_logs/.test(sql)) {
    const row = Object.fromEntries([
      'local_id',
      'owner_scope',
      'activity_type',
      'activity_date',
      'started_at',
      'completed_at',
      'timezone',
      'city',
      'hebrew_date_json',
      'metadata_json',
      'created_at',
      'updated_at',
      'sync_state',
      'synced_user_id',
      'server_id',
      'last_sync_error_code',
    ].map((column, index) => [column, parameters[index]]));

    const duplicate = [...rows.values()].some((existing) => (
      existing.owner_scope === row.owner_scope
      && existing.activity_date === row.activity_date
      && existing.activity_type === row.activity_type
    ));

    if (duplicate) throw new Error('synthetic uniqueness violation');
    rows.set(row.local_id, row);
    changes = 1;
  } else if (/UPDATE local_prayer_logs/.test(sql)) {
    const [
      startedAt,
      completedAt,
      timezone,
      city,
      hebrewDateJson,
      metadataJson,
      updatedAt,
      localId,
      ownerScope,
    ] = parameters;
    const row = rows.get(localId);

    if (row && row.owner_scope === ownerScope) {
      Object.assign(row, {
        started_at: startedAt,
        completed_at: completedAt,
        timezone,
        city,
        hebrew_date_json: hebrewDateJson,
        metadata_json: metadataJson,
        updated_at: updatedAt,
      });
      changes = 1;
    }
  } else if (/DELETE FROM local_prayer_logs/.test(sql)) {
    if (/local_id = \?/.test(sql)) {
      const [localId, ownerScope] = parameters;
      const row = rows.get(localId);

      if (row?.owner_scope === ownerScope) {
        rows.delete(localId);
        changes = 1;
      }
    } else {
      const [ownerScope] = parameters;

      for (const [localId, row] of [...rows]) {
        if (row.owner_scope === ownerScope) {
          rows.delete(localId);
          changes += 1;
        }
      }
    }
  } else if (/COUNT\(DISTINCT activity_date\)/.test(sql)) {
    const filtered = filterRows(rows, sql, parameters);
    const dates = filtered.map(({ activity_date }) => activity_date).sort();
    resultRows = [{
      total_logs: filtered.length,
      active_days: new Set(dates).size,
      first_activity_date: dates[0] ?? null,
      last_activity_date: dates.at(-1) ?? null,
    }];
  } else if (/GROUP BY activity_type/.test(sql)) {
    const counts = new Map();

    for (const row of filterRows(rows, sql, parameters)) {
      counts.set(row.activity_type, (counts.get(row.activity_type) ?? 0) + 1);
    }

    resultRows = [...counts].map(([activity_type, activity_count]) => ({
      activity_type,
      activity_count,
    }));
  } else if (/ORDER BY activity_date DESC, created_at DESC/.test(sql)) {
    const limit = parameters.at(-1);
    resultRows = filterRows(rows, sql, parameters.slice(0, -1))
      .sort((left, right) => (
        right.activity_date.localeCompare(left.activity_date)
        || right.created_at.localeCompare(left.created_at)
      ))
      .slice(0, limit);
  } else if (/activity_date = \? AND activity_type = \?/.test(sql)) {
    const [ownerScope, activityDate, activityType] = parameters;
    const row = [...rows.values()].find((candidate) => (
      candidate.owner_scope === ownerScope
      && candidate.activity_date === activityDate
      && candidate.activity_type === activityType
    ));
    resultRows = row ? [{ ...row }] : [];
  } else {
    throw new Error('unexpected SQL in local prayer validator');
  }

  return {
    changes,
    async getFirstAsync() {
      return resultRows[0] ? { ...resultRows[0] } : null;
    },
    async getAllAsync() {
      return resultRows.map((row) => ({ ...row }));
    },
  };
}

function filterRows(rows, sql, parameters) {
  let parameterIndex = 0;
  const ownerScope = parameters[parameterIndex++];
  const fromDate = /activity_date >= \?/.test(sql)
    ? parameters[parameterIndex++]
    : null;
  const toDate = /activity_date <= \?/.test(sql)
    ? parameters[parameterIndex++]
    : null;

  return [...rows.values()]
    .filter((row) => row.owner_scope === ownerScope)
    .filter((row) => !fromDate || row.activity_date >= fromDate)
    .filter((row) => !toDate || row.activity_date <= toDate)
    .map((row) => ({ ...row }));
}

function cloneRowMap(rows) {
  return new Map([...rows].map(([id, row]) => [id, { ...row }]));
}

function assertReadLifecycleOrder(database, kind, description) {
  const completedReads = database.resultLifecycleEvents.filter((event) => (
    event.event === 'read-completed' && event.kind === kind
  ));

  assertEqual(completedReads.length > 0, true, `${description} exercised`);
  assertEqual(database.resultLifecycleViolations, 0, `${description} has no ordering violation`);

  for (const completedRead of completedReads) {
    const executeIndex = database.resultLifecycleEvents.findIndex((event) => (
      event.event === 'executed' && event.statementId === completedRead.statementId
    ));
    const completedIndex = database.resultLifecycleEvents.indexOf(completedRead);
    const finalizeIndex = database.resultLifecycleEvents.findIndex((event) => (
      event.event === 'finalized' && event.statementId === completedRead.statementId
    ));

    assertEqual(
      executeIndex < completedIndex && completedIndex < finalizeIndex,
      true,
      `${description} execute-read-finalize order`,
    );
  }
}

async function assertRepositoryError(action, expectedCode, description) {
  let received = null;

  try {
    await action();
  } catch (error) {
    received = error;
  }

  assertEqual(received instanceof LocalPrayerRepositoryError, true, description);
  assertEqual(received?.code, expectedCode, `${description} error code`);
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(
      `Local prayer validation failed for ${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertDeepEqual(actual, expected, description) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), description);
}

function registerNativeModuleStubs() {
  const originalLoad = Module._load;

  Module._load = function loadWithNativeStubs(request, parent, isMain) {
    if (request === 'expo-crypto') {
      return {
        async getRandomBytesAsync() {
          return new Uint8Array(32);
        },
        randomUUID() {
          return '40000000-0000-4000-8000-000000000001';
        },
      };
    }

    if (request === 'expo-secure-store') {
      return {
        async getItemAsync() {
          return null;
        },
        async isAvailableAsync() {
          return true;
        },
      };
    }

    if (request === 'expo-file-system') {
      return {
        File: class FakeFile {
          exists = false;
        },
      };
    }

    if (request === 'expo-sqlite') {
      return {
        defaultDatabaseDirectory: '',
        async openDatabaseAsync() {
          throw new Error('native database is not opened by this validator');
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };
}

function registerTypeScriptRequireHook() {
  Module._extensions['.ts'] = function compileTypeScriptModule(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    });

    module._compile(outputText, filename);
  };
}
