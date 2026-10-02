// Amigos, comparativa y chat. Todo esto necesita conexión con el servidor.
import * as db from './db.js';
import * as auth from './auth.js';
import {
  $, view, esc, fmtKgShort, fmtDay, isComp, todayStr, initial, toast, modal, confirmBox, state, setTitle, setFab,
  render, push, pop, every, signOutLocal, setUnread, refreshUnread,
} from './core.js';
import { MODALITIES, modalityOf, cleanRecord } from './modalities.js';
import { itemHTML, bindItems, seasonStats, fmtRank, modChips, byMod, yearsOf, yearChips } from './journal.js';

const modsText = u => (u.modalities || []).map(m => MODALITIES[m]?.label).filter(Boolean).join(', ');
const offline = msg => `<div class="empty">${msg || 'No se puede conectar con el servidor.'}<br>Los amigos y el chat necesitan conexión con el servidor.</div>`;

async function guard(promise) {
  try { return await promise; } catch (e) {
    if (e.status === 401) { auth.dropSession(); signOutLocal('Tu sesión ha caducado. Vuelve a entrar.'); }
    throw e;
  }
}

// ---------- lista de amigos ----------
async function friends() {
  setTitle('Amigos'); setFab(false);
  view.innerHTML = `<div class="empty">Cargando…</div>`;
  let data, chats;
  try {
    [data, chats] = await guard(Promise.all([auth.api('/friends'), auth.api('/chats')]));
  } catch (e) {
    if (state.user) view.innerHTML = offline(e.status ? esc(e.message) : '');
    return;
  }
  const unreadBy = Object.fromEntries(chats.chats.map(c => [c.user.username, c.unread]));
  setUnread(chats.chats.reduce((a, c) => a + c.unread, 0));
  const friendSet = new Set(data.friends.map(u => u.username));
  const blockedSet = new Set(data.blocked.map(u => u.username));
  const otherChats = chats.chats.filter(c => !friendSet.has(c.user.username) && !blockedSet.has(c.user.username));

  const who = u => `<div class="avatar" aria-hidden="true">${initial(u)}</div>
    <div class="who"><div class="ttl">${esc(u.name)}</div><div class="sub">@${esc(u.username)}${modsText(u) ? ' · ' + esc(modsText(u)) : ''}</div></div>`;
  const row = (u, buttons) => `<div class="item friend"><div class="friend-main static">${who(u)}</div><div class="fbtns">${buttons}</div></div>`;
  const friendRow = u => {
    const n = unreadBy[u.username] || 0;
    return `<div class="item friend"><button class="friend-main" data-f="${esc(u.username)}">${who(u)}</button>
      <div class="fbtns"><button class="mini chatbtn" data-chat="${esc(u.username)}" aria-label="Chat con ${esc(u.name)}${n ? ', ' + n + ' sin leer' : ''}">Chat${n ? ` <span class="nbadge">${n}</span>` : ''}</button></div></div>`;
  };

  view.innerHTML = `
   <div class="cols">
    <div>
    <form class="form card" id="addf">
      <p class="section-title">Añadir amigo</p>
      <div class="addrow"><input name="username" aria-label="Usuario de tu amigo" placeholder="Su usuario" maxlength="20" autocapitalize="none" autocorrect="off" spellcheck="false" required><button class="btn" type="submit">Enviar</button></div>
      <p class="hint">Tu usuario es <b>@${esc(state.user.username)}</b>. Cuando acepte, podréis comparar resultados y hablar por chat.</p>
    </form>
    ${data.incoming.length ? `<h2>Solicitudes recibidas</h2>${data.incoming.map(u => row(u, `<button class="mini ok" data-acc="${esc(u.username)}">Aceptar</button><button class="mini" data-rm="${esc(u.username)}" aria-label="Rechazar">✕</button><button class="mini" data-block="${esc(u.username)}">Bloquear</button>`)).join('')}` : ''}
    ${data.outgoing.length ? `<h2>Solicitudes enviadas</h2>${data.outgoing.map(u => row(u, `<span class="muted small">Pendiente</span><button class="mini" data-rm="${esc(u.username)}" aria-label="Cancelar solicitud">✕</button>`)).join('')}` : ''}
    ${data.blocked.length ? `<h2>Bloqueados</h2>${data.blocked.map(u => row(u, `<button class="mini" data-unblock="${esc(u.username)}">Desbloquear</button>`)).join('')}` : ''}
    </div>
    <div>
    <h2 class="first">Mis amigos</h2>
    ${data.friends.length ? data.friends.map(friendRow).join('') : '<div class="empty">Todavía no tienes amigos añadidos.</div>'}
    ${otherChats.length ? `<h2>Otras conversaciones</h2>${otherChats.map(c => `<div class="item friend"><button class="friend-main" data-chat="${esc(c.user.username)}">${who(c.user)}</button>
      <div class="fbtns">${c.unread ? `<span class="nbadge">${c.unread}</span>` : ''}</div></div>`).join('')}` : ''}
    </div>
   </div>
  `;
  const act = async (path, username, okMsg) => {
    try { await guard(auth.api(path, { method: 'POST', body: { username } })); if (okMsg) toast(okMsg); render({ keepScroll: true }); }
    catch (e) { toast(e.message); }
  };
  $('#addf').onsubmit = e => {
    e.preventDefault();
    act('/friends/request', new FormData(e.target).get('username').trim().toLowerCase(), 'Solicitud enviada');
  };
  view.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => act('/friends/accept', b.dataset.acc, 'Ya sois amigos'));
  view.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => act('/friends/remove', b.dataset.rm));
  view.querySelectorAll('[data-unblock]').forEach(b => b.onclick = () => act('/blocks/remove', b.dataset.unblock, 'Desbloqueado'));
  view.querySelectorAll('[data-block]').forEach(b => b.onclick = async () => {
    if (await confirmBox('Bloquear', `@${b.dataset.block} no podrá enviarte solicitudes ni mensajes.`, 'Bloquear', true)) act('/blocks', b.dataset.block, 'Bloqueado');
  });
  view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => push({ kind: 'friend', username: b.dataset.f, tab: 'compare' }));
  view.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => push({ kind: 'friend', username: b.dataset.chat, tab: 'chat' }));
}

// ---------- pantalla de un amigo: comparar | chat ----------
async function friend(top) {
  setFab(false);
  const username = top.username;
  setTitle('Amigos');
  view.innerHTML = `<button class="back" id="back">‹ Amigos</button><div class="empty">Cargando…</div>`;
  $('#back').onclick = pop;
  let fd = state.friendData[username];
  let isFriend = true;
  if (!fd) {
    try {
      fd = await guard(auth.api('/friends/' + encodeURIComponent(username) + '/sessions'));
      fd.sessions = fd.sessions.map(cleanRecord).filter(Boolean);
      fd.sessions.forEach(s => { s._owner = fd.user.name; s._limited = fd.shareLevel !== 'full'; });
      state.friendData[username] = fd;
    } catch (e) {
      if (!state.user) return;
      if (e.status !== 403) { view.innerHTML = `<button class="back" id="back">‹ Amigos</button>${offline(esc(e.message))}`; $('#back').onclick = pop; return; }
      isFriend = false;  // ya no sois amigos: solo queda el historial del chat
      top.tab = 'chat';
    }
  }
  const user = fd?.user || { username, name: '@' + username, modalities: [] };
  setTitle(user.name);
  view.innerHTML = `
    <button class="back" id="back">‹ Amigos</button>
    <div class="friend-head">
      <div class="avatar big" aria-hidden="true">${initial(user)}</div>
      <div class="who"><h2>${esc(user.name)}</h2><div class="sub">@${esc(user.username)}${modsText(user) ? ' · ' + esc(modsText(user)) : ''}</div></div>
      <button class="mini" id="more" aria-label="Más opciones">⋯</button>
    </div>
    ${isFriend ? `<div class="seg two" id="ftab" role="tablist">
      <button type="button" role="tab" data-t="compare" aria-selected="${top.tab !== 'chat'}" class="${top.tab !== 'chat' ? 'on' : ''}">Comparar</button>
      <button type="button" role="tab" data-t="chat" aria-selected="${top.tab === 'chat'}" class="${top.tab === 'chat' ? 'on' : ''}">Chat</button>
    </div>` : ''}
    <div id="fbody"></div>
  `;
  $('#back').onclick = pop;
  view.querySelectorAll('#ftab button').forEach(b => b.onclick = () => { top.tab = b.dataset.t; render(); });
  $('#more').onclick = () => friendMenu(user, isFriend);
  if (top.tab === 'chat') return chat(user);
  return compare(fd);
}

async function friendMenu(user, isFriend) {
  const choice = await modal({
    title: user.name,
    html: '<p class="muted small">¿Qué quieres hacer?</p>',
    actions: [
      { label: 'Cancelar' },
      ...(isFriend ? [{ label: 'Quitar de amigos', value: 'remove', cls: 'ghost' }] : []),
      { label: 'Denunciar', value: 'report', cls: 'ghost' },
      { label: 'Bloquear', value: 'block', cls: 'danger-solid' },
    ],
  });
  try {
    if (choice === 'remove' && await confirmBox('Quitar de amigos', `Dejaréis de ver vuestras jornadas y no podréis escribiros.`, 'Quitar', true)) {
      await guard(auth.api('/friends/remove', { method: 'POST', body: { username: user.username } }));
      delete state.friendData[user.username]; toast('Ya no sois amigos'); pop();
    } else if (choice === 'block' && await confirmBox('Bloquear', `@${user.username} dejará de ser tu amigo y no podrá enviarte solicitudes ni mensajes. Puedes desbloquearlo desde Amigos.`, 'Bloquear', true)) {
      await guard(auth.api('/blocks', { method: 'POST', body: { username: user.username } }));
      delete state.friendData[user.username]; toast('Bloqueado'); pop();
    } else if (choice === 'report') {
      await reportUser(user);
    }
  } catch (e) { toast(e.message); }
}

async function reportUser(user, messageId = null) {
  const lastTheirs = messageId ?? [...document.querySelectorAll('#msgs .msg.theirs')].pop()?.dataset.id;
  await modal({
    title: 'Denunciar a ' + user.name,
    html: `<label for="r-reason">Motivo</label>
      <select id="r-reason"><option value="spam">Spam</option><option value="acoso">Acoso o amenazas</option><option value="inapropiado">Contenido inapropiado</option><option value="otro">Otro</option></select>
      <label for="r-details">Detalles (opcional)</label><textarea id="r-details" maxlength="500"></textarea>
      ${lastTheirs ? '<label class="check"><input type="checkbox" id="r-msg" checked> <span>Adjuntar su último mensaje</span></label>' : ''}
      <p class="hint">La denuncia la revisa el administrador de esta instalación. ${esc(user.name)} no sabrá quién le ha denunciado.</p>`,
    actions: [{ label: 'Cancelar' }, { label: 'Enviar denuncia', value: true, cls: 'danger-solid' }],
    onAction: async (_, root) => {
      const body = { username: user.username, reason: root.querySelector('#r-reason').value, details: root.querySelector('#r-details').value };
      if (lastTheirs && root.querySelector('#r-msg')?.checked) body.messageId = +lastTheirs;
      await guard(auth.api('/reports', { method: 'POST', body }));
      toast('Denuncia enviada. Gracias.');
    },
  });
}

// ---------- comparativa ----------
async function compare(fd) {
  const friend = fd.user;
  const box = $('#fbody');
  const mine = await db.allSessions();
  const theirs = fd.sessions.slice().sort((a, b) => b.date.localeCompare(a.date));
  const years = [...new Set(yearsOf(mine).concat(yearsOf(theirs)))].sort((a, b) => b - a);
  const Y = state.compareYear;
  const inY = list => list.filter(s => +s.date.slice(0, 4) === Y);
  const M = state.compareMod;
  const a = seasonStats(byMod(inY(mine), M)), b = seasonStats(byMod(inY(theirs), M));

  const cmp = (label, va, vb, fmt, better) => {
    let wa = '', wb = '';
    if (better && va != null && vb != null && va !== vb) {
      const aWins = better === 'high' ? va > vb : va < vb;
      (aWins ? (wa = 'win') : (wb = 'win'));
    }
    return `<tr><td class="${wa}">${esc(fmt(va))}</td><th>${label}</th><td class="${wb}">${esc(fmt(vb))}</td></tr>`;
  };
  const id = v => v ?? '—';
  const kg = v => v == null ? '—' : fmtKgShort(v);

  // Cara a cara: mismo día y misma modalidad, los dos en competición.
  const theirByDate = {};
  const today = todayStr();
  byMod(inY(theirs), M).filter(s => isComp(s) && s.date <= today).forEach(s => (theirByDate[s.date] ||= []).push(s));
  const h2h = byMod(inY(mine), M).filter(s => isComp(s) && s.date <= today && theirByDate[s.date]).sort((x, y) => y.date.localeCompare(x.date)).map(s => {
    const same = theirByDate[s.date].filter(t => modalityOf(t) === modalityOf(s));
    const o = same.find(t => (t.competition && t.competition === s.competition) || (t.venue && t.venue === s.venue)) || same[0];
    if (!o) return null;
    let res = 0;
    if (s.weightG != null && o.weightG != null && s.weightG !== o.weightG) res = s.weightG > o.weightG ? 1 : -1;
    else if (s.sectorRank && o.sectorRank && s.sectorRank !== o.sectorRank) res = s.sectorRank < o.sectorRank ? 1 : -1;
    return { s, o, res };
  }).filter(Boolean);
  const score = [h2h.filter(x => x.res > 0).length, h2h.filter(x => x.res < 0).length];
  const h2hRows = h2h.map(({ s, o, res }) => `<tr>
      <td class="${res > 0 ? 'win' : ''}">${kg(s.weightG)}<br><small>${esc(s.pieces ?? '—')} pz${s.sectorRank ? ' · ' + esc(s.sectorRank) + 'º' : ''}</small></td>
      <th>${fmtDay(s.date)}<br><small>${esc(s.venue || s.competition || '')}</small></th>
      <td class="${res < 0 ? 'win' : ''}">${kg(o.weightG)}<br><small>${esc(o.pieces ?? '—')} pz${o.sectorRank ? ' · ' + esc(o.sectorRank) + 'º' : ''}</small></td></tr>`).join('');
  const theirYear = byMod(inY(theirs), M);

  box.innerHTML = `
    ${yearChips(years, Y)}
    ${modChips(inY(mine).concat(inY(theirs)), M)}
   <div class="cols">
    <div>
    <h2 class="first">Temporada ${Y}</h2>
    <div class="card">
      <table class="t cmp">
        <tr><td class="who">Tú</td><th></th><td class="who">${esc(friend.name)}</td></tr>
        ${cmp('Competiciones', a.comps.length, b.comps.length, id, null)}
        ${cmp('Entrenamientos', a.trains.length, b.trains.length, id, null)}
        ${cmp('Kg en competición', a.totalW, b.totalW, kg, 'high')}
        ${cmp('Piezas', a.totalP, b.totalP, id, 'high')}
        ${cmp('Kg de media', a.avgW, b.avgW, kg, 'high')}
        ${cmp('Mejor jornada', a.best?.weightG, b.best?.weightG, kg, 'high')}
        ${cmp('Pieza mayor', a.biggest, b.biggest, kg, 'high')}
        ${cmp('Puesto medio sector', a.avgRank, b.avgRank, fmtRank, 'low')}
        ${cmp('Victorias de sector', a.wins, b.wins, id, 'high')}
      </table>
    </div>
    </div>
    <div>
    <h2 class="first">Cara a cara ${h2h.length ? `<span class="muted small">· ${score[0]}–${score[1]}</span>` : ''}</h2>
    ${h2h.length ? `<div class="card"><table class="t cmp"><tr><td class="who">Tú</td><th></th><td class="who">${esc(friend.name)}</td></tr>${h2hRows}</table>
      <p class="hint">Competiciones del mismo día y modalidad. Gana quien más peso hizo; si no hay peso, el mejor puesto de sector.</p></div>`
      : `<div class="empty">Aún no habéis coincidido en ninguna competición en ${Y}.</div>`}
    </div>
   </div>
    <h2>Jornadas de ${esc(friend.name)} en ${Y}</h2>
    ${fd.shareLevel !== 'full' ? `<p class="hint">${esc(friend.name)} comparte solo los resultados (sin preparación, tiempo ni descripción).</p>` : ''}
    ${theirYear.length ? `<div class="items">${theirYear.map(itemHTML).join('')}</div>` : '<div class="empty">Sin jornadas compartidas.</div>'}
    <p class="hint" style="text-align:center">Datos descargados del servidor. <button class="linkbtn" id="reload">Actualizar</button></p>
  `;
  $('#reload').onclick = () => { delete state.friendData[friend.username]; render(); };
  box.querySelectorAll('[data-y]').forEach(btn => btn.onclick = () => { state.compareYear = +btn.dataset.y; render({ keepScroll: true }); });
  box.querySelectorAll('[data-mod]').forEach(btn => btn.onclick = () => { state.compareMod = btn.dataset.mod; render({ keepScroll: true }); });
  bindItems(box, theirs);
}

// ---------- chat ----------
const timeOf = iso => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const dayOf = iso => (d => d[0].toUpperCase() + d.slice(1))(new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));

async function chat(user) {
  const box = $('#fbody');
  box.innerHTML = `
    <div class="chat">
      <div class="msgs" id="msgs" role="log" aria-live="polite" aria-label="Mensajes con ${esc(user.name)}"><div class="empty">Cargando…</div></div>
      <form class="chat-input" id="cf" hidden>
        <textarea id="ctext" rows="1" maxlength="2000" aria-label="Mensaje" placeholder="Escribe un mensaje"></textarea>
        <button class="btn" type="submit">Enviar</button>
      </form>
      <p class="hint" id="cnote" hidden></p>
      <p class="hint chat-privacy">Los mensajes se guardan en el servidor de esta instalación y no van cifrados de extremo a extremo.</p>
    </div>`;
  const msgs = $('#msgs');
  let lastId = 0, lastDay = '', seenUpTo = 0, loaded = false;

  const markSeen = () => {
    msgs.querySelectorAll('.msg.mine .seen').forEach(el => el.remove());
    const mineEls = [...msgs.querySelectorAll('.msg.mine')].filter(el => +el.dataset.id <= seenUpTo);
    const last = mineEls.pop();
    if (last) { const s = document.createElement('span'); s.className = 'seen'; s.textContent = ' · Leído'; last.querySelector('.meta').appendChild(s); }
  };
  const append = list => {
    if (!loaded) { msgs.textContent = ''; loaded = true; }
    const nearBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    for (const m of list) {
      if (m.id <= lastId) continue;
      lastId = m.id;
      const day = dayOf(m.createdAt);
      if (day !== lastDay) {
        lastDay = day;
        const d = document.createElement('div'); d.className = 'daysep'; d.textContent = day; msgs.appendChild(d);
      }
      const el = document.createElement('div');
      el.className = 'msg ' + (m.mine ? 'mine' : 'theirs');
      el.dataset.id = m.id;
      const body = document.createElement('div'); body.className = 'body'; body.textContent = m.body;  // texto, nunca HTML
      const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = timeOf(m.createdAt);
      el.append(body, meta);
      msgs.appendChild(el);
    }
    if (!msgs.querySelector('.msg') && !msgs.querySelector('.empty')) {
      msgs.innerHTML = `<div class="empty">Aún no hay mensajes. ¡Saluda a ${esc(user.name)}!</div>`; loaded = false;
    }
    if (list.length && (nearBottom || list.some(m => m.mine))) msgs.scrollTop = msgs.scrollHeight;
  };
  const load = async () => {
    const res = await guard(auth.api(`/chats/${encodeURIComponent(user.username)}?after=${lastId}`));
    append(res.messages);
    seenUpTo = res.seenUpTo; markSeen();
    $('#cf').hidden = !res.canSend;
    $('#cnote').hidden = res.canSend;
    $('#cnote').textContent = res.canSend ? '' : 'No puedes escribir a este usuario: no sois amigos o hay un bloqueo.';
    if (res.messages.some(m => !m.mine)) refreshUnread();
  };
  try { await load(); } catch (e) { if (state.user) msgs.innerHTML = offline(esc(e.message)); return; }
  msgs.scrollTop = msgs.scrollHeight;
  every(4000, () => { if (document.visibilityState === 'visible') load().catch(() => {}); });

  const text = $('#ctext');
  const grow = () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 140) + 'px'; };
  text.addEventListener('input', grow);
  // En el ordenador, Intro envía y Mayús+Intro hace salto de línea.
  text.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(hover: hover)').matches) { e.preventDefault(); $('#cf').requestSubmit(); }
  });
  $('#cf').onsubmit = async e => {
    e.preventDefault();
    const body = text.value.trim();
    if (!body) return;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const res = await guard(auth.api(`/chats/${encodeURIComponent(user.username)}`, { method: 'POST', body: { body } }));
      text.value = ''; grow();
      append([res.message]);
    } catch (err) { toast(err.message); }
    btn.disabled = false;
    text.focus();
  };
  if (matchMedia('(hover: hover)').matches) text.focus();
}

export const socialScreens = { friends, friend };
