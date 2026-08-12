#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const npmCliPath = process.env.npm_execpath;

if (!npmCliPath) {
  console.error(
    'Web registration parity guard must be launched with "npm run check:web-registration-parity".',
  );
  process.exit(1);
}

function runStep(name, command, args) {
  console.log(`\n[web-registration-parity] Running ${name}`);

  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(
      `[web-registration-parity] Failed: ${name}: ${result.error.message}`,
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    const reason = result.signal
      ? `terminated by ${result.signal}`
      : `exited with code ${String(result.status)}`;
    console.error(`[web-registration-parity] Failed: ${name}: ${reason}`);
    process.exit(result.status ?? 1);
  }

  console.log(`[web-registration-parity] Passed: ${name}`);
}

console.log('\n[web-registration-parity] Running permanent backend mode support');
const eventsSource = readFileSync(
  path.join(repositoryRoot, 'apps', 'api', 'app', 'services', 'events.py'),
  'utf8',
);

const removedIdentifiers = [
  ['API_PUBLIC_WEB_PAID_', 'REGISTRATION_ENABLED'].join(''),
  ['api_public_web_paid_', 'registration_enabled'].join(''),
];
for (const identifier of removedIdentifiers) {
  const result = spawnSync(
    'git',
    ['grep', '-n', '--fixed-strings', identifier, '--', '.'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  );
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    console.error(
      `[web-registration-parity] Failed to scan for removed identifier: ${identifier}`,
    );
    process.exit(result.status ?? 1);
  }
  if (result.status === 0) {
    console.error(result.stdout.trim());
    console.error(
      `[web-registration-parity] Failed: removed identifier is still present: ${identifier}`,
    );
    process.exit(1);
  }
}

const permanentModes =
  /WEB_REGISTRATION_MODES\s*=\s*\(\s*FREE_WEB_REGISTRATION_MODE,\s*PAID_WEB_REGISTRATION_MODE,\s*\)/s;
const dynamicModeHelper = ['_available_web_', 'registration_modes'].join('');
if (!permanentModes.test(eventsSource)) {
  console.error(
    '[web-registration-parity] Failed: backend modes do not permanently include internal_free and internal_paid.',
  );
  process.exit(1);
}
if (
  eventsSource.includes(dynamicModeHelper) ||
  !/event\.registration_mode in WEB_REGISTRATION_MODES/.test(eventsSource) ||
  !/Event\.registration_mode\.in_\(WEB_REGISTRATION_MODES\)/.test(eventsSource)
) {
  console.error(
    '[web-registration-parity] Failed: public availability checks do not share the permanent mode list.',
  );
  process.exit(1);
}
console.log('[web-registration-parity] Passed: both backend modes are always enabled');

runStep(
  'public web option, totals, currency, request, and result regressions',
  process.execPath,
  [
    npmCliPath,
    '--prefix',
    'apps/web',
    'run',
    'test',
    '--',
    'src/App.test.tsx',
    'src/api.test.ts',
  ],
);

runStep(
  'canonical backend publication, intent, tampering, capacity, snapshot, and replay regressions',
  'docker',
  [
    'compose',
    '-f',
    'infra/docker-compose.api.yml',
    'run',
    '--rm',
    'api_backend',
    'pytest',
    '-q',
    'tests/test_web_event_publication.py',
    'tests/test_web_registration_intents.py',
    'tests/test_web_registration_email_finalize.py',
  ],
);

console.log('\nWeb registration parity guard passed (3 mandatory steps).');
