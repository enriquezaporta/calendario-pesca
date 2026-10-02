// Modalidades de pesca y los campos propios de cada una.
// Los campos comunes (tipo, fecha, escenario, resultado, tiempo, descripción) están en app.js.
// Claves: solo letras y números (el servidor descarta el resto).
//
// Tipos de campo: num (con unidad), text, area (texto largo), select (options).
// "wide": ocupa toda la fila del formulario.

const T = (k, label, ph, extra = {}) => ({ k, label, type: 'text', ph, ...extra });
const N = (k, label, unit, ph, extra = {}) => ({ k, label, type: 'num', unit, ph, ...extra });
const A = (k, label, ph) => ({ k, label, type: 'area', ph, wide: true });
const S = (k, label, options) => ({ k, label, type: 'select', options });
const PLATFORM = S('platform', 'Desde', ['Orilla', 'Embarcación', 'Pato / float tube']);

export const MODALITIES = {
  feeder: {
    label: 'Feeder', icon: '🧺',
    sections: [
      { title: 'Pesca', fields: [
        N('distance', 'Distancia', 'm', '35'),
        T('feeder', 'Cestillo', 'Open 30 g'),
        T('hooklength', 'Bajo y anzuelo', '0,12 · nº 16'),
        T('baits', 'Cebos', 'Asticot, pinkie, gusano…', { wide: true }),
      ] },
      { title: 'Engodo', fields: [
        A('groundbait', 'Mezcla', 'Marcas y proporciones, tierra, humedad…'),
        N('groundbaitKg', 'Cantidad', 'kg'),
        T('additives', 'Aditivos', 'Melaza, aroma…'),
      ] },
    ],
  },
  coup: {
    label: 'Coup (tralla)', icon: '🎣',
    sections: [
      { title: 'Pesca', fields: [
        N('rodLength', 'Longitud de caña', 'm', '13'),
        T('float', 'Flotador', '1 g, cuerpo de gota'),
        T('line', 'Línea y bajo', '0,10 / 0,08'),
        T('hook', 'Anzuelo', 'nº 18'),
        T('baits', 'Cebos', 'Asticot, fouillis, pan…', { wide: true }),
      ] },
      { title: 'Engodo', fields: [
        A('groundbait', 'Mezcla', 'Marcas y proporciones, tierra, humedad…'),
        N('groundbaitKg', 'Cantidad', 'kg'),
        N('balls', 'Bolas iniciales', '', '10'),
        T('additives', 'Tierra y aditivos', 'Tierra de río, aroma…', { wide: true }),
      ] },
    ],
  },
  carpfishing: {
    label: 'Carpfishing', icon: '🐟',
    sections: [
      { title: 'Pesca', fields: [
        N('distance', 'Distancia', 'm', '80'),
        N('hours', 'Duración', 'h', '24'),
        T('rig', 'Montaje', 'Ronnie, chod, hinged…'),
        N('bites', 'Picadas', '', '6'),
        T('baits', 'Cebos', 'Boilies 20 mm, tigernuts…', { wide: true }),
      ] },
      { title: 'Cebado', fields: [
        A('groundbait', 'Cebado', 'Spod, PVA, partículas, boilies…'),
        N('groundbaitKg', 'Cantidad', 'kg'),
        T('additives', 'Atrayentes', 'Liquid, dip…'),
      ] },
    ],
  },
  blackbass: {
    label: 'Black bass', icon: '🎯',
    sections: [
      { title: 'Pesca', fields: [
        PLATFORM,
        N('depth', 'Profundidad', 'm', '3'),
        T('technique', 'Técnicas', 'Texas, drop shot, spinnerbait…', { wide: true }),
        A('lures', 'Señuelos', 'Vinilo 5" craw verde calabaza, crankbait…'),
        N('bites', 'Picadas', '', '12'),
      ] },
    ],
  },
  spinning: {
    label: 'Spinning', icon: '🪝',
    sections: [
      { title: 'Pesca', fields: [
        T('target', 'Especie objetivo', 'Lucio, lucioperca, trucha…'),
        PLATFORM,
        T('technique', 'Técnicas', 'Jerk, lineal, vertical…', { wide: true }),
        A('lures', 'Señuelos', 'Jerkbait 10 cm, cucharilla nº 3…'),
        N('bites', 'Picadas', '', '8'),
      ] },
    ],
  },
  mosca: {
    label: 'Mosca', icon: '🪰',
    sections: [
      { title: 'Pesca', fields: [
        T('target', 'Especie objetivo', 'Trucha común, arcoíris…'),
        S('technique', 'Técnica', ['Seca', 'Ninfa', 'Ninfa al hilo', 'Ahogada', 'Streamer', 'Mixta']),
        A('flies', 'Moscas', 'Ninfa cabeza de oro 16, seca CDC 14…'),
        T('rodLine', 'Caña y línea', '#4 9 pies, WF flotante'),
        S('catchRelease', 'Captura y suelta', ['Sí', 'No', 'Parcial']),
      ] },
    ],
  },
  surfcasting: {
    label: 'Surfcasting', icon: '🌊', sea: true,
    sections: [
      { title: 'Pesca', fields: [
        N('distance', 'Distancia de lance', 'm', '100'),
        N('lead', 'Plomo', 'g', '150'),
        T('rig', 'Montaje', 'Dos anzuelos, bajo de 1 m…', { wide: true }),
        T('baits', 'Cebos', 'Gusana, americano, sardina…', { wide: true }),
      ] },
    ],
  },
  embarcacion: {
    label: 'Embarcación (mar)', icon: '🚤', sea: true,
    sections: [
      { title: 'Pesca', fields: [
        T('technique', 'Técnicas', 'Fondo, jigging, curricán…'),
        N('depth', 'Profundidad', 'm', '25'),
        T('target', 'Especie objetivo', 'Besugo, dentón, calamar…', { wide: true }),
        T('baits', 'Cebos y señuelos', 'Calamar, jig 60 g…', { wide: true }),
      ] },
      { title: 'Engodo', fields: [
        A('groundbait', 'Engodo', 'Sardina triturada, pan…'),
      ] },
    ],
  },
  otra: {
    label: 'Otra', icon: '🎏',
    sections: [
      { title: 'Pesca', fields: [
        T('technique', 'Técnica', ''),
        N('distance', 'Distancia', 'm', ''),
        T('baits', 'Cebos y señuelos', '', { wide: true }),
      ] },
      { title: 'Cebado', fields: [
        A('groundbait', 'Cebado', ''),
      ] },
    ],
  },
};

export const MODALITY_IDS = Object.keys(MODALITIES);
export const TIDES = ['Bajamar', 'Subiendo', 'Pleamar', 'Bajando'];

export const modality = id => MODALITIES[id] || MODALITIES.feeder;
export const modalityOf = s => s.modality && MODALITIES[s.modality] ? s.modality : 'feeder';

// Campos que siempre deben ser números. Todo lo que llega de fuera (servidor, amigos, copias importadas)
// pasa por cleanRecord: un valor que no sea número se descarta, así nunca se pinta texto donde se espera un número.
export const NUMERIC_KEYS = new Set(['weightG', 'pieces', 'biggestG', 'sectorRank', 'overallRank', 'temp', 'pressure',
  ...Object.values(MODALITIES).flatMap(m => m.sections.flatMap(s => s.fields.filter(f => f.type === 'num').map(f => f.k)))]);

export function cleanRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (!/^[A-Za-z_][A-Za-z0-9]{0,31}$/.test(k)) continue;
    if (NUMERIC_KEYS.has(k)) out[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    else if (v === null || ['string', 'boolean', 'number'].includes(typeof v)) out[k] = v;
  }
  return typeof out.id === 'string' && typeof out.date === 'string' ? out : (out.deleted && typeof out.id === 'string' ? out : null);
}

// Todos los campos de preparación de una modalidad (para duplicar jornadas).
export const prepKeys = id => modality(id).sections.flatMap(sec => sec.fields.map(f => f.k));
