// Localidades y escenarios: índice de dos niveles (localidad › escenario) y buscador con desplegable.
// Se comparan sin tildes ni mayúsculas, así "Caspe" y "caspe" son la misma localidad.
import { esc } from './core.js';

export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Nombre que se muestra: el más usado; si empatan, el que empieza en mayúscula y lleva tildes ("Alcañiz" mejor que "alcaniz").
const looks = n => (/^\p{Lu}/u.test(n) ? 2 : 0) + (/[^\x00-\x7f]/.test(n) ? 1 : 0);
const mostUsed = votes => Object.entries(votes).sort((a, b) => b[1] - a[1] || looks(b[0]) - looks(a[0]) || a[0].localeCompare(b[0]))[0]?.[0] || '';
const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

// Devuelve [{key, name, count, venues: [{key, name, count}]}], ordenado por nombre.
// Las jornadas antiguas sin localidad van al final, en un grupo con key ''.
export function placeIndex(list) {
  const towns = new Map();
  for (const s of list) {
    if (!s.venue && !s.town) continue;
    const tk = norm(s.town);
    const t = towns.get(tk) || { key: tk, votes: {}, count: 0, venues: new Map() };
    t.votes[(s.town || '').trim()] = (t.votes[(s.town || '').trim()] || 0) + 1;
    t.count++;
    const vk = norm(s.venue);
    if (vk) {
      const v = t.venues.get(vk) || { key: vk, votes: {}, count: 0 };
      v.votes[s.venue.trim()] = (v.votes[s.venue.trim()] || 0) + 1;
      v.count++;
      t.venues.set(vk, v);
    }
    towns.set(tk, t);
  }
  const out = [...towns.values()].map(t => ({
    key: t.key,
    name: t.key ? mostUsed(t.votes) : 'Sin localidad',
    count: t.count,
    venues: [...t.venues.values()].map(v => ({ key: v.key, name: mostUsed(v.votes), count: v.count })).sort(byName),
  }));
  return out.filter(t => t.key).sort(byName).concat(out.filter(t => !t.key));
}

// filter: {town: key, venue: key|null}
export const matchPlace = (s, f) => !f || (norm(s.town) === f.town && (!f.venue || norm(s.venue) === f.venue));

export function filterLabel(index, f) {
  const t = index.find(x => x.key === f.town);
  if (!t) return '';
  const v = f.venue && t.venues.find(x => x.key === f.venue);
  return v ? `${t.name} › ${v.name}` : t.name;
}

// Escenarios conocidos de una localidad (para las sugerencias del formulario).
export function venuesOf(index, townName) {
  const t = index.find(x => x.key && x.key === norm(townName));
  return t ? t.venues : [];
}

// Localidad conocida de un escenario, si solo aparece en una.
export function townOfVenue(index, venueName) {
  const vk = norm(venueName);
  const hits = index.filter(t => t.key && t.venues.some(v => v.key === vk));
  return hits.length === 1 ? hits[0].name : '';
}

/**
 * Buscador de lugar: un campo de texto con desplegable de dos niveles.
 * - Sin escribir nada, lista todas las localidades con sus escenarios debajo.
 * - Al escribir, muestra las localidades que coinciden (con todos sus escenarios) y los escenarios
 *   que coinciden (con su localidad encima).
 * - Teclado: flechas, Intro y Escape. Al elegir llama a onPick({town, venue}).
 */
export function placePicker(root, index, onPick) {
  root.innerHTML = `
    <div class="pp" role="search">
      <div class="pp-box">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="pp-input" type="text" role="combobox" aria-expanded="false" aria-controls="pp-list" aria-autocomplete="list"
          autocomplete="off" spellcheck="false" placeholder="Buscar localidad o escenario" aria-label="Buscar por localidad o escenario">
        <button type="button" class="pp-toggle" id="pp-toggle" aria-label="Ver todas las localidades" tabindex="-1">▾</button>
      </div>
      <ul class="pp-list" id="pp-list" role="listbox" hidden></ul>
    </div>`;
  const input = root.querySelector('#pp-input');
  const listEl = root.querySelector('#pp-list');
  let options = [], active = -1;

  const optionHTML = (o, i) => o.venue
    ? `<li id="pp-o${i}" role="option" class="pp-venue" data-i="${i}"><span>${esc(o.label)}</span><small>${o.count}</small></li>`
    : `<li id="pp-o${i}" role="option" class="pp-town ${o.town ? '' : 'none'}" data-i="${i}"><span>${o.town ? '📍 ' : ''}${esc(o.label)}</span><small>${o.count}</small></li>`;

  const build = () => {
    const q = norm(input.value);
    options = [];
    for (const t of index) {
      const townHit = !q || norm(t.name).includes(q);
      const venues = townHit ? t.venues : t.venues.filter(v => norm(v.name).includes(q));
      if (!townHit && !venues.length) continue;
      options.push({ town: t.key, venue: null, label: t.name, count: t.count });
      for (const v of venues) options.push({ town: t.key, venue: v.key, label: v.name, count: v.count });
    }
    listEl.innerHTML = options.length ? options.map(optionHTML).join('')
      : `<li class="pp-empty">${index.length ? 'Ninguna localidad ni escenario coincide' : 'Aún no hay jornadas con localidad'}</li>`;
    active = -1;
    listEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
  };
  const close = () => { listEl.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const move = d => {
    if (listEl.hidden) build();
    if (!options.length) return;
    active = (active + d + options.length) % options.length;
    listEl.querySelectorAll('[role=option]').forEach((el, i) => el.classList.toggle('active', i === active));
    const el = listEl.querySelector(`#pp-o${active}`);
    input.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  };
  const pick = i => { const o = options[i]; if (!o) return; close(); onPick({ town: o.town, venue: o.venue }); };

  input.addEventListener('focus', build);
  input.addEventListener('input', build);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(active >= 0 ? active : (options.length ? 0 : -1)); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); input.blur(); }
  });
  root.querySelector('#pp-toggle').addEventListener('click', () => { if (listEl.hidden) { input.focus(); build(); } else close(); });
  listEl.addEventListener('mousedown', e => e.preventDefault());  // no quitar el foco al campo en el ordenador
  listEl.addEventListener('click', e => {
    const li = e.target.closest('[data-i]');
    if (li) pick(+li.dataset.i);
  });
  root.addEventListener('focusout', e => { if (e.relatedTarget && !root.contains(e.relatedTarget)) close(); });
  // Se cierra al tocar fuera (no al perder el foco: en el móvil, desplazar la lista lo quita).
  const outside = e => { if (!root.isConnected) return document.removeEventListener('pointerdown', outside, true); if (!root.contains(e.target)) close(); };
  document.addEventListener('pointerdown', outside, true);
}
