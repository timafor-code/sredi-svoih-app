#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const npmCliPath = process.env.npm_execpath;

const guards = [
  ['App capabilities', 'validate:app-capabilities'],
  ['Guest runtime, routes, Events, auth, and contacts', 'validate:guest-runtime-boundaries'],
  ['Guest Settings shell', 'validate:guest-settings-shell'],
  ['Local prayer and notification settings', 'validate:local-prayer-notification-settings'],
  ['Prayer provider selection', 'validate:prayer-provider'],
  ['Guest prayer actions', 'validate:guest-prayer-actions'],
  ['Guest prayer history', 'validate:guest-prayer-history'],
  ['Guest event registration boundary', 'validate:guest-event-registration-boundary'],
  ['Local preferences and legacy migration', 'validate:local-preferences'],
  ['Local prayer repository', 'validate:local-prayer-repository'],
  ['Encrypted local-data foundation', 'validate:local-data-foundation'],
  ['Home parsha content', 'validate:parsha-content'],
];

if (!npmCliPath) {
  console.error(
    'Mobile guest release gate must be launched with "npm run check:mobile-guest-release".',
  );
  process.exit(1);
}

const failures = [];

for (const [name, packageScript] of guards) {
  console.log(`\n[mobile-guest-release] Running ${name} (${packageScript})`);

  const result = spawnSync(
    process.execPath,
    [npmCliPath, 'run', packageScript],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
    },
  );

  if (result.error) {
    failures.push({
      name,
      packageScript,
      reason: result.error.message,
    });
    continue;
  }

  if (result.status !== 0) {
    failures.push({
      name,
      packageScript,
      reason: result.signal
        ? `terminated by ${result.signal}`
        : `exited with code ${String(result.status)}`,
    });
    continue;
  }

  console.log(`[mobile-guest-release] Passed: ${name}`);
}

if (failures.length > 0) {
  console.error('\nMobile guest release gate failed:');

  for (const failure of failures) {
    console.error(
      `- ${failure.name} (${failure.packageScript}): ${failure.reason}`,
    );
  }

  process.exitCode = 1;
} else {
  console.log(`\nMobile guest release gate passed (${guards.length} mandatory guards).`);
}
