import type { Asset } from "../scene/types";

/** Tiny IndexedDB wrapper so user-uploaded SVG assets survive reloads.
 *  One object store keyed by asset id. No external dependency. */

const DB_NAME = "svg-grid";
const STORE = "assets";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function loadUserAssets(): Promise<Asset[]> {
  try {
    const db = await openDb();
    return await new Promise<Asset[]>((resolve, reject) => {
      const req = tx(db, "readonly").getAll();
      req.onsuccess = () => resolve(req.result as Asset[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return []; // private mode / unsupported -> degrade gracefully
  }
}

export async function saveUserAsset(asset: Asset): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const req = tx(db, "readwrite").put(asset);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* ignore persistence failure; asset still works in-session */
  }
}

export async function deleteUserAsset(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const req = tx(db, "readwrite").delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* ignore */
  }
}
