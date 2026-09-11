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
validateSignupLegalDocumentWiring();
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

function validateSignupLegalDocumentWiring() {
  assertIncludes(files.authApiService, 'export async function getSignupLegalDocuments()', 'authApiService exposes legal document loading');
  assertIncludes(files.authApiService, "'/auth/signup-legal-documents'", 'legal documents are loaded from the API');
  assertIncludes(files.signUpForm, 'const [accountConsentAccepted, setAccountConsentAccepted] = useState(false);', 'account consent starts unchecked');
  assertIncludes(files.signUpForm, 'const [userAgreementAccepted, setUserAgreementAccepted] = useState(false);', 'user agreement starts unchecked');
  assertIncludes(files.signUpForm, 'const [privacyPolicy, setPrivacyPolicy] = useState<ApiSignupLegalDocument | null>(null);', 'privacy policy is held only in screen state');
  assertIncludes(files.signUpForm, "policy.document_type === 'privacy_policy'", 'privacy policy comes from the API response');
  assertIncludes(files.signUpForm, '&& privacyPolicy', 'privacy policy loading is required before signup');
  assertIncludes(files.signUpForm, 'privacyPolicy.title} · версия {privacyPolicy.version}', 'privacy policy link renders its server-provided title and version');
  assertEqual(countOccurrences(files.signUpForm, 'accessibilityRole="checkbox"'), 2, 'signup keeps exactly two checkbox controls');
  assertIncludes(files.signUpForm, 'account_personal_data_consent:', 'signup sends account consent evidence');
  assertIncludes(files.signUpForm, 'user_agreement:', 'signup sends agreement evidence');
  assertIncludes(files.signUpForm, 'document_id: accountConsentDocument.id', 'signup uses the server-provided account consent id');
  assertIncludes(files.signUpForm, 'content_hash: accountConsentDocument.content_hash', 'signup uses the server-provided account consent hash');
  assertIncludes(files.signUpForm, 'document_id: userAgreementDocument.id', 'signup uses the server-provided agreement id');
  assertIncludes(files.signUpForm, 'content_hash: userAgreementDocument.content_hash', 'signup uses the server-provided agreement hash');
  assertIncludes(files.signUpForm, "error.code === 'legal_documents_changed'", 'stale legal documents trigger a refresh');
  assertIncludes(files.signUpForm, 'setAccountConsentAccepted(false);', 'reloading documents clears account consent');
  assertIncludes(files.signUpForm, 'setUserAgreementAccepted(false);', 'reloading documents clears agreement consent');
  assertIncludes(files.signUpForm, '&& accountConsentAccepted', 'account consent is required before signup');
  assertIncludes(files.signUpForm, '&& userAgreementAccepted', 'user agreement is required before signup');
  assertExcludes(files.signUpForm, 'privacy_policy: {', 'privacy policy is not sent as acceptance evidence');
  assertExcludes(files.signUpForm, '34721bfa-d04b-59c0-b341-d42c1bf56e48', 'mobile form does not hardcode production document ids');
  assertExcludes(files.signUpForm, '1bfbd4bb-2d47-55c0-9b57-80f0d14667ee', 'mobile form does not hardcode production document ids');
  assertExcludes(files.signUpForm, 'sha256:42c7e863e18a99dfb1753967ed8151c163a4a9770fa96b6c8390c6d4fffd33bc', 'mobile form does not hardcode production document hashes');
  assertExcludes(files.signUpForm, 'sha256:0697fae65b9ebc07c239993f5cd908e0ee2278d1d8365f79e4c7fc7b9df16391', 'mobile form does not hardcode production document hashes');
}

function validateConfirmWiring() {
  assertIncludes(files.authApiService, 'export async function confirmEmailVerification', 'authApiService exposes confirmEmailVerification');
  assertIncludes(files.authApiService, "'/auth/confirm-email-verification'", 'confirm calls the existing confirm endpoint');
  assertIncludes(files.authService, 'confirmEmailVerification', 'authService re-exports confirmEmailVerification');
}

function validateStoreWiring() {
  assertIncludes(files.authStore, 'confirmEmailVerification: async (email: string, code: string)', 'store exposes a confirmEmailVerification action');
  assertIncludes(files.authStore, 'confirmEmailVerificationService(email, code)', 'store action calls the confirm service');
}

function validateRecoveryWiring() {
  const verificationSubmit = extractBetween(
    files.verificationForm,
    'const handleSubmit = useCallback(async () => {',
    '}, [code, confirmEmailVerification, email, onVerified, password, signIn]);',
  );

  assertIncludes(verificationSubmit, 'await confirmEmailVerification(email, code)', 'email-bound code is confirmed before login');
  assertIncludes(verificationSubmit, 'await signIn(email, password)', 'verification logs in with the held credentials');
  assertBefore(verificationSubmit, 'await confirmEmailVerification(email, code)', 'await signIn(email, password)', 'confirmation happens before login');
  assertIncludes(files.verificationForm, "replace(/[^0-9]/g, '').slice(0, 6)", 'verification input preserves only six numeric digits');
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
  const getCalls = [];
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
    '/auth/signup-legal-documents': {
      documents: [
        {
          id: 'account-consent-id',
          document_type: 'account_personal_data_consent',
          version: '2.0',
          title: 'Account consent',
          content_hash: 'sha256:account-consent',
          published_url: 'https://example.invalid/account-consent',
        },
        {
          id: 'user-agreement-id',
          document_type: 'user_agreement',
          version: '2.0',
          title: 'User agreement',
          content_hash: 'sha256:user-agreement',
          published_url: 'https://example.invalid/user-agreement',
        },
      ],
      privacy_policy: {
        id: 'privacy-policy-id',
        document_type: 'privacy_policy',
        version: '2.0',
        title: 'Политика обработки персональных данных',
        content_hash: 'sha256:privacy-policy',
        published_url: 'https://example.invalid/privacy-policy',
      },
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
          get: async (requestPath, options) => {
            getCalls.push({ path: requestPath, options });
            return responses[requestPath] ?? {};
          },
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

    const legalDocuments = await api.getSignupLegalDocuments();
    assertEqual(getCalls[0].path, '/auth/signup-legal-documents', 'signup legal documents load from the API');
    const signUpResult = await api.signUpWithEmail('Signup@Example.invalid', 'Synthetic-password-1', {
      account_personal_data_consent: {
        document_id: legalDocuments.documents[0].id,
        content_hash: legalDocuments.documents[0].content_hash,
      },
      user_agreement: {
        document_id: legalDocuments.documents[1].id,
        content_hash: legalDocuments.documents[1].content_hash,
      },
    });
    assertEqual(signUpResult.session, null, 'signup returns no session');
    assertEqual(signUpResult.needsEmailConfirmation, true, 'signup reports pending confirmation');
    assertEqual(calls.length, 1, 'signup makes exactly one request');
    assertEqual(calls[0].path, '/auth/register', 'signup calls only register');
    assertDeepEqual(calls[0].body.legal_acceptances, {
      account_personal_data_consent: {
        document_id: 'account-consent-id',
        content_hash: 'sha256:account-consent',
      },
      user_agreement: {
        document_id: 'user-agreement-id',
        content_hash: 'sha256:user-agreement',
      },
    }, 'signup carries current document ids and hashes');
    assertEqual(storedTokenCalls.length, 0, 'signup stores no tokens before verification');

    await api.confirmEmailVerification('signup@example.invalid', '012345');
    assertEqual(calls[1].path, '/auth/confirm-email-verification', 'confirm calls the confirm endpoint');
    assertDeepEqual(calls[1].body, { email: 'signup@example.invalid', code: '012345' }, 'confirm sends email and the six-digit code');

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

function countOccurrences(value, expected) {
  return value.split(expected).length - 1;
}

function fail(message) {
  console.error(`Mobile signup email verification validation failed: ${message}`);
  process.exit(1);
}
