import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import pg from 'pg';

import {
  POSTGRES_DATE_OID,
  normalizeForJson,
  parsePostgresDate,
} from '../export_supabase_data.mjs';

const EXPORTER_URL = new URL('../export_supabase_data.mjs', import.meta.url).href;
const DATE_VALUES = ['2024-01-01', '2024-02-29', '2024-12-31'];

function parseDatesInTimezone(timezone) {
  const program = `
    import pg from 'pg';
    import { POSTGRES_DATE_OID } from ${JSON.stringify(EXPORTER_URL)};
    const parseDate = pg.types.getTypeParser(POSTGRES_DATE_OID, 'text');
    process.stdout.write(JSON.stringify(${JSON.stringify(DATE_VALUES)}.map(parseDate)));
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', program],
    {
      encoding: 'utf8',
      env: { ...process.env, TZ: timezone },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('PostgreSQL DATE parser preserves source YYYY-MM-DD text', () => {
  const parser = pg.types.getTypeParser(POSTGRES_DATE_OID, 'text');

  for (const dateValue of DATE_VALUES) {
    assert.equal(parsePostgresDate(dateValue), dateValue);
    assert.equal(parser(dateValue), dateValue);
    assert.equal(normalizeForJson(parser(dateValue), 'synthetic.date'), dateValue);
  }
});

test('PostgreSQL DATE parser is timezone-independent in UTC and Europe/Moscow', () => {
  const utcDates = parseDatesInTimezone('UTC');
  const moscowDates = parseDatesInTimezone('Europe/Moscow');

  assert.deepEqual(utcDates, DATE_VALUES);
  assert.deepEqual(moscowDates, DATE_VALUES);
  assert.deepEqual(moscowDates, utcDates);
});

test('timestamps continue to serialize as ISO timestamps', () => {
  const timestamp = new Date('2024-02-29T23:59:59.123Z');

  assert.equal(
    normalizeForJson(timestamp, 'synthetic.timestamp'),
    '2024-02-29T23:59:59.123Z',
  );
});
