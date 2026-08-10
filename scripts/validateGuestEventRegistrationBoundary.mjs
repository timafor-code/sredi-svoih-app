#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const Module = require('node:module');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

registerTypeScriptRequireHook();
registerSourceAliasResolver();

validateCapabilityMatrix();
validateCentralRouteBoundary();
validateEventDetailBoundary();
validateRegistrationActionBoundary();
validateRegistrationScreenDefense('app/events/register/[id].tsx');
validateRegistrationScreenDefense('app/events/paid-options.tsx');
await validatePublicWebAdapter();
validateNoFrontendUrlConstruction();

console.log('Guest event registration boundary validation passed');

function validateCapabilityMatrix() {
  const { resolveAppCapabilities } = require(sourcePath('src/config/appCapabilities.ts'));
  const guestDisabled = resolveAppCapabilities('guest_only', 'disabled');
  const accountAccount = resolveAppCapabilities('account', 'account');
  const guestPublicWeb = resolveAppCapabilities('guest_only', 'public_web');
  const accountPublicWeb = resolveAppCapabilities('account', 'public_web');

  assertEqual(
    guestDisabled.canUseInternalAccountEventRegistration,
    false,
    'guest + disabled rejects internal registration',
  );
  assertEqual(
    accountAccount.canUseInternalAccountEventRegistration,
    true,
    'account + account preserves internal registration',
  );
  assertEqual(
    guestPublicWeb.canUsePublicWebEventRegistration,
    true,
    'guest public_web exposes only the public-web capability',
  );
  assertEqual(
    guestPublicWeb.canUseInternalAccountEventRegistration,
    false,
    'guest public_web does not enable account registration',
  );
  assertEqual(
    accountPublicWeb.canUseInternalAccountEventRegistration,
    false,
    'account public_web does not enable account registration',
  );
}

function validateCentralRouteBoundary() {
  const layoutSource = readSource('app/_layout.tsx');
  const routeGuardSource = readSource('src/navigation/guestRouteGuard.ts');
  const {
    isInternalEventRegistrationBlockedPathname,
  } = require(sourcePath('src/navigation/guestRouteGuard.ts'));
  const { resolveAppCapabilities } = require(sourcePath('src/config/appCapabilities.ts'));
  const guestDisabled = resolveAppCapabilities('guest_only', 'disabled');
  const accountDisabled = resolveAppCapabilities('account', 'disabled');
  const accountPublicWeb = resolveAppCapabilities('account', 'public_web');
  const accountAccount = resolveAppCapabilities('account', 'account');
  const internalPaths = [
    '/events/register/event-id',
    '/events/paid-occurrences',
    '/events/paid-options',
    '/modals/event-registration',
  ];

  for (const pathname of internalPaths) {
    assertEqual(
      isInternalEventRegistrationBlockedPathname(pathname, guestDisabled),
      true,
      `guest disabled blocks ${pathname}`,
    );
    assertEqual(
      isInternalEventRegistrationBlockedPathname(pathname, accountDisabled),
      true,
      `account disabled blocks ${pathname}`,
    );
    assertEqual(
      isInternalEventRegistrationBlockedPathname(pathname, accountPublicWeb),
      true,
      `account public_web blocks ${pathname}`,
    );
    assertEqual(
      isInternalEventRegistrationBlockedPathname(pathname, accountAccount),
      false,
      `account registration allows ${pathname}`,
    );
  }

  assertEqual(
    isInternalEventRegistrationBlockedPathname('/events/event-id', guestDisabled),
    false,
    'guest event detail remains reachable',
  );
  assertIncludes(
    layoutSource,
    '<Stack.Protected guard={appCapabilities.canUseInternalAccountEventRegistration}>',
    'root uses the dedicated registration capability guard',
  );
  assertIncludes(
    layoutSource,
    'INTERNAL_EVENT_REGISTRATION_ROUTE_NAMES.map',
    'root uses centralized registration route names',
  );
  for (const routeName of [
    'events/register/[id]',
    'events/paid-occurrences',
    'events/paid-options',
    'modals/event-registration',
  ]) {
    assertIncludes(
      routeGuardSource,
      `'${routeName}'`,
      `central registration route list includes ${routeName}`,
    );
  }
  assertIncludes(
    layoutSource,
    '<Stack.Screen name="events/[id]"',
    'public event detail remains outside registration protection',
  );
}

function validateEventDetailBoundary() {
  const source = readSource('app/events/[id].tsx');
  const registrationBlock = sourceBetween(
    source,
    'function RegistrationBlock(',
    'export default function EventDetailScreen()',
    'event detail registration block',
  );
  const unavailableIndex = registrationBlock.indexOf(
    '!appCapabilities.canUseInternalAccountEventRegistration',
  );
  const loginIndex = registrationBlock.indexOf('if (!hasSession)');

  assertTrue(unavailableIndex >= 0, 'event detail has an internal capability boundary');
  assertTrue(loginIndex > unavailableIndex, 'neutral capability state precedes account login state');
  assertIncludes(
    registrationBlock,
    'INTERNAL_EVENT_REGISTRATION_UNAVAILABLE_TEXT',
    'event detail renders neutral unavailable copy',
  );
  assertExcludes(source, 'const loadSession =', 'event detail has no session bootstrap selector');
  assertExcludes(source, 'loadSession()', 'event detail has no session bootstrap call');
  assertIncludes(
    source,
    'if (!appCapabilities.canUseInternalAccountEventRegistration || !authUser)',
    'event detail gates my registrations by capability',
  );
  assertIncludes(
    source,
    "if (event.registrationMode === 'external_link')",
    'external-link behavior remains separate',
  );
  assertIncludes(source, "if (event.registrationMode === 'none')", 'registration none behavior remains');
}

function validateRegistrationActionBoundary() {
  const source = readSource('src/hooks/useEventRegistrationAction.ts');
  const action = sourceBetween(
    source,
    'const handleRegistrationAction = useCallback',
    'const handleCancelRegistration = useCallback',
    'registration action callback',
  );
  const capabilityIndex = action.indexOf(
    '!appCapabilities.canUseInternalAccountEventRegistration',
  );
  const switchIndex = action.indexOf('switch (event.registrationMode)');
  const authIndex = action.indexOf('if (!authUser)');
  const mutationIndex = action.indexOf('await registerForEvent(event.id)');

  assertTrue(capabilityIndex >= 0, 'registration action checks the capability');
  assertTrue(switchIndex > capabilityIndex, 'registration action capability check precedes mode handling');
  assertTrue(authIndex > capabilityIndex, 'registration action capability check precedes auth handling');
  assertTrue(mutationIndex > capabilityIndex, 'registration action capability check precedes mutation');
  assertIncludes(
    action,
    'getPublicWebEventRegistrationTarget(event.id)',
    'public_web routes through the focused adapter',
  );
  assertIncludes(
    action,
    "case 'external_link':",
    'external link remains an event-level path',
  );
  assertIncludes(action, 'event.registrationUrl', 'external link keeps the published event URL contract');
  assertIncludes(action, "case 'none':", 'registration none remains explicit');

  const cancellation = sourceBetween(
    source,
    'const handleCancelRegistration = useCallback',
    'return {',
    'registration cancellation callback',
  );
  assertTrue(
    cancellation.indexOf('!appCapabilities.canUseInternalAccountEventRegistration')
      < cancellation.indexOf('await cancelRegistration(registration.id)'),
    'cancellation capability check precedes mutation',
  );
}

function validateRegistrationScreenDefense(relativePath) {
  const source = readSource(relativePath);
  const loadData = sourceBetween(
    source,
    'const loadData = useCallback',
    'useEffect(() => {',
    `${relativePath} loader`,
  );
  const submit = sourceBetween(
    source,
    'const submitRegistration = useCallback',
    'const handleContinue = useCallback',
    `${relativePath} submit`,
  );

  assertTrue(
    loadData.indexOf('!appCapabilities.canUseInternalAccountEventRegistration')
      < loadData.indexOf('Promise.all'),
    `${relativePath} capability check precedes workflow loaders`,
  );
  assertTrue(
    submit.indexOf('!appCapabilities.canUseInternalAccountEventRegistration')
      < submit.indexOf('registerForPaidEventSimulated'),
    `${relativePath} capability check precedes paid mutation`,
  );
  assertIncludes(
    source,
    'if (!appCapabilities.canUseInternalAccountEventRegistration || !authUser)',
    `${relativePath} gates my registrations`,
  );
  assertIncludes(
    source,
    'INTERNAL_EVENT_REGISTRATION_UNAVAILABLE_TEXT',
    `${relativePath} renders neutral unavailable state`,
  );
}

async function validatePublicWebAdapter() {
  const adapter = require(sourcePath('src/services/publicWebEventRegistrationService.ts'));
  const source = readSource('src/services/publicWebEventRegistrationService.ts');

  assertEqual(
    await adapter.getPublicWebEventRegistrationTarget('event-id'),
    null,
    'public_web adapter fails closed without a trusted backend target',
  );
  assertExcludes(source, 'event.registrationUrl', 'public_web adapter does not reuse event registrationUrl');
  assertExcludes(source, 'registration_url', 'public_web adapter does not reuse the event URL field');
  assertExcludes(source, 'PUBLIC_WEB_BASE_URL', 'public_web adapter does not expose backend URL config');
}

function validateNoFrontendUrlConstruction() {
  const frontendFiles = [
    'app/_layout.tsx',
    'app/events/[id].tsx',
    'app/events/register/[id].tsx',
    'app/events/paid-options.tsx',
    'src/config/appCapabilities.ts',
    'src/hooks/useEventRegistrationAction.ts',
    'src/navigation/guestRouteGuard.ts',
    'src/services/publicWebEventRegistrationService.ts',
  ];

  for (const relativePath of frontendFiles) {
    const source = readSource(relativePath);
    assertEqual(
      /https?:\/\//i.test(source),
      false,
      `${relativePath} has no hardcoded registration origin`,
    );
  }
}

function sourceBetween(source, startMarker, endMarker, description) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assertTrue(start >= 0, `${description} start marker exists`);
  assertTrue(end > start, `${description} end marker exists`);
  return source.slice(start, end);
}

function readSource(relativePath) {
  return fs.readFileSync(sourcePath(relativePath), 'utf8');
}

function sourcePath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function assertIncludes(source, expected, description) {
  assertEqual(source.includes(expected), true, description);
}

function assertExcludes(source, forbidden, description) {
  assertEqual(source.includes(forbidden), false, description);
}

function assertTrue(value, description) {
  assertEqual(Boolean(value), true, description);
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function registerSourceAliasResolver() {
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveSourceAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      const source = path.join(repoRoot, 'src', request.slice(2));
      return originalResolveFilename.call(this, source, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
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
