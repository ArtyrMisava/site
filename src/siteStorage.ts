const STORAGE_ENDPOINT = '/api/dus-storage';

const PERSISTED_KEYS = [
  'lokus-admin-credentials-v1',
  'lokus-map-items-v1',
  'dus-map-coordinate-version',
  'dus-map-view-link-v1',
  'dus-map-layer-mode-v1',
] as const;

interface StorageResponse {
  initialized: boolean;
  entries: Record<string, string>;
}

let folderStorageAvailable = false;
let persistenceTimer = 0;
let persistenceInFlight = false;
let persistenceQueued = false;

function currentEntries(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const key of PERSISTED_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return entries;
}

async function writeFolderState(keepalive = false): Promise<void> {
  if (!folderStorageAvailable) return;
  if (persistenceInFlight) {
    persistenceQueued = true;
    return;
  }

  persistenceInFlight = true;
  try {
    const response = await fetch(STORAGE_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: currentEntries() }),
      cache: 'no-store',
      keepalive,
    });
    if (!response.ok) throw new Error(`Storage write failed: ${response.status}`);
  } catch (error) {
    console.error('Не удалось сохранить данные ДУС в папке сайта.', error);
  } finally {
    persistenceInFlight = false;
    if (persistenceQueued) {
      persistenceQueued = false;
      scheduleFolderPersistence();
    }
  }
}

export function scheduleFolderPersistence(): void {
  if (!folderStorageAvailable || persistenceTimer) return;
  persistenceTimer = window.setTimeout(() => {
    persistenceTimer = 0;
    void writeFolderState();
  }, 900);
}

export function setPersistentItem(key: string, value: string): void {
  localStorage.setItem(key, value);
  scheduleFolderPersistence();
}

export function removePersistentItem(key: string): void {
  localStorage.removeItem(key);
  scheduleFolderPersistence();
}

export function isFolderStorageAvailable(): boolean {
  return folderStorageAvailable;
}

/**
 * Loads the portable state file before React reads localStorage. Existing
 * browser-only installations are migrated into the folder automatically.
 */
export async function initializeSiteStorage(): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(STORAGE_ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.includes('application/json')) return;
    const payload = await response.json() as Partial<StorageResponse>;
    if (!payload.entries || typeof payload.entries !== 'object') return;

    folderStorageAvailable = true;
    const entries = payload.entries;
    for (const key of PERSISTED_KEYS) {
      const folderValue = entries[key];
      if (typeof folderValue === 'string') {
        localStorage.setItem(key, folderValue);
      } else if (key === 'lokus-admin-credentials-v1' && payload.initialized) {
        // An absent credential in an initialized file is an intentional reset.
        localStorage.removeItem(key);
        sessionStorage.removeItem('lokus-admin-session-v1');
      }
    }

    // This also performs one-time migration of old browser-only points and
    // fills settings introduced by newer versions without deleting old data.
    await writeFolderState();

    const flushBeforeClose = () => {
      if (!folderStorageAvailable) return;
      if (persistenceTimer) {
        window.clearTimeout(persistenceTimer);
        persistenceTimer = 0;
      }
      const body = new Blob(
        [JSON.stringify({ entries: currentEntries() })],
        { type: 'application/json' },
      );
      navigator.sendBeacon?.(STORAGE_ENDPOINT, body);
    };
    window.addEventListener('pagehide', flushBeforeClose);
  } catch {
    // Development servers and older launchers have no folder-storage API.
    // localStorage remains a fully functional compatibility fallback.
  } finally {
    window.clearTimeout(timeout);
  }
}
