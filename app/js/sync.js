// Sincronización con el backend del mismo dominio, siempre con los datos del usuario que ha iniciado sesión.
//
// Contrato:
//   GET  /api/health -> { "ok": true }
//   POST /api/sync   { lastSyncAt: <number, ms del servidor>, changes: { sessions: [...] } }   (Bearer token)
//                 -> { serverTime: <number>, changes: { sessions: [...] }, rejected: <number> }
//
// Reglas: last-write-wins por "updatedAt"; los borrados viajan como registros con "deleted": true.
// El servidor devuelve lo del usuario guardado después de lastSyncAt (según su propio reloj).

import { pending, applyRemote, getMeta, setMeta } from './db.js';
import { api } from './auth.js';

let running = null;

export function sync() {
  if (running) return running;
  running = (async () => {
    try {
      await api('/health', { timeout: 4000 });
    } catch {
      return { ok: false, reason: 'Servidor no accesible' };
    }
    const lastSyncAt = (await getMeta('lastSyncAt')) || 0;
    const local = await pending();
    const sent = {};
    const payload = local.map(({ dirty, ...rest }) => { sent[rest.id] = rest.updatedAt; return rest; });
    let res;
    try {
      res = await api('/sync', { method: 'POST', body: { lastSyncAt, changes: { sessions: payload } }, timeout: 20000 });
    } catch (e) {
      if (e.status === 401) return { ok: false, auth: true, reason: e.message };
      if (e.data?.consentRequired) return { ok: false, consent: true, reason: e.message };
      return { ok: false, reason: 'Error al sincronizar (' + e.message + ')' };
    }
    let remote = (res.changes && res.changes.sessions) || [];
    await applyRemote(remote, sent);
    await setMeta('lastSyncAt', res.serverTime);
    // Si hay muchos cambios el servidor responde por páginas: se piden las siguientes sin reenviar nada.
    let received = remote.length;
    const rejected = res.rejected || 0;
    for (let page = 0; res.more && page < 100; page++) {
      try {
        res = await api('/sync', { method: 'POST', body: { lastSyncAt: res.serverTime, changes: { sessions: [] } }, timeout: 20000 });
      } catch (e) {
        return { ok: false, reason: 'Sincronización incompleta (' + e.message + '). Se completará la próxima vez.' };
      }
      remote = (res.changes && res.changes.sessions) || [];
      await applyRemote(remote, {});
      await setMeta('lastSyncAt', res.serverTime);
      received += remote.length;
    }
    await setMeta('lastSyncOk', new Date().toISOString());
    return { ok: true, sent: payload.length, received, rejected };
  })().finally(() => { running = null; });
  return running;
}
