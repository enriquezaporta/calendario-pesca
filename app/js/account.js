// Acceso (entrar, crear cuenta, recuperar), aceptación de la política y Ajustes.
import * as db from './db.js';
import * as auth from './auth.js';
import {
  $, view, esc, todayStr, toast, modal, confirmBox, download, state, setTitle, setFab, render, goTab,
  setUser, signOutLocal, refreshBadge, refreshUnread, trySync,
} from './core.js';
import { MODALITIES, MODALITY_IDS } from './modalities.js';

const POLICY_LINKS = `<a href="privacy.html" target="_blank" rel="noopener">política de privacidad</a> y las
  <a href="terms.html" target="_blank" rel="noopener">condiciones de uso</a>`;

const modPicker = (selected, id = 'modpick') => `<div class="chips wrap" id="${id}" role="group" aria-label="Modalidades">${MODALITY_IDS.map(m =>
  `<button type="button" class="chip ${selected.includes(m) ? 'on' : ''}" aria-pressed="${selected.includes(m)}" data-m="${m}">${MODALITIES[m].icon} ${esc(MODALITIES[m].label)}</button>`).join('')}</div>`;

function bindModPicker(root, id = 'modpick') {
  root.querySelectorAll(`#${id} [data-m]`).forEach(b => b.onclick = () => {
    b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on'));
  });
  return () => [...root.querySelectorAll(`#${id} [data-m].on`)].map(b => b.dataset.m);
}

// ---------- entrar a la sesión ----------
export async function startSession(user) {
  setUser(user);
  db.setUser(user.id);
  state.stack = [];
  goTab('calendar');
  await offerLegacyImport();
  refreshBadge();
  trySync(true);
  refreshUnread();
}

// Datos de la versión 1 (sin usuarios) guardados en este dispositivo: se ofrecen al primero que entra.
async function offerLegacyImport() {
  let legacy = [];
  try { legacy = await db.legacySessions(); } catch { return; }
  if (!legacy.length) return;
  const ok = await confirmBox('Jornadas de la versión anterior',
    `En este dispositivo hay ${legacy.length} jornadas de la versión anterior (sin usuarios). ¿Pasarlas a la cuenta de ${state.user.name}? Si no son tuyas, pulsa Cancelar y que entre su dueño en este dispositivo.`,
    'Pasarlas a mi cuenta');
  if (!ok) return;
  const n = await db.importMany(legacy);
  await db.dropLegacy();
  toast(`${n} jornadas pasadas a tu cuenta`);
  render();
}

async function showRecoveryCode(code, intro) {
  await modal({
    title: 'Tu código de recuperación',
    html: `<p>${esc(intro)}</p>
      <div class="code" id="rcode">${esc(code)}</div>
      <div class="actions"><button type="button" class="btn ghost" id="rcopy">Copiar</button></div>
      <p class="hint">Es la única forma de recuperar la cuenta si olvidas la contraseña: no pedimos correo ni teléfono.
      Guárdalo en tu gestor de contraseñas o en un lugar seguro. No se volverá a mostrar.</p>
      <label class="check"><input type="checkbox" id="rsaved"> <span>Lo he guardado</span></label>`,
    actions: [{ label: 'Continuar', value: true }],
    onAction: (_, root) => {
      if (!root.querySelector('#rsaved').checked) throw new Error('Marca que lo has guardado para continuar.');
    },
  });
}
// El botón de copiar se engancha con delegación porque el diálogo se crea dinámicamente.
document.addEventListener('click', e => {
  if (e.target.id !== 'rcopy') return;
  navigator.clipboard?.writeText($('#rcode').textContent).then(() => toast('Copiado'), () => toast('No se ha podido copiar'));
});

// ---------- entrar / crear cuenta / recuperar ----------
let loginMode = 'login';
let signupOpen = true;

async function login() {
  setTitle('Calendario de Pesca');
  const mode = loginMode;
  view.innerHTML = `
   <div class="login-box">
    <div class="login-logo"><img src="icons/icon-192.png" alt="" width="84" height="84"></div>
    ${mode !== 'recover' ? `<div class="seg two" id="mode" role="tablist">
      <button type="button" role="tab" aria-selected="${mode === 'login'}" data-m="login" class="${mode === 'login' ? 'on' : ''}">Entrar</button>
      <button type="button" role="tab" aria-selected="${mode === 'register'}" data-m="register" class="${mode === 'register' ? 'on' : ''}">Crear cuenta</button>
    </div>` : '<h2>Recuperar la cuenta</h2>'}
    <form class="form card" id="lf" autocomplete="on" novalidate>
      ${mode === 'register' && !signupOpen ? '<p>El registro de cuentas nuevas está cerrado en esta instalación.</p>' : ''}
      ${mode === 'register' ? `<label for="l-name">Nombre</label><input id="l-name" name="name" maxlength="40" autocomplete="nickname" placeholder="Cómo te verán tus amigos">` : ''}
      <label for="l-user">Usuario</label><input id="l-user" name="username" maxlength="20" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      ${mode === 'register' ? '<p class="hint">3-20 caracteres: minúsculas, números, punto o guion. Es público: tus amigos te buscarán por él.</p>' : ''}
      ${mode === 'recover' ? `<label for="l-code">Código de recuperación</label><input id="l-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" required>` : ''}
      <label for="l-pw">${mode === 'recover' ? 'Contraseña nueva' : 'Contraseña'}</label>
      <input id="l-pw" name="password" type="password" maxlength="128" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
      ${mode !== 'login' ? '<p class="hint">Mínimo 8 caracteres. Mejor una frase que una palabra.</p>' : ''}
      ${mode === 'register' ? `<label>Tus modalidades</label>${modPicker(['feeder'])}
        <p class="hint">Las que practicas. Podrás registrar jornadas de cualquier modalidad y cambiarlas en Ajustes.</p>
        <label class="check"><input type="checkbox" id="l-consent" required> <span>He leído y acepto la ${POLICY_LINKS}, y tengo 14 años o más.</span></label>` : ''}
      <div class="actions"><button class="btn" type="submit">${{ login: 'Entrar', register: 'Crear cuenta', recover: 'Cambiar contraseña y entrar' }[mode]}</button></div>
      <p class="hint err" id="lerr" role="alert"></p>
      ${mode === 'login' ? '<p class="small center"><button type="button" class="linkbtn" id="forgot">¿Has olvidado la contraseña?</button></p>' : ''}
      ${mode === 'recover' ? '<p class="small center"><button type="button" class="linkbtn" id="toLogin">Volver a entrar</button></p>' : ''}
    </form>
    <p class="muted small center"><a href="privacy.html">Privacidad</a> · <a href="terms.html">Condiciones de uso</a></p>
   </div>
  `;
  view.querySelectorAll('#mode button').forEach(b => b.onclick = () => { loginMode = b.dataset.m; render(); });
  if ($('#forgot')) $('#forgot').onclick = () => { loginMode = 'recover'; render(); };
  if ($('#toLogin')) $('#toLogin').onclick = () => { loginMode = 'login'; render(); };
  const getMods = mode === 'register' ? bindModPicker(view) : null;
  auth.api('/health', { timeout: 4000 }).then(h => {
    if (signupOpen !== h.signup) { signupOpen = h.signup; if (loginMode === 'register') render(); }
  }).catch(() => {});

  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const g = k => (f.get(k) || '').toString();
    const btn = e.target.querySelector('button[type=submit]');
    const err = $('#lerr');
    err.textContent = '';
    if (mode === 'register' && !$('#l-consent').checked) { err.textContent = 'Tienes que aceptar la política de privacidad y las condiciones de uso.'; return; }
    if (mode === 'register' && !getMods().length) { err.textContent = 'Elige al menos una modalidad.'; return; }
    btn.disabled = true;
    try {
      const username = g('username').trim().toLowerCase();
      let res;
      if (mode === 'register') {
        res = await auth.register({ username, name: g('name').trim(), password: g('password'), modalities: getMods(), consent: true });
        await showRecoveryCode(res.recoveryCode, 'Tu cuenta está creada. Este es tu código de recuperación:');
      } else if (mode === 'recover') {
        res = await auth.recover(username, g('code'), g('password'));
        await showRecoveryCode(res.recoveryCode, 'Contraseña cambiada y sesiones antiguas cerradas. El código anterior ya no vale; este es el nuevo:');
      } else {
        res = await auth.login(username, g('password'));
      }
      loginMode = 'login';
      await startSession(res.user);
      toast(`Hola, ${res.user.name}`);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  };
}

// ---------- aceptar la política (cuentas antiguas o política nueva) ----------
async function consent() {
  setTitle('Calendario de Pesca');
  view.innerHTML = `
   <div class="login-box">
    <div class="card form">
      <p class="section-title">Antes de seguir</p>
      <p>Hola, ${esc(state.user.name)}. Hemos actualizado la ${POLICY_LINKS}.
      Explican qué datos guarda la app, quién los ve y cómo descargarlos o borrarlos.</p>
      <ul class="small">
        <li>Tus amigos ven tus jornadas según lo que elijas en Ajustes. Puedes marcar jornadas como privadas.</li>
        <li>El chat solo funciona entre amigos y se puede bloquear o denunciar a cualquiera.</li>
        <li>Sin publicidad, sin rastreo y sin cookies.</li>
      </ul>
      <label class="check"><input type="checkbox" id="c-ok"> <span>He leído y acepto la política de privacidad y las condiciones de uso, y tengo 14 años o más.</span></label>
      <div class="actions"><button class="btn" id="c-accept">Aceptar y continuar</button></div>
      <p class="hint err" id="cerr" role="alert"></p>
      <div class="actions"><button class="btn ghost" id="c-export">Descargar mis datos</button><button class="btn ghost" id="c-out">Cerrar sesión</button></div>
      <p class="hint">Si no estás de acuerdo, puedes descargar tus datos y eliminar la cuenta desde Ajustes después de aceptar,
      o pedir al administrador que la elimine. Tus jornadas siguen guardadas en este dispositivo.</p>
    </div>
   </div>`;
  $('#c-accept').onclick = async () => {
    if (!$('#c-ok').checked) { $('#cerr').textContent = 'Marca la casilla para continuar.'; return; }
    try {
      const { user } = await auth.api('/me/consent', { method: 'POST', body: { version: (await auth.api('/health')).policyVersion } });
      setUser(user);
      await startSession(user);
    } catch (e) { $('#cerr').textContent = e.message; }
  };
  $('#c-export').onclick = exportServerData;
  $('#c-out').onclick = () => logout();
}

// ---------- ajustes ----------
async function exportServerData() {
  try {
    const r = await auth.api('/me/export', { raw: true, timeout: 30000 });
    download(await r.blob(), `calendario-pesca-${state.user.username}-${todayStr()}.json`);
  } catch (e) { toast(e.message); }
}

async function logout() {
  const pend = await db.pendingCount().catch(() => 0);
  const choice = await modal({
    title: 'Cerrar sesión',
    html: `${pend ? `<p><b>Tienes ${pend} cambios sin subir al servidor.</b> Si borras los datos del dispositivo, se perderán.</p>` : ''}
      <label class="check"><input type="checkbox" id="wipe"> <span>Borrar también mis jornadas de este dispositivo</span></label>
      <p class="hint">Márcalo si el dispositivo no es tuyo o lo comparte más gente. Tus datos siguen en el servidor.</p>`,
    actions: [{ label: 'Cancelar' }, { label: 'Cerrar sesión', value: true, cls: 'danger-solid' }],
    onAction: (_, root) => ({ wipe: root.querySelector('#wipe').checked }),
  });
  if (!choice) return;
  const uid = state.user.id;
  await auth.logout();
  if (choice.wipe) await db.dropUserData(uid);
  signOutLocal(choice.wipe ? 'Sesión cerrada y datos borrados de este dispositivo' : 'Sesión cerrada');
}

const askPassword = (title, text, okLabel, path, danger = false) => modal({
  title,
  html: `<p>${esc(text)}</p><label for="ap-pw">Tu contraseña</label><input id="ap-pw" type="password" autocomplete="current-password" maxlength="128">`,
  actions: [{ label: 'Cancelar' }, { label: okLabel, value: true, cls: danger ? 'danger-solid' : '' }],
  onAction: (_, root) => auth.api(path, { method: 'POST', body: { password: root.querySelector('#ap-pw').value } }),
});

async function settings() {
  setTitle('Ajustes'); setFab(false);
  const u = state.user;
  const n = await db.pendingCount();
  const last = await db.getMeta('lastSyncOk');
  const total = (await db.allSessions()).length;
  view.innerHTML = `
   <div class="cols settings">
    <div>
    <div class="card form">
      <p class="section-title">Perfil</p>
      <p class="muted small">Tu usuario: <b>@${esc(u.username)}</b></p>
      <label for="s-name">Nombre visible</label>
      <div class="addrow"><input id="s-name" maxlength="40" value="${esc(u.name)}"><button class="btn ghost" id="s-name-save">Guardar</button></div>
      <label>Mis modalidades</label>
      ${modPicker(u.modalities || [], 's-mods')}
      <div class="actions"><button class="btn ghost" id="s-mods-save">Guardar modalidades</button></div>
    </div>

    <div class="card form">
      <p class="section-title">Privacidad</p>
      <p class="small">Qué ven tus amigos de tus jornadas:</p>
      <label class="check"><input type="radio" name="share" value="results" ${u.shareLevel !== 'full' ? 'checked' : ''}> <span><b>Solo resultados</b><br><span class="muted small">Nombre y fecha de la jornada, modalidad, localidad y escenario, competición, peso, piezas, pieza mayor, especies y puestos.</span></span></label>
      <label class="check"><input type="radio" name="share" value="full" ${u.shareLevel === 'full' ? 'checked' : ''}> <span><b>Todo</b><br><span class="muted small">Además, la preparación (cebos, engodo, montajes…), el tiempo y la descripción.</span></span></label>
      <p class="hint">Las jornadas marcadas como privadas no las ve nadie. Nadie que no sea tu amigo ve nada.</p>
    </div>

    <div class="card form">
      <p class="section-title">Seguridad</p>
      <details>
        <summary>Cambiar contraseña</summary>
        <label for="pwCur">Contraseña actual</label><input type="password" id="pwCur" autocomplete="current-password" maxlength="128">
        <label for="pwNew">Contraseña nueva</label><input type="password" id="pwNew" autocomplete="new-password" maxlength="128">
        <p class="hint">Mínimo 8 caracteres. Se cerrará la sesión en tus otros dispositivos.</p>
        <div class="actions"><button class="btn ghost" id="pwSave">Cambiar</button></div>
      </details>
      <div class="actions"><button class="btn ghost" id="s-recovery">${u.hasRecovery ? 'Nuevo código de recuperación' : 'Crear código de recuperación'}</button></div>
      ${u.hasRecovery ? '' : '<p class="hint warn">Aún no tienes código de recuperación: si olvidas la contraseña no podrás recuperar la cuenta tú solo.</p>'}
      <div class="actions"><button class="btn ghost" id="s-others">Cerrar sesión en los demás dispositivos</button></div>
    </div>
    </div>

    <div>
    <div class="card">
      <p class="section-title">Sincronización</p>
      <p class="small">Servidor: <b>${esc(location.host)}</b></p>
      <p class="muted small">Última sincronización: ${last ? new Date(last).toLocaleString('es-ES') : 'nunca'}<br>Cambios pendientes: ${n}</p>
      <div class="actions"><button class="btn" id="doSync">Sincronizar ahora</button></div>
      <p class="hint">Tus jornadas se guardan siempre en el dispositivo y se suben al servidor al abrir la app y al guardar, si hay conexión.</p>
    </div>

    <div class="card">
      <p class="section-title">Tus datos</p>
      <p class="muted small">${total} jornadas en este dispositivo.</p>
      <div class="actions"><button class="btn ghost" id="s-export">Descargar todos mis datos</button></div>
      <p class="hint">Un archivo JSON con tu cuenta, jornadas, amigos y mensajes, tal y como están en el servidor.</p>
      <div class="actions">
        <button class="btn ghost" id="exp">Exportar jornadas</button>
        <button class="btn ghost" id="imp">Importar jornadas</button>
      </div>
      <input type="file" id="file" accept="application/json,.json" hidden>
      <div class="actions"><button class="btn danger" id="s-delete">Eliminar mi cuenta</button></div>
    </div>

    <div class="card">
      <div class="actions"><button class="btn danger" id="logout">Cerrar sesión</button></div>
    </div>
    </div>
   </div>
    <p class="muted small center">Calendario de Pesca <span id="ver"></span> ·
      <a href="privacy.html">Privacidad</a> · <a href="terms.html">Condiciones de uso</a> ·
      <a href="https://github.com/enriquezaporta/calendario-pesca" target="_blank" rel="noopener">Código fuente</a></p>
  `;
  const getMods = bindModPicker(view, 's-mods');
  const saveProfile = async (body, msg) => {
    try { const res = await auth.api('/me', { method: 'POST', body }); setUser(res.user); toast(msg); }
    catch (e) { toast(e.message); }
  };
  $('#s-name-save').onclick = () => saveProfile({ name: $('#s-name').value }, 'Nombre guardado');
  $('#s-mods-save').onclick = () => {
    const mods = getMods();
    if (!mods.length) return toast('Elige al menos una modalidad');
    saveProfile({ modalities: mods }, 'Modalidades guardadas');
  };
  view.querySelectorAll('input[name=share]').forEach(r => r.onchange = () => saveProfile({ shareLevel: r.value }, 'Preferencia guardada'));
  $('#pwSave').onclick = async () => {
    try {
      await auth.api('/me/password', { method: 'POST', body: { current: $('#pwCur').value, password: $('#pwNew').value } });
      toast('Contraseña cambiada'); render();
    } catch (e) { toast(e.message); }
  };
  $('#s-recovery').onclick = async () => {
    const res = await askPassword('Código de recuperación', 'Se creará un código nuevo y el anterior dejará de valer.', 'Crear código', '/me/recovery');
    if (!res) return;
    await showRecoveryCode(res.recoveryCode, 'Este es tu nuevo código de recuperación:');
    setUser({ ...state.user, hasRecovery: true });
    render({ keepScroll: true });
  };
  $('#s-others').onclick = async () => {
    try { const r = await auth.api('/auth/logout-others', { method: 'POST' }); toast(r.closed ? `${r.closed} sesiones cerradas` : 'No había otras sesiones abiertas'); }
    catch (e) { toast(e.message); }
  };
  $('#doSync').onclick = () => trySync(false).then(() => render({ keepScroll: true }));
  $('#s-export').onclick = exportServerData;
  $('#exp').onclick = async () => {
    const data = await db.allSessions();
    download(new Blob([JSON.stringify({ app: 'calendario-pesca', exportedAt: new Date().toISOString(), sessions: data.map(({ dirty, ...r }) => r) }, null, 2)], { type: 'application/json' }),
      `jornadas-${todayStr()}.json`);
  };
  $('#imp').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast('El archivo es demasiado grande');
    try {
      const json = JSON.parse(await file.text());
      const n = await db.importMany(Array.isArray(json) ? json : json.sessions || []);
      toast(`${n} jornadas importadas`); refreshBadge(); render(); trySync(true);
    } catch { toast('El archivo no es válido'); }
  };
  $('#s-delete').onclick = async () => {
    const res = await modal({
      title: 'Eliminar mi cuenta',
      html: `<p>Se borrarán <b>para siempre</b> tu cuenta, todas tus jornadas, tus amistades y los mensajes de tus conversaciones, en el servidor y en este dispositivo.</p>
        <p class="small">Si quieres conservarlas, descarga antes tus datos.</p>
        <label for="del-user">Escribe tu usuario (<b>${esc(u.username)}</b>)</label><input id="del-user" autocapitalize="none" autocomplete="off">
        <label for="del-pw">Tu contraseña</label><input id="del-pw" type="password" autocomplete="current-password" maxlength="128">`,
      actions: [{ label: 'Cancelar' }, { label: 'Eliminar para siempre', value: true, cls: 'danger-solid' }],
      onAction: async (_, root) => {
        if (root.querySelector('#del-user').value.trim().toLowerCase() !== u.username) throw new Error('El usuario no coincide.');
        await auth.api('/me/delete', { method: 'POST', body: { password: root.querySelector('#del-pw').value } });
      },
    });
    if (!res) return;
    await db.dropUserData(u.id);
    auth.dropSession();
    signOutLocal('Tu cuenta y tus datos se han eliminado');
  };
  $('#logout').onclick = logout;
  if ('caches' in window) caches.keys().then(k => { const v = k.find(x => x.startsWith('pesca-')); if (v && $('#ver')) $('#ver').textContent = v.replace('pesca-', ''); });
}

export const accountScreens = { login, consent, settings };
