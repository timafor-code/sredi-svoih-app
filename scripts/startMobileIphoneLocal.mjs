import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse as parseDotenv } from 'dotenv';

export const MOBILE_ENV_KEYS = Object.freeze([
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_APP_ACCESS_MODE',
  'EXPO_PUBLIC_EVENT_REGISTRATION_MODE',
]);

const APP_ACCESS_MODES = new Set(['account', 'guest_only']);
const EVENT_REGISTRATION_MODES = new Set(['account', 'disabled', 'public_web']);
const STORAGE_PORT = '59000';
const require = createRequire(import.meta.url);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, '..');
export const defaultEnvFilePath = path.join(repositoryRoot, '.env.local');

function requiredValue(parsedEnv, key) {
  const value = parsedEnv[key]?.trim();

  if (!value) {
    throw new Error(`${key} is required in the root .env.local file.`);
  }

  return value;
}

export function parseMobileIphoneEnv(contents) {
  const parsedEnv = parseDotenv(contents);
  const mobileEnv = Object.fromEntries(
    MOBILE_ENV_KEYS.map((key) => [key, requiredValue(parsedEnv, key)]),
  );

  if (!APP_ACCESS_MODES.has(mobileEnv.EXPO_PUBLIC_APP_ACCESS_MODE)) {
    throw new Error(
      'EXPO_PUBLIC_APP_ACCESS_MODE must be account or guest_only in .env.local.',
    );
  }

  if (!EVENT_REGISTRATION_MODES.has(mobileEnv.EXPO_PUBLIC_EVENT_REGISTRATION_MODE)) {
    throw new Error(
      'EXPO_PUBLIC_EVENT_REGISTRATION_MODE must be account, public_web, or disabled in .env.local.',
    );
  }

  return Object.freeze(mobileEnv);
}

export async function loadMobileIphoneEnv(envFilePath = defaultEnvFilePath) {
  let contents;

  try {
    contents = await readFile(envFilePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Root .env.local was not found. Create it before running mobile:iphone.');
    }

    throw error;
  }

  return parseMobileIphoneEnv(contents);
}

export function resolveMobileIphoneRuntime(mobileEnv) {
  const apiUrlValue = mobileEnv.EXPO_PUBLIC_API_URL;
  let apiUrl;

  try {
    apiUrl = new URL(apiUrlValue);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be an absolute http/https URL.');
  }

  if (apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_URL must be an absolute http/https URL.');
  }

  const lanHost = apiUrl.hostname.toLowerCase().replace(/\.+$/, '');

  if (
    lanHost === 'localhost'
    || lanHost.endsWith('.localhost')
    || /^127(?:\.|$)/.test(lanHost)
  ) {
    throw new Error(
      'EXPO_PUBLIC_API_URL must use the computer LAN hostname/IP, not localhost or 127.0.0.1.',
    );
  }

  const storageUrl = new URL(apiUrl);
  storageUrl.protocol = 'http:';
  storageUrl.port = STORAGE_PORT;
  storageUrl.pathname = '/';
  storageUrl.search = '';
  storageUrl.hash = '';

  return Object.freeze({
    apiUrl: apiUrlValue,
    lanHost,
    mobileEnv,
    storagePublicUrl: storageUrl.toString().replace(/\/$/, ''),
  });
}

export function createDockerEnvironment(baseEnv, runtime) {
  return {
    ...baseEnv,
    API_OBJECT_STORAGE_HOST_BIND: '0.0.0.0',
    API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL: runtime.storagePublicUrl,
  };
}

export function createExpoEnvironment(baseEnv, runtime) {
  const expoEnv = {
    ...baseEnv,
    ...runtime.mobileEnv,
    EXPO_NO_DOTENV: '1',
  };

  delete expoEnv.API_OBJECT_STORAGE_HOST_BIND;
  delete expoEnv.API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL;

  return expoEnv;
}

export function spawnAndWait(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} failed with ${outcome}.`));
    });
  });
}

export async function startMobileIphoneLocal({
  args = process.argv.slice(2),
  baseEnv = process.env,
  envFilePath = defaultEnvFilePath,
  logger = console,
  runCommand = spawnAndWait,
} = {}) {
  const unsupportedArgs = args.filter((arg) => arg !== '--check');

  if (unsupportedArgs.length > 0) {
    throw new Error(`Unsupported argument: ${unsupportedArgs[0]}`);
  }

  const mobileEnv = await loadMobileIphoneEnv(envFilePath);
  const runtime = resolveMobileIphoneRuntime(mobileEnv);

  logger.log(`Mobile API: ${runtime.apiUrl}`);
  logger.log(`Avatar storage: ${runtime.storagePublicUrl}`);
  logger.log(
    `Capabilities: ${mobileEnv.EXPO_PUBLIC_APP_ACCESS_MODE} / ${mobileEnv.EXPO_PUBLIC_EVENT_REGISTRATION_MODE}`,
  );

  if (args.includes('--check')) {
    logger.log('Configuration is valid. Docker and Expo were not started.');
    return runtime;
  }

  logger.log('Starting the local Docker contour...');
  await runCommand(
    'docker',
    ['compose', '-f', 'infra/docker-compose.api.yml', 'up', '-d'],
    {
      cwd: repositoryRoot,
      env: createDockerEnvironment(baseEnv, runtime),
    },
  );

  logger.log('Starting Expo for a physical iPhone...');
  await runCommand(
    process.execPath,
    [require.resolve('expo/bin/cli'), 'start', '--clear'],
    {
      cwd: repositoryRoot,
      env: createExpoEnvironment(baseEnv, runtime),
    },
  );

  return runtime;
}

function isMainModule() {
  return Boolean(process.argv[1])
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  startMobileIphoneLocal().catch((error) => {
    console.error(`mobile:iphone: ${error.message}`);
    process.exitCode = 1;
  });
}
