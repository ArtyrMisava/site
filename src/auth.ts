import { setPersistentItem } from './siteStorage';

const CREDENTIALS_KEY = 'lokus-admin-credentials-v1';
export const SESSION_KEY = 'lokus-admin-session-v1';

const PIN_ITERATIONS = 180_000;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface StoredCredentials {
  username: string;
  pinHash: string;
  algorithm?: 'PBKDF2-SHA-256';
  salt?: string;
  iterations?: number;
  recoveryHash?: string;
  recoverySalt?: string;
}

interface RecoveryParts {
  recoveryHash: string;
  recoverySalt: string;
}

function normalizeUsername(username: string): string {
  return username.trim().toLocaleLowerCase('ru-RU');
}

function normalizeRecoveryCode(code: string): string {
  return code.toLocaleUpperCase('ru-RU').replace(/[^A-Z0-9]/g, '');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

function makeRecoveryCode(): string {
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  const characters = Array.from(
    random,
    (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length],
  ).join('');
  return characters.match(/.{1,4}/g)?.join('-') ?? characters;
}

async function legacyPinHash(username: string, pin: string): Promise<string> {
  const payload = new TextEncoder().encode(
    `lokus-local-map::${normalizeUsername(username)}::${pin}`,
  );
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function deriveSecretHash(
  username: string,
  secret: string,
  salt: string,
  iterations = PIN_ITERATIONS,
): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${normalizeUsername(username)}::${secret}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64ToBytes(salt),
      iterations,
    },
    material,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function readCredentials(): StoredCredentials | null {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCredentials;
    return parsed.username && parsed.pinHash ? parsed : null;
  } catch {
    return null;
  }
}

function writeCredentials(credentials: StoredCredentials): void {
  setPersistentItem(CREDENTIALS_KEY, JSON.stringify(credentials));
}

async function createModernCredentials(
  username: string,
  pin: string,
  recovery?: RecoveryParts,
): Promise<StoredCredentials> {
  const salt = randomSalt();
  return {
    username: username.trim(),
    algorithm: 'PBKDF2-SHA-256',
    salt,
    iterations: PIN_ITERATIONS,
    pinHash: await deriveSecretHash(username, pin, salt),
    ...recovery,
  };
}

async function recoveryParts(username: string, recoveryCode: string): Promise<RecoveryParts> {
  const recoverySalt = randomSalt();
  return {
    recoverySalt,
    recoveryHash: await deriveSecretHash(
      username,
      normalizeRecoveryCode(recoveryCode),
      recoverySalt,
    ),
  };
}

export function hasAdminAccount(): boolean {
  return readCredentials() !== null;
}

export function hasRecoveryCode(): boolean {
  const credentials = readCredentials();
  return Boolean(credentials?.recoveryHash && credentials.recoverySalt);
}

/** Creates an account and returns the recovery code shown once to the user. */
export async function createAdminAccount(
  username: string,
  pin: string,
): Promise<string> {
  const recoveryCode = makeRecoveryCode();
  const credentials = await createModernCredentials(
    username,
    pin,
    await recoveryParts(username, recoveryCode),
  );
  writeCredentials(credentials);
  return recoveryCode;
}

export async function verifyAdmin(
  username: string,
  pin: string,
): Promise<boolean> {
  const credentials = readCredentials();
  if (!credentials) return false;
  if (normalizeUsername(credentials.username) !== normalizeUsername(username)) return false;

  if (credentials.algorithm === 'PBKDF2-SHA-256' && credentials.salt) {
    const hash = await deriveSecretHash(
      username,
      pin,
      credentials.salt,
      credentials.iterations ?? PIN_ITERATIONS,
    );
    return credentials.pinHash === hash;
  }
  return credentials.pinHash === (await legacyPinHash(username, pin));
}

/**
 * Upgrades an old browser-only account and equips it with recovery. The new
 * recovery code is returned once; modern accounts return null.
 */
export async function ensureAccountRecovery(
  pin: string,
): Promise<string | null> {
  const credentials = readCredentials();
  if (!credentials) return null;
  if (
    credentials.algorithm === 'PBKDF2-SHA-256'
    && credentials.salt
    && credentials.recoveryHash
    && credentials.recoverySalt
  ) return null;

  const recoveryCode = makeRecoveryCode();
  const upgraded = await createModernCredentials(
    credentials.username,
    pin,
    await recoveryParts(credentials.username, recoveryCode),
  );
  writeCredentials(upgraded);
  return recoveryCode;
}

export async function recoverAdminAccount(
  username: string,
  recoveryCode: string,
  newPin: string,
): Promise<boolean> {
  const credentials = readCredentials();
  if (
    !credentials
    || normalizeUsername(credentials.username) !== normalizeUsername(username)
    || !credentials.recoveryHash
    || !credentials.recoverySalt
  ) return false;

  const candidate = await deriveSecretHash(
    credentials.username,
    normalizeRecoveryCode(recoveryCode),
    credentials.recoverySalt,
  );
  if (candidate !== credentials.recoveryHash) return false;

  const updated = await createModernCredentials(
    credentials.username,
    newPin,
    {
      recoveryHash: credentials.recoveryHash,
      recoverySalt: credentials.recoverySalt,
    },
  );
  writeCredentials(updated);
  return true;
}

export function getStoredAdminName(): string {
  return readCredentials()?.username ?? 'Администратор';
}
