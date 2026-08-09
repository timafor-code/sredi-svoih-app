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

registerTypeScriptRequireHook();

const {
  parseAppAccessMode,
  parseEventRegistrationMode,
  resolveAppCapabilities,
} = require(path.join(repoRoot, 'src/config/appCapabilities.ts'));

const accessCases = [
  ['guest_only', 'guest_only', 'guest mode'],
  ['account', 'account', 'account mode'],
  [undefined, 'guest_only', 'missing access mode'],
  ['', 'guest_only', 'empty access mode'],
  ['unknown', 'guest_only', 'unknown access mode'],
  ['ACCOUNT', 'guest_only', 'incorrectly cased access mode'],
];

const eventRegistrationCases = [
  ['disabled', 'disabled', 'disabled registration'],
  ['public_web', 'public_web', 'public web registration'],
  ['account', 'account', 'account registration'],
  [undefined, 'disabled', 'missing registration mode'],
  ['', 'disabled', 'empty registration mode'],
  ['unknown', 'disabled', 'unknown registration mode'],
  ['PUBLIC_WEB', 'disabled', 'incorrectly cased registration mode'],
];

const combinationCases = [
  ['guest_only', 'disabled', false, false, false],
  ['guest_only', 'public_web', false, true, false],
  ['guest_only', 'account', false, false, false],
  ['account', 'disabled', true, false, false],
  ['account', 'public_web', true, true, false],
  ['account', 'account', true, false, true],
];

for (const [value, expected, description] of accessCases) {
  assertEqual(parseAppAccessMode(value), expected, description);
}

for (const [value, expected, description] of eventRegistrationCases) {
  assertEqual(parseEventRegistrationMode(value), expected, description);
}

for (const [
  appAccessMode,
  eventRegistrationMode,
  canUseAccountFeatures,
  canUsePublicWebEventRegistration,
  canUseInternalAccountEventRegistration,
] of combinationCases) {
  const capabilities = resolveAppCapabilities(appAccessMode, eventRegistrationMode);
  const description = `${appAccessMode} + ${eventRegistrationMode}`;

  assertEqual(capabilities.appAccessMode, appAccessMode, `${description} access mode`);
  assertEqual(
    capabilities.eventRegistrationMode,
    eventRegistrationMode,
    `${description} registration mode`,
  );
  assertEqual(
    capabilities.isGuestOnly,
    appAccessMode === 'guest_only',
    `${description} guest state`,
  );
  assertEqual(
    capabilities.isAccountMode,
    appAccessMode === 'account',
    `${description} account state`,
  );
  assertEqual(
    capabilities.canUseAccountFeatures,
    canUseAccountFeatures,
    `${description} account features`,
  );
  assertEqual(
    capabilities.canUsePublicWebEventRegistration,
    canUsePublicWebEventRegistration,
    `${description} public web registration`,
  );
  assertEqual(
    capabilities.canUseInternalAccountEventRegistration,
    canUseInternalAccountEventRegistration,
    `${description} internal account registration`,
  );
  assertEqual(Object.isFrozen(capabilities), true, `${description} immutability`);
}

const failClosedCapabilities = resolveAppCapabilities(undefined, undefined);
assertEqual(
  failClosedCapabilities.appAccessMode,
  'guest_only',
  'missing values resolve to guest mode',
);
assertEqual(
  failClosedCapabilities.eventRegistrationMode,
  'disabled',
  'missing values disable registration',
);

const malformedValues = [
  'ACCOUNT',
  'Guest',
  'true',
  '1',
  'enabled',
  'public',
  'web',
  'account_mode',
];

for (const malformedValue of malformedValues) {
  const invalidAccess = resolveAppCapabilities(malformedValue, 'account');
  assertEqual(
    invalidAccess.canUseAccountFeatures,
    false,
    `invalid access "${malformedValue}" account features`,
  );
  assertEqual(
    invalidAccess.canUseInternalAccountEventRegistration,
    false,
    `invalid access "${malformedValue}" internal registration`,
  );

  const invalidRegistration = resolveAppCapabilities('account', malformedValue);
  assertEqual(
    invalidRegistration.canUsePublicWebEventRegistration,
    false,
    `invalid registration "${malformedValue}" public web registration`,
  );
  assertEqual(
    invalidRegistration.canUseInternalAccountEventRegistration,
    false,
    `invalid registration "${malformedValue}" internal registration`,
  );
}

console.log(
  `App capability validation passed (${accessCases.length} access cases, ${eventRegistrationCases.length} registration cases, ${combinationCases.length} combinations)`,
);

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    console.error(
      `App capability validation failed for ${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
    process.exit(1);
  }
}

function registerTypeScriptRequireHook() {
  Module._extensions['.ts'] = function compileTypeScriptModule(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filename,
    });

    module._compile(outputText, filename);
  };
}
