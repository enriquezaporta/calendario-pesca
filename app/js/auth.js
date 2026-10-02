// Sesión del usuario y llamadas al backend.
// La sesión (token + usuario) se guarda en localStorage: es almacenamiento técnico imprescindible para
// mantener la sesión abierta, también sin conexión. No hay cookies ni rastreo.

const KEY = 'pesca.auth';

export class ApiError extends Error {
  constructor(status, message, data = {}) { super(message); this.status = status; this.data = data; }
}

export function getAuth() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

function setAuth(a) {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a)); else localStorage.removeItem(KEY);
  } catch { /* almacenamiento no disponible: la sesión dura lo que la pestaña */ }
}

export async function api(path, { method = 'GET', body, timeout = 10000, raw = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const headers = {};
  const a = getAuth();
  if (a?.token) headers.Authorization = 'Bearer ' + a.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'Servidor no accesible');
  } finally {
    clearTimeout(t);
  }
  if (raw && r.ok) return r;
  let data = {};
  try { data = await r.json(); } catch { /* respuesta vacía */ }
  if (!r.ok) throw new ApiError(r.status, data.error || (r.status >= 500 || r.status === 0 ? 'Servidor no accesible' : 'Error ' + r.status), data);
  return data;
}

export async function login(username, password) {
  const res = await api('/auth/login', { method: 'POST', body: { username, password } });
  setAuth({ token: res.token, user: res.user });
  return res;
}

export async function register(fields) {
  const res = await api('/auth/register', { method: 'POST', body: fields });
  setAuth({ token: res.token, user: res.user });
  return res;
}

export async function recover(username, code, password) {
  const res = await api('/auth/recover', { method: 'POST', body: { username, code, password } });
  setAuth({ token: res.token, user: res.user });
  return res;
}

export async function logout() {
  try { await api('/auth/logout', { method: 'POST', timeout: 4000 }); } catch { /* sin conexión: se cierra igualmente */ }
  setAuth(null);
}

// El servidor dice que el token ya no vale (contraseña cambiada, sesión caducada…).
export function dropSession() { setAuth(null); }

export function updateUser(user) {
  const a = getAuth();
  if (a) setAuth({ ...a, user });
}
