// Núcleo compartido por todas las pantallas: utilidades, estado, navegación, diálogos y sincronización.
import * as db from './db.js';
import { sync } from './sync.js';
import * as auth from './auth.js';

// ---------- utilidades ----------
export const $ = s => document.querySelector(s);
export const view = $('#view');
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => ymd(new Date());
export const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
export const int = v => { const n = num(v); return n == null ? null : Math.round(n); };
export const fmtKgShort = g => g == null ? '—' : (g / 1000).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtNum = n => n == null ? '' : n.toLocaleString('es-ES');
export const fmtDate = s => new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDay = s => new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
export const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const initial = u => esc(((u.name || u.username || '?').trim()[0] || '?').toUpperCase());

export const TYPES = {
  concurso: { label: 'Concurso', color: 'var(--concurso)' },
  campeonato: { label: 'Campeonato', color: 'var(--campeonato)' },
  entrenamiento: { label: 'Entreno', color: 'var(--entreno)' },
};
export const isComp = s => s.type === 'concurso' || s.type === 'campeonato';
export const SKY = [['sol', '☀️'], ['nubes-claros', '⛅'], ['nublado', '☁️'], ['lluvia', '🌧️'], ['tormenta', '⛈️'], ['niebla', '🌫️']];
export const SKY_LABEL = { sol: 'Soleado', 'nubes-claros': 'Nubes y claros', nublado: 'Nublado', lluvia: 'Lluvia', tormenta: 'Tormenta', niebla: 'Niebla' };
export const WIND = ['Calma', 'Flojo', 'Moderado', 'Fuerte'];
export const WIND_DIR = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3000);
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- diálogos ----------
// actions: [{label, value, cls}]; un botón sin value cierra. onAction(value, root) puede ser async:
// si devuelve false el diálogo sigue abierto; si lanza un error, se muestra dentro del diálogo.
export function modal({ title, html = '', actions = [{ label: 'Cerrar' }], onAction }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal form" role="dialog" aria-modal="true" aria-labelledby="mtitle">
      <h3 id="mtitle">${esc(title)}</h3><div class="modal-body">${html}</div>
      <p class="hint err" role="alert"></p>
      <div class="actions">${actions.map((a, i) => `<button type="button" class="btn ${a.cls || (a.value == null ? 'ghost' : '')}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
    document.body.appendChild(wrap);
    const prev = document.activeElement;
    const close = v => {
      wrap.remove(); document.removeEventListener('keydown', onKey, true);
      prev?.focus?.(); resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(null); });
    wrap.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
      const a = actions[+b.dataset.i];
      if (a.value == null) return close(null);
      if (!onAction) return close(a.value);
      b.disabled = true;
      wrap.querySelector('.err').textContent = '';
      try {
        const r = await onAction(a.value, wrap);
        if (r === false) { b.disabled = false; return; }
        close(r === undefined ? a.value : r);
      } catch (err) {
        wrap.querySelector('.err').textContent = err.message;
        b.disabled = false;
      }
    });
    (wrap.querySelector('.modal-body input, .modal-body textarea, .modal-body select') || wrap.querySelector('.actions .btn:last-child'))?.focus();
  });
}

export const confirmBox = (title, text, okLabel = 'Aceptar', danger = false) =>
  modal({ title, html: `<p>${esc(text)}</p>`, actions: [{ label: 'Cancelar' }, { label: okLabel, value: true, cls: danger ? 'danger-solid' : '' }] });

// ---------- estado y navegación ----------
export const state = {
  tab: 'calendar',
  month: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  selDay: null,
  listType: 'todos', listMod: 'all', listYear: new Date().getFullYear(),
  seasonYear: new Date().getFullYear(), seasonMod: 'all',
  compareYear: new Date().getFullYear(), compareMod: 'all',
  user: null,     // {id, username, name, modalities, shareLevel, needsConsent, hasRecovery}
  friendData: {}, // username -> {user, shareLevel, sessions} (solo en memoria)
  unread: 0,
  stack: [],      // pantallas apiladas: {kind:'detail'|'form'|'friend', ...}
};

const screens = {};
export const registerScreens = obj => Object.assign(screens, obj);
// Temporizadores de la pantalla actual (p. ej. el chat): se paran al cambiar de pantalla.
export const timers = new Set();
export function every(ms, fn) { const t = setInterval(fn, ms); timers.add(t); return t; }

export function setTitle(t) { $('#title').textContent = t; }
export function setFab(show) { $('#fab').hidden = !show; }
export function setChrome(show) {
  document.querySelector('.tabbar').hidden = !show;
  $('#syncBtn').hidden = !show;
  document.body.classList.toggle('signed-out', !show);
  if (!show) setFab(false);
}

export async function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  timers.forEach(clearInterval); timers.clear();
  if (!state.user) { setChrome(false); return screens.login(); }
  if (state.user.needsConsent) { setChrome(false); return screens.consent(); }
  setChrome(true);
  const top = state.stack[state.stack.length - 1];
  await (top ? screens[top.kind](top) : screens[state.tab]());
  window.scrollTo(0, keepScroll ? y : 0);
}

export function push(screen) { state.stack.push(screen); render(); }
export function pop() { state.stack.pop(); render(); }
export function goTab(tab) {
  state.tab = tab; state.stack = [];
  document.querySelectorAll('.tabbar button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  render();
}

// ---------- sesión y sincronización ----------
export function setUser(user) {
  state.user = user;
  auth.updateUser(user);
}

export function signOutLocal(message) {
  state.user = null;
  state.stack = [];
  state.friendData = {};
  state.unread = 0;
  db.setUser(null);
  render();
  if (message) toast(message);
}

export async function refreshBadge() {
  if (!state.user) return;
  const n = await db.pendingCount().catch(() => 0);
  const b = $('#syncBadge');
  b.textContent = n; b.hidden = n === 0;
}

export function setUnread(n) {
  state.unread = n;
  const b = $('#chatBadge');
  b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
}

export async function refreshUnread() {
  if (!state.user || state.user.needsConsent || document.visibilityState !== 'visible') return;
  try { setUnread((await auth.api('/chats/unread', { timeout: 6000 })).count); } catch { /* sin conexión */ }
}

// Pide al servidor el perfil actualizado (p. ej. si hay que aceptar una política nueva).
export async function refreshMe() {
  if (!state.user) return;
  try {
    const { user } = await auth.api('/me', { timeout: 6000 });
    const changed = user.needsConsent !== state.user.needsConsent;
    setUser(user);
    if (changed) render();
  } catch (e) {
    if (e.status === 401) { auth.dropSession(); signOutLocal('Tu sesión ha caducado. Vuelve a entrar.'); }
  }
}

export async function trySync(silent) {
  if (!state.user || state.user.needsConsent) return { ok: false };
  const btn = $('#syncBtn');
  btn.classList.add('spin');
  const r = await sync();
  btn.classList.remove('spin');
  if (r.auth) {
    auth.dropSession();
    signOutLocal('Tu sesión ha caducado. Vuelve a entrar.');
    return r;
  }
  if (r.consent) { await refreshMe(); return r; }
  await refreshBadge();
  if (r.ok) {
    if (!silent) toast(`Sincronizado · ${r.sent} enviados, ${r.received} recibidos`);
    if (r.rejected) toast(`${r.rejected} jornadas no se han podido guardar en el servidor (datos no válidos)`);
    if (r.received && !state.stack.some(s => s.kind === 'form') && state.tab !== 'friends') render({ keepScroll: true });
  } else if (!silent) toast(r.reason);
  return r;
}
