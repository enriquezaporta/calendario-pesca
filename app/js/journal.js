// Pantallas del diario: calendario, registro, ficha, formulario y temporada.
import * as db from './db.js';
import {
  $, view, esc, pad, ymd, todayStr, num, int, fmtKgShort, fmtNum, fmtDate, MONTHS, TYPES, isComp,
  SKY, SKY_LABEL, WIND, WIND_DIR, toast, confirmBox, modal, state, setTitle, setFab, render, push, pop,
  refreshBadge, trySync,
} from './core.js';
import { MODALITIES, MODALITY_IDS, TIDES, modality, modalityOf, prepKeys } from './modalities.js';
import { norm, placeIndex, matchPlace, filterLabel, placePicker, venuesOf, townOfVenue } from './places.js';

// ---------- piezas compartidas ----------
export function itemHTML(s) {
  const t = TYPES[s.type] || TYPES.concurso;
  const place = [s.venue, s.town].filter(Boolean).join(' · ');
  const where = [place, s.competition && (s.competition + (s.round ? ' · J' + s.round : ''))].filter(Boolean).join(' — ');
  const hasRes = s.weightG != null || s.pieces != null;
  const res = hasRes
    ? `<b>${fmtKgShort(s.weightG)}<small> kg</small></b><span>${esc(s.pieces ?? '—')} pz${s.sectorRank ? ' · ' + esc(s.sectorRank) + 'º sec.' : ''}</span>`
    : (s.date >= todayStr() ? '<span>Próximo</span>' : '<span>Sin datos</span>');
  return `<button class="item" data-open="${esc(s.id)}">
    <div class="bar" style="background:${t.color}"></div>
    <div><div class="ttl">${esc(s.title || t.label)}${s.private ? ' <span class="lock" title="Privada">🔒</span>' : ''}</div>
      <div class="sub"><span class="modtag">${esc(modality(modalityOf(s)).label)}</span> ${fmtDate(s.date)}${s.time ? ' · ' + esc(s.time) : ''}${where ? '<br>' + esc(where) : ''}</div></div>
    <div class="res">${res}</div>
  </button>`;
}

// friendRecs: si se pasa (jornadas de un amigo), la ficha se abre en solo lectura con ese registro.
export function bindItems(root = view, friendRecs = null) {
  root.querySelectorAll('[data-open]').forEach(b => b.onclick = e => {
    e.stopPropagation(); // en escritorio las jornadas van dentro de la celda del día
    const rec = friendRecs && friendRecs.find(s => s.id === b.dataset.open);
    push({ kind: 'detail', id: b.dataset.open, rec });
  });
}

// Chips de filtro por modalidad: solo aparecen si en la lista hay más de una.
export function modChips(list, current, attr = 'data-mod') {
  const used = MODALITY_IDS.filter(id => list.some(s => modalityOf(s) === id));
  if (used.length < 2) return '';
  return `<div class="chips">${[['all', 'Todas'], ...used.map(id => [id, MODALITIES[id].label])]
    .map(([v, l]) => `<button class="chip ${v === current ? 'on' : ''}" ${attr}="${v}">${esc(l)}</button>`).join('')}</div>`;
}
export const byMod = (list, mod) => mod === 'all' ? list : list.filter(s => modalityOf(s) === mod);
export const yearsOf = list => [...new Set(list.map(s => +s.date.slice(0, 4)).concat(new Date().getFullYear()))].sort((a, b) => b - a);
export const yearChips = (years, current) => `<div class="chips">${years.map(y => `<button class="chip ${y === current ? 'on' : ''}" data-y="${y}">${y}</button>`).join('')}</div>`;

const sum = (arr, k) => arr.reduce((a, s) => a + (typeof s[k] === 'number' ? s[k] : 0), 0);

// Estadísticas de un año (jornadas ya filtradas). Se usa en Temporada y en la comparativa.
export function seasonStats(yr) {
  const today = todayStr();
  const comps = yr.filter(s => isComp(s) && s.date <= today);
  const fished = comps.filter(s => typeof s.weightG === 'number');
  const trains = yr.filter(s => s.type === 'entrenamiento' && s.date <= today);
  const totalW = sum(fished, 'weightG');
  const ranked = comps.filter(s => s.sectorRank);
  const withBig = yr.filter(s => s.date <= today && typeof s.biggestG === 'number');
  return {
    comps, fished, trains, totalW,
    totalP: sum(comps, 'pieces'),
    avgW: fished.length ? totalW / fished.length : null,
    best: fished.slice().sort((a, b) => b.weightG - a.weightG)[0],
    biggest: withBig.length ? Math.max(...withBig.map(s => s.biggestG)) : null,
    wins: ranked.filter(s => s.sectorRank === 1).length,
    avgRank: ranked.length ? sum(ranked, 'sectorRank') / ranked.length : null,
    pending: yr.filter(s => isComp(s) && s.date > today).length,
  };
}
export const fmtRank = r => r == null ? '—' : r.toLocaleString('es-ES', { maximumFractionDigits: 1 });

// ---------- calendario ----------
async function calendar() {
  setTitle('Calendario'); setFab(true);
  const everything = await db.allSessions();
  const index = placeIndex(everything);
  // Filtro por localidad / escenario (si la localidad o el escenario ya no existen, se quita).
  if (state.place && !filterLabel(index, state.place)) state.place = null;
  const f = state.place;
  const all = f ? everything.filter(s => matchPlace(s, f)) : everything;
  const m = state.month;
  const y = m.getFullYear(), mo = m.getMonth();
  const byDay = {};
  for (const s of all) (byDay[s.date] ||= []).push(s);

  const first = new Date(y, mo, 1);
  const offset = (first.getDay() + 6) % 7; // lunes primero
  const start = new Date(y, mo, 1 - offset);
  const today = todayStr();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (i >= 35 && d.getMonth() !== mo) break;
    const key = ymd(d);
    const ev = byDay[key] || [];
    const cls = ['day', d.getMonth() !== mo && 'out', key === today && 'today', key === state.selDay && 'sel'].filter(Boolean).join(' ');
    // En escritorio se ven los nombres (.evs); en el móvil, los puntos (.dots).
    const evs = ev.slice(0, 3).map(s => `<div class="ev t-${s.type}" data-open="${esc(s.id)}"><span>${esc(s.title || TYPES[s.type]?.label || '')}</span>${s.weightG != null ? `<small>${fmtKgShort(s.weightG)} kg${s.pieces != null ? ' · ' + esc(s.pieces) + ' pz' : ''}</small>` : ''}</div>`).join('')
      + (ev.length > 3 ? `<div class="ev more">+${ev.length - 3} más</div>` : '');
    cells += `<button class="${cls}" data-day="${key}" aria-label="${d.getDate()}${ev.length ? ', ' + ev.length + ' jornadas' : ''}"><span class="dnum">${d.getDate()}</span><div class="dots">${ev.slice(0, 4).map(s => `<i class="dot t-${s.type}"></i>`).join('')}</div><div class="evs">${evs}</div></button>`;
  }

  const monthPrefix = `${y}-${pad(mo + 1)}`;
  let listTitle, list;
  if (state.selDay && state.selDay.startsWith(monthPrefix)) {
    listTitle = fmtDate(state.selDay);
    list = (byDay[state.selDay] || []);
  } else {
    listTitle = 'Este mes';
    list = all.filter(s => s.date.startsWith(monthPrefix)).sort((a, b) => a.date.localeCompare(b.date));
  }
  const upcoming = all.filter(s => s.date >= today && isComp(s)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const label = f ? filterLabel(index, f) : '';
  const matches = f ? all.slice().sort((a, b) => b.date.localeCompare(a.date)) : [];
  const noTown = f && !f.town;

  view.innerHTML = `
   <div class="cal-layout">
    <section class="cal-main">
    <div class="placebar">
      <div id="placePicker"></div>
      ${f ? `<div class="pp-chip" role="status"><span>📍 ${esc(label)}</span><span class="muted small">${all.length} ${all.length === 1 ? 'jornada' : 'jornadas'}</span>
        <button type="button" class="mini" id="placeClear" aria-label="Quitar filtro de lugar">✕</button></div>` : ''}
    </div>
    <div class="monthnav">
      <button id="prev" aria-label="Mes anterior">‹</button>
      <h2>${(s => s[0].toUpperCase() + s.slice(1))(m.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }))}</h2>
      <button id="next" aria-label="Mes siguiente">›</button>
    </div>
    <div class="grid">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<div class="dow">${d}</div>`).join('')}${cells}</div>
    <div class="legend"><span><i class="dot t-concurso"></i>Concurso</span><span><i class="dot t-campeonato"></i>Campeonato</span><span><i class="dot t-entrenamiento"></i>Entreno</span></div>
    </section>
    <aside class="cal-side">
    ${f ? `
    ${noTown ? `<div class="card notice"><p class="small">Estas jornadas son anteriores a la localidad obligatoria.${f.venue ? '' : ' Elige un escenario de este grupo para asignarle su localidad de una vez, o edita cada jornada.'}</p>
      ${f.venue ? '<div class="actions"><button class="btn" id="assignTown">Asignar localidad a este escenario</button></div>' : ''}</div>` : ''}
    ${state.selDay && state.selDay.startsWith(monthPrefix) ? `<h2>${esc(listTitle)}</h2>${list.length ? list.map(itemHTML).join('') : '<div class="empty">Nada este día en este lugar.</div>'}` : ''}
    <h2>Jornadas en ${esc(label)} <span class="muted small">· ${matches.length}</span></h2>
    ${matches.slice(0, 100).map(itemHTML).join('')}
    ${matches.length > 100 ? `<p class="hint">Se muestran las 100 más recientes.</p>` : ''}` : `
    <h2>${esc(listTitle)}</h2>
    ${list.length ? list.map(itemHTML).join('') : `<div class="empty">${state.selDay ? 'Nada este día. Pulsa + para añadir.' : 'Sin jornadas este mes.'}</div>`}
    ${upcoming.length ? `<h2>Próximas competiciones</h2>${upcoming.map(itemHTML).join('')}` : ''}`}
    </aside>
   </div>
  `;
  $('#prev').onclick = () => { state.month = new Date(y, mo - 1, 1); state.selDay = null; render(); };
  $('#next').onclick = () => { state.month = new Date(y, mo + 1, 1); state.selDay = null; render(); };
  view.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    const d = b.dataset.day;
    if (!d.startsWith(monthPrefix)) { const [yy, mm] = d.split('-').map(Number); state.month = new Date(yy, mm - 1, 1); }
    state.selDay = state.selDay === d ? null : d;
    render({ keepScroll: true });
  });
  placePicker($('#placePicker'), index, pick => { state.place = pick; state.selDay = null; render({ keepScroll: true }); });
  if ($('#placeClear')) $('#placeClear').onclick = () => { state.place = null; render({ keepScroll: true }); };
  if ($('#assignTown')) $('#assignTown').onclick = () => assignTown(everything, index, f);
  bindItems();
}

// Jornadas antiguas sin localidad: asigna una localidad a todas las de un escenario de una vez.
async function assignTown(everything, index, f) {
  const venue = index.find(t => !t.key)?.venues.find(v => v.key === f.venue);
  if (!venue) return;
  const towns = index.filter(t => t.key);
  const res = await modal({
    title: 'Asignar localidad',
    html: `<p>¿En qué localidad está <b>${esc(venue.name)}</b>? Se asignará a sus ${venue.count} jornadas sin localidad.</p>
      <label for="as-town">Localidad</label><input id="as-town" list="as-towns" maxlength="80" autocomplete="off">
      <datalist id="as-towns">${towns.map(t => `<option value="${esc(t.name)}">`).join('')}</datalist>`,
    actions: [{ label: 'Cancelar' }, { label: 'Asignar', value: true }],
    onAction: (_, root) => {
      const town = root.querySelector('#as-town').value.trim();
      if (!town) throw new Error('Escribe la localidad.');
      return town;
    },
  });
  if (!res) return;
  const targets = everything.filter(s => !norm(s.town) && norm(s.venue) === f.venue);
  for (const s of targets) await db.saveSession({ ...s, town: res });
  state.place = { town: norm(res), venue: f.venue };
  refreshBadge(); toast(`Localidad asignada a ${targets.length} jornadas`); render({ keepScroll: true });
  trySync(true);
}

// ---------- registro ----------
async function list() {
  setTitle('Registro'); setFab(true);
  const all = await db.allSessions();
  const inYear = all.filter(s => +s.date.slice(0, 4) === state.listYear);
  const shown = byMod(inYear, state.listMod).filter(s => state.listType === 'todos' || s.type === state.listType);
  view.innerHTML = `
    ${yearChips(yearsOf(all), state.listYear)}
    ${modChips(inYear, state.listMod)}
    <div class="chips">${[['todos', 'Todos'], ['concurso', 'Concursos'], ['campeonato', 'Campeonatos'], ['entrenamiento', 'Entrenos']]
      .map(([v, l]) => `<button class="chip ${v === state.listType ? 'on' : ''}" data-t="${v}">${l}</button>`).join('')}</div>
    ${shown.length ? `<div class="items">${shown.map(itemHTML).join('')}</div>` : '<div class="empty">No hay jornadas con este filtro.</div>'}
  `;
  view.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { state.listYear = +b.dataset.y; render(); });
  view.querySelectorAll('[data-mod]').forEach(b => b.onclick = () => { state.listMod = b.dataset.mod; render(); });
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { state.listType = b.dataset.t; render(); });
  bindItems();
}

// ---------- ficha ----------
function fieldValue(f, v) {
  if (v == null || v === '') return '';
  if (f.type === 'num') return fmtNum(v) + (f.unit ? ' ' + f.unit : '');
  return v;
}

async function detail({ id, rec: friendRec }) {
  setFab(false);
  const s = friendRec || await db.getSession(id);
  if (!s || s.deleted) { state.stack.pop(); return render(); }
  const t = TYPES[s.type] || TYPES.concurso;
  const mod = modality(modalityOf(s));
  setTitle(t.label);
  const block = (title, rows, cls = '') => {
    const r = rows.filter(([, v]) => v != null && v !== '');
    return r.length ? `<div class="card ${cls}"><p class="section-title">${esc(title)}</p><dl class="kv">${r.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : '';
  };
  const comp = block('Competición', [
    ['Localidad', s.town],
    ['Escenario', s.venue],
    ['Campeonato', s.competition && (s.competition + (s.round ? ' — jornada ' + s.round : ''))],
    ['Sector / puesto', [s.sector && 'Sector ' + s.sector, s.peg && 'Puesto ' + s.peg].filter(Boolean).join(' · ')],
    ['Clasificación', s.overallRank && s.overallRank + 'º general'],
    ['Pieza mayor', s.biggestG != null ? fmtKgShort(s.biggestG) + ' kg' : ''],
    ['Especies', s.species],
  ]);
  const modBlocks = mod.sections.map(sec => block(sec.title, sec.fields.map(f => [f.label, fieldValue(f, s[f.k])]))).join('');
  const wx = block(mod.sea ? 'Tiempo y mar' : 'Tiempo', [
    ['Cielo', s.sky && SKY_LABEL[s.sky]],
    ['Temperatura', s.temp != null ? fmtNum(s.temp) + ' ºC' : ''],
    ['Viento', [s.wind, s.windDir].filter(Boolean).join(' · ')],
    ['Presión', s.pressure != null ? s.pressure + ' hPa' : ''],
    ...(mod.sea ? [['Marea', s.tide]] : []),
    [mod.sea ? 'Estado del mar' : 'Agua', s.water],
  ]);

  view.innerHTML = `
    <button class="back" id="back">‹ Volver</button>
    <div class="detail-head"><span class="tag" style="background:${t.color}">${t.label}</span><span class="tag mod">${esc(mod.label)}</span>
      <span class="muted small">${fmtDate(s.date)}${s.time ? ' · ' + esc(s.time) : ''}</span></div>
    <h2 style="margin-top:6px">${esc(s.title || t.label)}${s.private ? ' <span class="lock" title="Privada">🔒</span>' : ''}</h2>
    ${friendRec ? `<p class="muted small" style="margin-top:-4px">Jornada de ${esc(friendRec._owner || 'tu amigo')}</p>` : ''}
    <div class="kpis">
      <div class="kpi"><b>${fmtKgShort(s.weightG)}</b><span>kg</span></div>
      <div class="kpi"><b>${esc(s.pieces ?? '—')}</b><span>piezas</span></div>
      <div class="kpi"><b>${s.sectorRank ? esc(s.sectorRank) + 'º' : '—'}</b><span>en sector</span></div>
    </div>
    <div class="cols">
    ${comp}${modBlocks}${wx}
    ${s.notes ? `<div class="card wide"><p class="section-title">Descripción</p><div class="prewrap">${esc(s.notes)}</div></div>` : ''}
    </div>
    ${friendRec && friendRec._limited ? '<p class="hint">Tu amigo solo comparte los resultados de sus jornadas.</p>' : ''}
    <div class="detail-actions">
    ${friendRec ? (friendRec._limited ? '' : `
    <div class="actions"><button class="btn ghost" id="dup">Usar su preparación en una jornada mía</button></div>`) : `
    <div class="actions">
      <button class="btn ghost" id="dup">Duplicar</button>
      <button class="btn" id="edit">Editar</button>
    </div>
    <div class="actions"><button class="btn danger" id="del">Borrar jornada</button></div>`}
    </div>
  `;
  $('#back').onclick = pop;
  if ($('#dup')) $('#dup').onclick = () => push({ kind: 'form', id: null, dup: s });
  if (friendRec) return;
  $('#edit').onclick = () => push({ kind: 'form', id });
  $('#del').onclick = async () => {
    if (!await confirmBox('Borrar jornada', 'Se borrará de este dispositivo y del servidor. No se puede deshacer.', 'Borrar', true)) return;
    await db.deleteSession(id);
    state.stack.pop();
    refreshBadge(); render(); toast('Jornada borrada');
    trySync(true);
  };
}

// ---------- formulario ----------
const ALL_PREP_KEYS = [...new Set(MODALITY_IDS.flatMap(prepKeys))];

function fieldHTML(f, s, lists) {
  const v = s[f.k];
  const id = 'f-' + f.k;
  const label = `<label for="${id}">${esc(f.label)}${f.unit ? ` (${esc(f.unit)})` : ''}</label>`;
  let input;
  if (f.type === 'area') input = `<textarea id="${id}" name="${f.k}" maxlength="4000" placeholder="${esc(f.ph || '')}">${esc(v ?? '')}</textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${f.k}"><option value=""></option>${f.options.map(o => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (f.type === 'num') input = `<input id="${id}" name="${f.k}" inputmode="decimal" value="${v == null ? '' : esc(String(v).replace('.', ','))}" placeholder="${esc(f.ph || '')}">`;
  else input = `<input id="${id}" name="${f.k}" maxlength="300" list="dl-${f.k}" value="${esc(v ?? '')}" placeholder="${esc(f.ph || '')}">`;
  if (f.type === 'text') lists.add(f.k);
  return `<div class="${f.wide ? 'wide' : ''}">${label}${input}</div>`;
}

// Lee el formulario a un objeto (también se usa al cambiar de modalidad para no perder lo escrito).
function collect(form, base, type, mod, sky, priv) {
  const f = new FormData(form);
  const g = k => (f.get(k) || '').toString().trim();
  const w = num(g('weightKg')), big = num(g('biggestKg'));
  const comp = type !== 'entrenamiento';
  const rec = { ...base };
  // Los campos de preparación se rehacen con los de la modalidad elegida.
  for (const k of ALL_PREP_KEYS) delete rec[k];
  Object.assign(rec, {
    type, modality: mod, sky, private: priv,
    title: g('title'), date: g('date'), time: g('time'), town: g('town'), venue: g('venue'),
    competition: comp ? g('competition') : '', round: comp ? g('round') : '',
    sector: comp ? g('sector') : '', peg: comp ? g('peg') : '',
    weightG: w == null ? null : Math.round(w * 1000),
    pieces: int(g('pieces')),
    biggestG: big == null ? null : Math.round(big * 1000),
    species: g('species'),
    sectorRank: comp ? int(g('sectorRank')) : null,
    overallRank: comp ? int(g('overallRank')) : null,
    temp: num(g('temp')), wind: g('wind'), windDir: g('windDir'), pressure: int(g('pressure')), water: g('water'),
    tide: modality(mod).sea ? g('tide') : '',
    notes: g('notes'),
  });
  for (const sec of modality(mod).sections) {
    for (const fd of sec.fields) rec[fd.k] = fd.type === 'num' ? num(g(fd.k)) : g(fd.k);
  }
  return rec;
}

async function form(top) {
  setFab(false);
  const id = top.id;
  let s = top.draft;
  if (!s) {
    if (id) s = await db.getSession(id);
    else if (top.dup) {
      // Duplicar: copia la preparación (modalidad, escenario, campos de pesca y cebado), no resultados ni tiempo.
      const d = top.dup, mod = modalityOf(d);
      s = { type: d.type, modality: mod, town: d.town, venue: d.venue, competition: d.competition, date: todayStr() };
      for (const k of prepKeys(mod)) if (d[k] != null) s[k] = d[k];
    } else {
      s = { type: 'concurso', modality: state.user.modalities?.[0] || 'feeder', date: top.date || state.selDay || todayStr() };
    }
  }
  if (!s) { state.stack.pop(); return render(); }
  const mod = modalityOf(s);
  const M = modality(mod);
  setTitle(id ? 'Editar jornada' : 'Nueva jornada');

  const all = await db.allSessions();
  const lists = new Set(['competition']);
  const index = placeIndex(all);
  const v = k => esc(s[k] ?? '');
  const vn = k => s[k] == null ? '' : String(s[k]).replace('.', ',');
  const kg3 = g => g == null ? '' : (g / 1000).toFixed(3).replace('.', ',');
  const mine = (state.user.modalities || []).filter(m => MODALITIES[m]);
  const chipMods = mine.includes(mod) ? mine : [...mine, mod];
  const others = MODALITY_IDS.filter(m => !chipMods.includes(m));
  const sections = M.sections.map(sec => `
      <div class="card">
        <p class="section-title">${esc(sec.title)}</p>
        <div class="fgrid">${sec.fields.map(f => fieldHTML(f, s, lists)).join('')}</div>
      </div>`).join('');

  view.innerHTML = `
    <button class="back" id="back">‹ Cancelar</button>
    <form class="form form-grid" id="f" autocomplete="off" novalidate>
      <div class="card">
        <div class="seg" id="type" role="radiogroup" aria-label="Tipo de jornada">${Object.entries(TYPES).map(([k, t]) => `<button type="button" role="radio" aria-checked="${s.type === k}" data-v="${k}" class="${s.type === k ? 'on' : ''}">${t.label}</button>`).join('')}</div>
        <label>Modalidad</label>
        <div class="chips wrap" id="mods">${chipMods.map(m => `<button type="button" class="chip ${m === mod ? 'on' : ''}" data-m="${m}">${esc(MODALITIES[m].label)}</button>`).join('')}
          ${others.length ? `<select id="otherMod" class="chip-select" aria-label="Otra modalidad"><option value="">Otra…</option>${others.map(m => `<option value="${m}">${esc(MODALITIES[m].label)}</option>`).join('')}</select>` : ''}</div>
        <label for="f-title">Nombre</label><input id="f-title" name="title" maxlength="120" value="${v('title')}" placeholder="p. ej. Open de otoño">
        <div class="row2">
          <div><label for="f-date">Fecha</label><input id="f-date" name="date" type="date" required value="${v('date')}"></div>
          <div><label for="f-time">Hora</label><input id="f-time" name="time" type="time" value="${v('time')}"></div>
        </div>
        <div class="row2 place-fields">
          <div><label for="f-town">Localidad <span class="req" aria-hidden="true">*</span></label>
            <input id="f-town" name="town" maxlength="80" list="dl-town" required aria-required="true" autocomplete="off" value="${v('town')}" placeholder="Caspe, Calanda…">
            <p class="field-err" id="err-town" role="alert"></p></div>
          <div><label for="f-venue">Escenario <span class="req" aria-hidden="true">*</span></label>
            <input id="f-venue" name="venue" maxlength="120" list="dl-venue" required aria-required="true" autocomplete="off" value="${v('venue')}" placeholder="Río, embalse, playa, tramo…">
            <p class="field-err" id="err-venue" role="alert"></p></div>
        </div>
        <datalist id="dl-town">${index.filter(t => t.key).map(t => `<option value="${esc(t.name)}">`).join('')}</datalist>
        <datalist id="dl-venue"></datalist>
        <div id="compFields">
          <div class="row2">
            <div><label for="f-comp">Campeonato / liga</label><input id="f-comp" name="competition" maxlength="120" list="dl-competition" value="${v('competition')}"></div>
            <div><label for="f-round">Jornada</label><input id="f-round" name="round" maxlength="10" inputmode="numeric" value="${v('round')}"></div>
          </div>
          <div class="row2">
            <div><label for="f-sector">Sector</label><input id="f-sector" name="sector" maxlength="10" value="${v('sector')}"></div>
            <div><label for="f-peg">Puesto</label><input id="f-peg" name="peg" maxlength="10" value="${v('peg')}"></div>
          </div>
        </div>
        <label class="check"><input type="checkbox" id="priv" ${s.private ? 'checked' : ''}> <span>Jornada privada <span class="muted small">(no la ven tus amigos)</span></span></label>
      </div>

      <div class="card">
        <p class="section-title">Resultado</p>
        <div class="row2">
          <div><label for="f-w">Peso total (kg)</label><input id="f-w" name="weightKg" inputmode="decimal" value="${kg3(s.weightG)}" placeholder="8,450"></div>
          <div><label for="f-p">Piezas</label><input id="f-p" name="pieces" inputmode="numeric" value="${v('pieces')}"></div>
        </div>
        <div class="row2">
          <div><label for="f-big">Pieza mayor (kg)</label><input id="f-big" name="biggestKg" inputmode="decimal" value="${kg3(s.biggestG)}"></div>
          <div><label for="f-sp">Especies</label><input id="f-sp" name="species" maxlength="200" list="dl-species" value="${v('species')}" placeholder="Carpa, barbo…"></div>
        </div>
        <div class="row2" id="rankFields">
          <div><label for="f-sr">Puesto en sector</label><input id="f-sr" name="sectorRank" inputmode="numeric" value="${v('sectorRank')}"></div>
          <div><label for="f-or">Clasificación general</label><input id="f-or" name="overallRank" inputmode="numeric" value="${v('overallRank')}"></div>
        </div>
      </div>
      ${sections}
      <div class="card">
        <p class="section-title">${M.sea ? 'Tiempo y mar' : 'Tiempo'}</p>
        <div class="sky" id="sky" role="radiogroup" aria-label="Cielo">${SKY.map(([k, e]) => `<button type="button" role="radio" aria-checked="${s.sky === k}" aria-label="${SKY_LABEL[k]}" data-v="${k}" class="${s.sky === k ? 'on' : ''}" title="${SKY_LABEL[k]}">${e}</button>`).join('')}</div>
        <div class="row3">
          <div><label for="f-temp">Temp. (ºC)</label><input id="f-temp" name="temp" inputmode="decimal" value="${vn('temp')}"></div>
          <div><label for="f-wind">Viento</label><select id="f-wind" name="wind"><option value=""></option>${WIND.map(w => `<option ${s.wind === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
          <div><label for="f-wd">Dirección</label><select id="f-wd" name="windDir"><option value=""></option>${WIND_DIR.map(w => `<option ${s.windDir === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
        </div>
        <div class="row2">
          <div><label for="f-pr">Presión (hPa)</label><input id="f-pr" name="pressure" inputmode="numeric" value="${v('pressure')}"></div>
          ${M.sea ? `<div><label for="f-tide">Marea</label><select id="f-tide" name="tide"><option value=""></option>${TIDES.map(t => `<option ${s.tide === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>` : ''}
          <div class="${M.sea ? 'wide2' : ''}"><label for="f-water">${M.sea ? 'Estado del mar' : 'Agua'}</label><input id="f-water" name="water" maxlength="120" value="${v('water')}" placeholder="${M.sea ? 'Calma, marejadilla, mar de fondo…' : 'Nivel, color, corriente'}"></div>
        </div>
      </div>

      <div class="card wide">
        <p class="section-title">Descripción</p>
        <textarea name="notes" maxlength="4000" aria-label="Descripción" placeholder="Qué has hecho, cómo ha ido la jornada, qué cambiarías…">${v('notes')}</textarea>
      </div>

      <div class="actions wide form-save"><button class="btn" type="submit">Guardar</button></div>
    </form>
    ${[...lists, 'species'].map(k => `<datalist id="dl-${k}">${[...new Set(all.map(x => x[k]).filter(x => typeof x === 'string' && x))].sort().slice(0, 50).map(x => `<option value="${esc(x)}">`).join('')}</datalist>`).join('')}
  `;

  let type = s.type, sky = s.sky || null;
  const syncType = () => {
    view.querySelectorAll('#type button').forEach(b => { const on = b.dataset.v === type; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $('#compFields').hidden = type === 'entrenamiento';
    $('#rankFields').hidden = type === 'entrenamiento';
  };
  syncType();
  view.querySelectorAll('#type button').forEach(b => b.onclick = () => { type = b.dataset.v; syncType(); });
  view.querySelectorAll('#sky button').forEach(b => b.onclick = () => {
    sky = sky === b.dataset.v ? null : b.dataset.v;
    view.querySelectorAll('#sky button').forEach(x => { const on = x.dataset.v === sky; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
  });
  const switchMod = m => {
    if (!m || m === mod) return;
    top.draft = collect($('#f'), s, type, m, sky, $('#priv').checked);
    render({ keepScroll: true });
  };
  view.querySelectorAll('#mods [data-m]').forEach(b => b.onclick = () => switchMod(b.dataset.m));
  if ($('#otherMod')) $('#otherMod').onchange = e => switchMod(e.target.value);
  $('#back').onclick = pop;

  // Escenarios sugeridos según la localidad escrita; si se elige un escenario conocido, se rellena su localidad.
  const fillVenues = () => {
    const own = venuesOf(index, $('#f-town').value);
    const list = own.length ? own : index.flatMap(t => t.venues);
    $('#dl-venue').innerHTML = [...new Set(list.map(x => x.name))].map(n => `<option value="${esc(n)}">`).join('');
  };
  fillVenues();
  $('#f-town').addEventListener('input', () => { fillVenues(); $('#err-town').textContent = ''; $('#f-town').removeAttribute('aria-invalid'); });
  $('#f-venue').addEventListener('input', () => {
    $('#err-venue').textContent = ''; $('#f-venue').removeAttribute('aria-invalid');
    if (!$('#f-town').value.trim()) {
      const t = townOfVenue(index, $('#f-venue').value);
      if (t) { $('#f-town').value = t; fillVenues(); }
    }
  });

  $('#f').onsubmit = async e => {
    e.preventDefault();
    const rec = collect(e.target, id ? s : {}, type, mod, sky, $('#priv').checked);
    rec.id = id || db.uuid();
    rec.deleted = false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) return toast('Falta la fecha');
    // Se guarda con la forma ya conocida ("caspe" -> "Caspe") para no crear duplicados.
    const knownTown = index.find(t => t.key && t.key === norm(rec.town));
    if (knownTown) {
      rec.town = knownTown.name;
      const knownVenue = knownTown.venues.find(x => x.key === norm(rec.venue));
      if (knownVenue) rec.venue = knownVenue.name;
    }
    // Localidad y escenario son obligatorios.
    const missing = [['town', 'Indica la localidad'], ['venue', 'Indica el escenario']].filter(([k]) => !rec[k]);
    missing.forEach(([k, msg]) => { $('#err-' + k).textContent = msg; $('#f-' + k).setAttribute('aria-invalid', 'true'); });
    if (missing.length) {
      $('#f-' + missing[0][0]).focus();
      $('#f-' + missing[0][0]).scrollIntoView({ block: 'center' });
      return toast('Faltan la localidad o el escenario');
    }
    await db.saveSession(rec);
    state.stack.pop();
    if (!id) {
      const [yy, mm] = rec.date.split('-').map(Number);
      state.month = new Date(yy, mm - 1, 1);
      state.selDay = rec.date;
      state.stack.push({ kind: 'detail', id: rec.id });
    }
    refreshBadge(); render(); toast('Guardado');
    trySync(true);
  };
}

// ---------- temporada ----------
async function season() {
  setTitle('Temporada'); setFab(false);
  const all = await db.allSessions();
  const Y = state.seasonYear;
  const inYear = all.filter(s => +s.date.slice(0, 4) === Y);
  const yr = byMod(inYear, state.seasonMod);
  const today = todayStr();
  const { comps, fished, trains, totalW, totalP, best, biggest, wins, avgRank, pending } = seasonStats(yr);

  // barras por mes (número de jornadas por tipo)
  const perMonth = Array.from({ length: 12 }, () => ({ concurso: 0, campeonato: 0, entrenamiento: 0 }));
  yr.forEach(s => { perMonth[+s.date.slice(5, 7) - 1][s.type]++; });
  const maxM = Math.max(1, ...perMonth.map(m => m.concurso + m.campeonato + m.entrenamiento));
  const bars = perMonth.map((m, i) => `<div class="col" title="${MONTHS[i]}: ${m.concurso + m.campeonato + m.entrenamiento} jornadas">${['entrenamiento', 'campeonato', 'concurso'].map(k => m[k] ? `<div class="seg-c t-${k}" style="height:${m[k] / maxM * 100}%"></div>` : '').join('')}</div>`).join('');

  const groups = {};
  yr.filter(s => s.competition).forEach(s => (groups[s.competition] ||= []).push(s));
  const champRows = Object.entries(groups).map(([name, list]) => {
    const done = list.filter(s => s.date <= today);
    const pts = sum(done.filter(s => s.sectorRank), 'sectorRank');
    return `<tr><td>${esc(name)}</td><td>${done.length}/${list.length}</td><td>${fmtKgShort(sum(done, 'weightG'))}</td><td>${esc(sum(done, 'pieces'))}</td><td>${esc(pts || '—')}</td></tr>`;
  }).join('');

  const venues = {};
  comps.concat(trains).filter(s => s.venue).forEach(s => {
    const v = (venues[norm(s.venue) + '|' + norm(s.town)] ||= { name: s.venue, town: s.town, n: 0, w: 0, wn: 0 });
    v.n++; if (typeof s.weightG === 'number') { v.w += s.weightG; v.wn++; }
  });
  const venueRows = Object.entries(venues).sort((a, b) => b[1].n - a[1].n).slice(0, 8)
    .map(([, v]) => `<tr><td>${esc(v.name)}${v.town ? `<br><small class="muted">${esc(v.town)}</small>` : ''}</td><td>${v.n}</td><td>${v.wn ? fmtKgShort(v.w / v.wn) : '—'}</td></tr>`).join('');

  const kpi = (val, lbl) => `<div class="kpi"><b>${esc(val)}</b><span>${lbl}</span></div>`;
  view.innerHTML = `
    ${yearChips(yearsOf(all), Y)}
    ${modChips(inYear, state.seasonMod)}
    <div class="stats">
      ${kpi(comps.length, 'competiciones')}
      ${kpi(trains.length, 'entrenamientos')}
      ${kpi(fmtKgShort(totalW), 'kg en competición')}
      ${kpi(totalP, 'piezas en competición')}
      ${kpi(fished.length ? fmtKgShort(totalW / fished.length) : '—', 'kg de media')}
      ${kpi(biggest != null ? fmtKgShort(biggest) : '—', 'kg pieza mayor')}
      ${kpi(fmtRank(avgRank), 'puesto medio en sector')}
      ${kpi(wins, 'victorias de sector')}
    </div>
    ${pending ? `<p class="muted small">${pending} ${pending === 1 ? 'competición pendiente' : 'competiciones pendientes'} este año.</p>` : ''}
    <div class="cols">
    <div>
    <h2>Jornadas por mes</h2>
    <div class="card">
      <div class="months">${bars}</div>
      <div class="mlabels">${MONTHS.map(m => `<span>${m}</span>`).join('')}</div>
    </div>
    </div>
    ${best ? `<div><h2>Mejor jornada</h2>${itemHTML(best)}</div>` : ''}
    ${champRows ? `<div><h2>Campeonatos y ligas</h2><div class="card"><table class="t"><tr><th>Nombre</th><th>Jorn.</th><th>Kg</th><th>Pz</th><th>Puntos</th></tr>${champRows}</table><p class="hint">Puntos = suma de puestos de sector (menos es mejor).</p></div></div>` : ''}
    ${venueRows ? `<div><h2>Escenarios</h2><div class="card"><table class="t"><tr><th>Escenario</th><th>Jornadas</th><th>Kg media</th></tr>${venueRows}</table></div></div>` : ''}
    </div>
  `;
  view.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { state.seasonYear = +b.dataset.y; render(); });
  view.querySelectorAll('[data-mod]').forEach(b => b.onclick = () => { state.seasonMod = b.dataset.mod; render({ keepScroll: true }); });
  bindItems();
}

export const journalScreens = { calendar, list, detail, form, season };
