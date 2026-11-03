/** Device key storage. CryptoKey objects (non-extractable) are stored as-is in IndexedDB. */
export interface KeyStore {
  get(id: string): Promise<CryptoKey | undefined>;
  put(id: string, key: CryptoKey): Promise<void>;
  delete(id: string): Promise<void>;
}

export class MemoryKeyStore implements KeyStore {
  private m = new Map<string, CryptoKey>();
  async get(id: string) { return this.m.get(id); }
  async put(id: string, key: CryptoKey) { this.m.set(id, key); }
  async delete(id: string) { this.m.delete(id); }
}

const DB = "careiq-e2e";
const STORE = "keys";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export class IndexedDbKeyStore implements KeyStore {
  get(id: string) { return run<CryptoKey | undefined>("readonly", (s) => s.get(id)); }
  async put(id: string, key: CryptoKey) { await run("readwrite", (s) => s.put(key, id)); }
  async delete(id: string) { await run("readwrite", (s) => s.delete(id)); }
}
