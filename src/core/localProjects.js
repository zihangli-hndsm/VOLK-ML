const DATABASE_NAME = 'volk-ml-local';
const STORE_NAME = 'projects';
const CURRENT_PROJECT_KEY = 'current-project';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function accessStore(mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export function saveLocalProject(project) {
  return accessStore('readwrite', (store) => store.put(project, CURRENT_PROJECT_KEY));
}

export function loadLocalProject() {
  return accessStore('readonly', (store) => store.get(CURRENT_PROJECT_KEY));
}

export function clearLocalProject() {
  return accessStore('readwrite', (store) => store.delete(CURRENT_PROJECT_KEY));
}

export function safeProjectFilename(name) {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${slug || 'volk-ml-project'}.volkml.json`;
}
