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

console.log('\n[web-registration-parity] Running production paid-gate default');
const configSource = readFileSync(
  path.join(repositoryRoot, 'apps', 'api', 'app', 'core', 'config.py'),
  'utf8',
);
if (
  !/api_public_web_paid_registration_enabled\s*:\s*bool\s*=\s*False\b/.test(
    configSource,
  )
) {
  console.error(
    '[web-registration-parity] Failed: production paid-gate default is not false.',
  );
  process.exit(1);
}
console.log(
  '[web-registration-parity] Passed: production paid-gate default remains false',
);

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
