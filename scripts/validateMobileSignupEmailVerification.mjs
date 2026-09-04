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

const files = {
  authApiService: source('src/services/authApiService.ts'),
  authService: source('src/services/authService.ts'),
  authStore: source('src/store/useAuthStore.ts'),
  signUpForm: source('src/components/auth/EmailSignUpForm.tsx'),
  signInForm: source('src/components/auth/EmailSignInForm.tsx'),
  verificationForm: source('src/components/auth/EmailVerificationCodeForm.tsx'),
};

validateSignupDoesNotAutoLogin();
validateConfirmWiring();
validateStoreWiring();
validateRecoveryWiring();
await validateServiceRequests();

process.stdout.write('Mobile signup email verification validation passed\n');

function validateSignupDoesNotAutoLogin() {
  const signUpWithEmail = extractBetween(
    files.authApiService,
    'export async function signUpWithEmail(',
    '\nexport async function confirmEmailVerification',
  );

  assertExcludes(signUpWithEmail, "'/auth/login'", 'signup does not call /auth/login');
  assertExcludes(signUpWithEmail, 'setApiAuthTokens', 'signup does not store auth tokens before verification');
  assertIncludes(signUpWithEmail, 'session: null', 'signup returns a null session pending confirmation');
  assertIncludes(signUpWithEmail, 'needsEmailConfirmation: true', 'signup reports pending confirmation');
  assertIncludes(signUpWithEmail, "'/auth/register'", 'signup still registers the account');
}

function validateConfirmWiring() {
  assertIncludes(files.authApiService, 'export async function confirmEmailVerification', 'authApiService exposes confirmEmailVerification');
  assertIncludes(files.authApiService, "'/auth/confirm-email-verification'", 'confirm calls the existing confirm endpoint');
  assertIncludes(files.authService, 'confirmEmailVerification', 'authService re-exports confirmEmailVerification');
}

function validateStoreWiring() {
  assertIncludes(files.authStore, 'confirmEmailVerification: async (code: string)', 'store exposes a confirmEmailVerification action');
  assertIncludes(files.authStore, 'confirmEmailVerificationService(code)', 'store action calls the confirm service');
}

function validateRecoveryWiring() {
  const verificationSubmit = extractBetween(
    files.verificationForm,
    'const handleSubmit = useCallback(async () => {',
    '}, [code, confirmEmailVerification, email, onVerified, password, signIn]);',
  );

  assertIncludes(verificationSubmit, 'await confirmEmailVerification(trimmedCode)', 'code is confirmed before login');
  assertIncludes(verificationSubmit, 'await signIn(email, password)', 'verification logs in with the held credentials');
  assertBefore(verificationSubmit, 'await confirmEmailVerification(trimmedCode)', 'await signIn(email, password)', 'confirmation happens before login');
  assertIncludes(verificationSubmit, "setCode('')", 'verification code is cleared from memory after use');

  assertIncludes(files.signInForm, 'AUTH_ERROR_MESSAGES.emailNotConfirmed', 'sign-in recovers specifically on the email-not-confirmed error');
  assertIncludes(files.signInForm, 'setPendingVerification({ email: normalizedEmail, password })', 'sign-in recovery keeps credentials only in memory');
  assertIncludes(files.signInForm, 'EmailVerificationCodeForm', 'sign-in reuses the shared verification form for recovery');
  assertIncludes(files.signInForm, 'setLocalError(message)', 'a generic sign-in failure still surfaces as a normal error');

  assertIncludes(files.signUpForm, 'EmailVerificationCodeForm', 'signup reuses the shared verification form');
  assertExcludes(files.signUpForm, 'Проверьте почту', 'signup no longer shows the passive placeholder confirmation state');
}

async function validateServiceRequests() {
  const calls = [];
  const storedTokenCalls = [];
  const responses = {
    '/auth/register': {
      user: {
        id: 'user-1',
        email: 'signup@example.invalid',
        phone: null,
        status: 'active',
        email_verified_at: null,
        phone_verified_at: null,
        last_login_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      profile: null,
    },
    '/auth/confirm-email-verification': { ok: true },
    '/auth/request-email-verification': { ok: true },
  };

  const originalLoad = Module._load;
  const originalResolveFilename = Module._resolveFilename;
  Module._extensions['.ts'] = compileTypeScriptModule;
  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolveFilename.call(
        this,
        path.join(repoRoot, 'src', request.slice(2)),
        parent,
        isMain,
        options,
      );
    }

    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function loadWithApiStub(request, parent, isMain) {
    if (request === './apiClient' && parent?.filename?.endsWith('authApiService.ts')) {
      return {
        apiClient: {
          post: async (requestPath, body, options) => {
            calls.push({ path: requestPath, body, options });
            return responses[requestPath] ?? {};
          },
        },
        ApiClientError: class ApiClientError extends Error {},
      };
    }

    if (request === './apiAuthTokenStore' && parent?.filename?.endsWith('authApiService.ts')) {
      return {
        getApiAuthTokens: async () => null,
        getApiAccessToken: async () => null,
        setApiAuthTokens: async (tokens) => {
          storedTokenCalls.push(tokens);
        },
        clearApiAuthTokens: async () => {},
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const api = require(path.join(repoRoot, 'src/services/authApiService.ts'));

    const signUpResult = await api.signUpWithEmail('Signup@Example.invalid', 'Synthetic-password-1');
    assertEqual(signUpResult.session, null, 'signup returns no session');
    assertEqual(signUpResult.needsEmailConfirmation, true, 'signup reports pending confirmation');
    assertEqual(calls.length, 1, 'signup makes exactly one request');
    assertEqual(calls[0].path, '/auth/register', 'signup calls only register');
    assertEqual(storedTokenCalls.length, 0, 'signup stores no tokens before verification');

    await api.confirmEmailVerification('a-verification-code');
    assertEqual(calls[1].path, '/auth/confirm-email-verification', 'confirm calls the confirm endpoint');
    assertDeepEqual(calls[1].body, { code: 'a-verification-code' }, 'confirm sends only the code');

    await api.resendConfirmationEmail('signup@example.invalid');
    assertEqual(calls[2].path, '/auth/request-email-verification', 'resend uses the existing request endpoint');
  } finally {
    Module._load = originalLoad;
    Module._resolveFilename = originalResolveFilename;
    delete require.cache[path.join(repoRoot, 'src/services/authApiService.ts')];
  }
}

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function compileTypeScriptModule(module, filename) {
  const sourceText = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(sourceText, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  });

  module._compile(outputText, filename);
}

function extractBetween(value, start, end) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);

  if (startIndex < 0 || endIndex < 0) {
    fail(`Could not extract source between ${JSON.stringify(start)} and ${JSON.stringify(end)}`);
  }

  return value.slice(startIndex, endIndex);
}

function assertIncludes(value, expected, description) {
  if (!value.includes(expected)) {
    fail(`${description}: expected ${JSON.stringify(expected)}`);
  }
}

function assertExcludes(value, forbidden, description) {
  if (value.includes(forbidden)) {
    fail(`${description}: found forbidden ${JSON.stringify(forbidden)}`);
  }
}

function assertBefore(value, first, second, description) {
  const firstIndex = value.indexOf(first);
  const secondIndex = value.indexOf(second);

  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    fail(`${description}: expected ${JSON.stringify(first)} before ${JSON.stringify(second)}`);
  }
}

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    fail(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, description) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function fail(message) {
  console.error(`Mobile signup email verification validation failed: ${message}`);
  process.exit(1);
}
