const CREDENTIALS_KEY = 'lokus-admin-credentials-v1';
export const SESSION_KEY = 'lokus-admin-session-v1';

interface StoredCredentials {
  username: string;
  pinHash: string;
}

async function hashPin(username: string, pin: string): Promise<string> {
  const payload = new TextEncoder().encode(
    `lokus-local-map::${username.trim().toLocaleLowerCase('ru-RU')}::${pin}`,
  );
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
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

export function hasAdminAccount(): boolean {
  return readCredentials() !== null;
}

export async function createAdminAccount(
  username: string,
  pin: string,
): Promise<void> {
  const credentials: StoredCredentials = {
    username: username.trim(),
    pinHash: await hashPin(username, pin),
  };
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
}

export async function verifyAdmin(
  username: string,
  pin: string,
): Promise<boolean> {
  const credentials = readCredentials();
  if (!credentials) return false;
  if (
    credentials.username.toLocaleLowerCase('ru-RU') !==
    username.trim().toLocaleLowerCase('ru-RU')
  ) {
    return false;
  }
  return credentials.pinHash === (await hashPin(username, pin));
}

export function getStoredAdminName(): string {
  return readCredentials()?.username ?? 'Администратор';
}
