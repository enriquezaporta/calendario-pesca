import { cleanRecord } from './modalities.js';

// Almacenamiento local en IndexedDB.
// Store "sessions": cada jornada (concurso, campeonato o entrenamiento).
//   Campos de control: id, updatedAt (ISO), deleted (bool), dirty (0/1 = pendiente de subir).
// Store "meta": pares clave/valor (lastSyncAt, etc.).
// Cada usuario tiene su propia base de datos local: "pesca-u<id>".
// "pesca" (sin sufijo) es la de la versión 1, sin usuarios; solo se lee para importarla.

const LEGACY_NAME = 'pesca';
const DB_VERSION = 1;
let dbName = null;
let dbp;

export function setUser(uid) {
  const name = uid == null ? null : 'pesca-u' + uid;
  if (name === dbName) return;
  if (dbp) dbp.then(db => db.close()).catch(() => {});
  dbName = name;
  dbp = null;
}

function open() {
  if (dbp) return dbp;
  if (!dbName) return Promise.reject(new Error('Sin usuario'));
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('dirty', 'dirty');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const st = t.objectStore(store);
    let result;
    Promise.resolve(fn(st)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}

// Todas las jornadas visibles (sin borradas), ordenadas por fecha descendente.
export async function allSessions() {
  const rows = await tx('sessions', 'readonly', st => req2p(st.getAll()));
  return rows.filter(r => !r.deleted).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
}

export function getSession(id) {
  return tx('sessions', 'readonly', st => req2p(st.get(id)));
}

// Guardado local: marca como pendiente de sincronizar.
export function saveSession(s) {
  s.updatedAt = new Date().toISOString();
  s.dirty = 1;
  return tx('sessions', 'readwrite', st => req2p(st.put(s))).then(() => s);
}

// Borrar: queda solo una marca técnica para que el borrado llegue al servidor; el contenido se elimina.
export async function deleteSession(id) {
  const s = await getSession(id);
  if (!s) return;
  return saveSession({ id: s.id, date: s.date, deleted: true });
}

export function pending() {
  return tx('sessions', 'readonly', st => req2p(st.index('dirty').getAll(1)));
}

export async function pendingCount() {
  return tx('sessions', 'readonly', st => req2p(st.index('dirty').count(1)));
}

// Aplica cambios del servidor con last-write-wins por updatedAt.
// "sent" = mapa id -> updatedAt de lo que se subió; si no ha cambiado desde entonces, deja de estar pendiente.
export function applyRemote(remote, sent) {
  return tx('sessions', 'readwrite', async st => {
    for (const [id, updatedAt] of Object.entries(sent)) {
      const cur = await req2p(st.get(id));
      if (cur && cur.updatedAt === updatedAt && cur.dirty) { cur.dirty = 0; st.put(cur); }
    }
    for (const raw of remote) {
      const r = cleanRecord(raw);
      if (!r) continue;
      const cur = await req2p(st.get(r.id));
      if (!cur || (r.updatedAt || '') > (cur.updatedAt || '')) {
        st.put({ ...r, dirty: 0 });
      }
    }
  });
}

// Importación de copia: se trata como edición local para que se suba al servidor.
export function importMany(list) {
  return tx('sessions', 'readwrite', async st => {
    let n = 0;
    for (const raw of list) {
      const r = cleanRecord(raw);
      if (!r || !r.date || r.deleted) continue;
      const cur = await req2p(st.get(r.id));
      if (!cur || (r.updatedAt || '') > (cur.updatedAt || '')) {
        st.put({ ...r, dirty: 1, updatedAt: r.updatedAt || new Date().toISOString() });
        n++;
      }
    }
    return n;
  });
}

export function getMeta(key) {
  return tx('meta', 'readonly', st => req2p(st.get(key)));
}

export function setMeta(key, value) {
  return tx('meta', 'readwrite', st => req2p(st.put(value, key)));
}

// ---------- datos de la versión 1 (sin usuarios) ----------
// Devuelve las jornadas no borradas de la base "pesca" si existe en este dispositivo; si no, [].
export async function legacySessions() {
  if (!indexedDB.databases) return [];
  const list = await indexedDB.databases().catch(() => []);
  if (!list.some(d => d.name === LEGACY_NAME)) return [];
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    if (!db.objectStoreNames.contains('sessions')) return [];
    const rows = await new Promise((resolve, reject) => {
      const r = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return rows.filter(r => !r.deleted);
  } finally {
    db.close();
  }
}

// Borra la base de datos local de un usuario (al cerrar sesión con "borrar datos" o al eliminar la cuenta).
export function dropUserData(uid) {
  if (dbName === 'pesca-u' + uid) setUser(null);
  return new Promise(resolve => {
    const r = indexedDB.deleteDatabase('pesca-u' + uid);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

export function dropLegacy() {
  return new Promise(resolve => {
    const r = indexedDB.deleteDatabase(LEGACY_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}
