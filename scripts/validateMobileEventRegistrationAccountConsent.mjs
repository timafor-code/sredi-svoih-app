#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const accountConsentApi = source('src/services/accountConsentApiService.ts');
const registrationApi = source('src/services/registrationApiService.ts');
const registrationScreen = source('app/events/register/[id].tsx');
const signupForm = source('src/components/auth/EmailSignUpForm.tsx');
const apiTypes = source('src/types/api.ts');

const requireText = (value, expected, message) => {
  if (!value.includes(expected)) throw new Error(`${message}: ${expected}`);
};
const forbidText = (value, forbidden, message) => {
  if (value.includes(forbidden)) throw new Error(`${message}: ${forbidden}`);
};

requireText(accountConsentApi, "'/auth/account-consent'", 'status endpoint is present');
requireText(accountConsentApi, "'/auth/account-consent/accept'", 'accept endpoint is present');
requireText(registrationScreen, "'account_consent_required'", 'registration race is handled');
requireText(registrationScreen, 'accessibilityRole="checkbox"', 'one-time gate uses a checkbox');
requireText(registrationScreen, 'document.published_url', 'document link is server-provided');
requireText(registrationScreen, 'setAccountConsentGateVisible(true)', 'gate opens only after an action');
requireText(registrationScreen, 'setAccountConsentGateChecked(false)', 'checkbox state is reset in memory');
forbidText(registrationScreen, 'event_registration_consent', 'native screen does not add per-event consent');
forbidText(registrationApi, 'guest_names:', 'native registration does not submit guest data');
forbidText(apiTypes, 'guest_names?:', 'native input contract has no guest data');
requireText(signupForm, 'для использования аккаунта и регистрации через аккаунт на мероприятия', 'signup copy reflects current purpose');

process.stdout.write('Mobile event registration account consent validation passed\n');
