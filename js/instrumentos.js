'use strict';
// Instrumentos, afinaciones y posturas de acordes (tablas, buscador y diagramas SVG).
//
// Las cuerdas se escriben de izquierda a derecha tal como se ven en el diagrama (en la guitarra,
// de la 6.ª a la 1.ª). Los órdenes dobles o triples van separados por comas: "Sol3 Sol4, Do4 Do4".
// Orden de las posturas: 1) tradicionales de la guitarra traspuesta, 2) chords-db (guitarra,
// ukelele), 3) ChordPro (charango, mandolina), 4) el generador propio para todo lo demás.

// ============ NOTAS CON OCTAVA ============
const PITCH_RE = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])(#|b|♯|♭)?(-?\d)$/;
const ACC_SEMIS = { '#': 1, '♯': 1, b: -1, '♭': -1 };

function parsePitchToken(tok) {
  const m = String(tok).trim().match(PITCH_RE);
  if (!m) return null;
  return { root: m[1], acc: m[2] || '', midi: NATURAL_INDEX[m[1]] + (ACC_SEMIS[m[2]] || 0) + 12 * (+m[3] + 1) };
}

function parseCourses(str) {
  const groups = String(str || '').includes(',') ? str.split(',') : String(str || '').trim().split(/\s+/);
  const out = [];
  for (const g of groups) {
    const notes = g.trim().split(/[\s+]+/).filter(Boolean).map(parsePitchToken);
    if (!notes.length || notes.some(n => !n)) return null;
    out.push(notes);
  }
  return out.length ? out : null;
}

// ============ INSTRUMENTOS Y AFINACIONES ============
// propias: posturas tradicionales de tónica (I), subdominante (IV) y dominante (V o V7) de las
// afinaciones traspuestas, con el tono propio de la afinación en `tono`. Sin `trastes`, la postura
// la calcula el generador.
const INSTRUMENTS = [
  { id: 'guitarra', nombre: 'Guitarra', trastes: 15, db: 'guitarra', afinaciones: [
    { id: 'estandar', nombre: 'Estándar (por música)', cuerdas: 'Mi2 La2 Re3 Sol3 Si3 Mi4' },
    { id: 're-caido', nombre: 'Re caído', cuerdas: 'Re2 La2 Re3 Sol3 Si3 Mi4' },
    { id: 'medio-tono', nombre: 'Medio tono abajo', cuerdas: 'Mib2 Lab2 Reb3 Solb3 Sib3 Mib4' },
    { id: 'sol-abierta', nombre: 'Sol abierta', cuerdas: 'Re2 Sol2 Re3 Sol3 Si3 Re4' },
    { id: 're-abierta', nombre: 'Re abierta', cuerdas: 'Re2 La2 Re3 Fa#3 La3 Re4' },
    { id: 'dadgad', nombre: 'DADGAD (Re suspendida)', cuerdas: 'Re2 La2 Re3 Sol3 La3 Re4' },
    { id: 'tercera-alta', nombre: 'Traspuesta: tercera alta (en Re)', cuerdas: 'Re2 La2 Re3 Fa#3 La3 Do#4', tono: 2,
      fuente: 'Helga Larravide, folclorista (foro Delcamp)', propias: [
        { grado: 'I', calidad: '', trastes: [0, 0, 0, 0, 0, 1], dedos: [0, 0, 0, 0, 0, 1] },
        { grado: 'IV', calidad: '', trastes: [0, 0, 0, 1, 2, 1], dedos: [0, 0, 0, 1, 3, 2] },
        { grado: 'V7', calidad: '7', trastes: [0, 0, 2, 1, 0, 0], dedos: [0, 0, 2, 1, 0, 0] }] },
    { id: 'transporte', nombre: 'Traspuesta: por transporte o por la orilla (en Do)', cuerdas: 'Do2 Sol2 Do3 Sol3 Do4 Mi4', tono: 0,
      fuente: 'Tesis "Entonada" (U. de Chile) y Helga Larravide', propias: [
        { grado: 'I', calidad: '', trastes: [0, 0, 0, 0, 0, 0] },
        { grado: 'IV', calidad: '', trastes: [5, 5, 5, 5, 5, 5], dedos: [1, 1, 1, 1, 1, 1] },
        { grado: 'V7', calidad: '7' }] },
    { id: 'transporte-comun', nombre: 'Traspuesta: transporte común (6.ª en Mi)', cuerdas: 'Mi2 Sol2 Do3 Sol3 Do4 Mi4', tono: 0,
      fuente: 'Tesis "Entonada" (U. de Chile)', propias: [
        { grado: 'I', calidad: '', trastes: [0, 0, 0, 0, 0, 0] },
        { grado: 'IV', calidad: '', trastes: [-1, 5, 5, 5, 5, 5], dedos: [0, 1, 1, 1, 1, 1] },
        { grado: 'V7', calidad: '7' }] },
    { id: 'traspuesta-sol', nombre: 'Traspuesta en Sol (por Sol-Re)', cuerdas: 'Re2 Sol2 Re3 Sol3 Si3 Re4', tono: 7,
      fuente: 'Afinación campesina tradicional', propias: [
        { grado: 'I', calidad: '', trastes: [0, 0, 0, 0, 0, 0] },
        { grado: 'IV', calidad: '', trastes: [5, 5, 5, 5, 5, 5], dedos: [1, 1, 1, 1, 1, 1] },
        { grado: 'V', calidad: '', trastes: [7, 7, 7, 7, 7, 7], dedos: [1, 1, 1, 1, 1, 1] }] }
  ]},
  { id: 'guitarron', nombre: 'Guitarrón chileno', trastes: 7, afinaciones: [
    { id: 'la', nombre: 'En La', cuerdas: 'Mi3 La3 Re4 Fa#4 Si4', tono: 9, diablitos: 'Do# y La (tónica), Si y Sol# (dominante)',
      fuente: 'Pérez de Arce, "El guitarrón chileno y su armonía tímbrica", Resonancias UC' },
    { id: 'sol', nombre: 'En Sol (un tono abajo, la más usada hoy)', cuerdas: 'Re3 Sol3 Do4 Mi4 La4', tono: 7, diablitos: 'Si y Sol (tónica), La y Fa# (dominante)',
      fuente: 'Pérez de Arce, "El guitarrón chileno y su armonía tímbrica", Resonancias UC' }
  ]},
  { id: 'bajo', nombre: 'Bajo', trastes: 20, mapa: true, afinaciones: [
    { id: '4', nombre: '4 cuerdas', cuerdas: 'Mi1 La1 Re2 Sol2' },
    { id: '5', nombre: '5 cuerdas', cuerdas: 'Si0 Mi1 La1 Re2 Sol2' },
    { id: 're-caido', nombre: 'Re caído', cuerdas: 'Re1 La1 Re2 Sol2' }
  ]},
  { id: 'violin', nombre: 'Violín', trastes: 0, afinaciones: [
    { id: 'quintas', nombre: 'Por quintas', cuerdas: 'Sol3 Re4 La4 Mi5' }
  ]},
  { id: 'mandolina', nombre: 'Mandolina', trastes: 17, db: 'mandolina', afinaciones: [
    { id: 'quintas', nombre: 'Por quintas (órdenes dobles)', cuerdas: 'Sol3 Re4 La4 Mi5' }
  ]},
  { id: 'charango', nombre: 'Charango', trastes: 12, db: 'charango', afinaciones: [
    { id: 'natural', nombre: 'Temple natural', cuerdas: 'Sol4 Do5 Mi4 La4 Mi5' }
  ]},
  { id: 'cuatro-ve', nombre: 'Cuatro venezolano', trastes: 12, afinaciones: [
    { id: 'tradicional', nombre: 'Tradicional', cuerdas: 'La3 Re4 Fa#4 Si3' }
  ]},
  { id: 'cuatro-pr', nombre: 'Cuatro puertorriqueño', trastes: 14, afinaciones: [
    { id: 'tradicional', nombre: 'Tradicional (órdenes dobles)', cuerdas: 'Si2 Mi3 La3 Re4 Sol4' }
  ]},
  { id: 'tiple', nombre: 'Tiple colombiano', trastes: 12, afinaciones: [
    { id: 'tradicional', nombre: 'Tradicional (órdenes triples)', cuerdas: 'Re4 Sol3 Si3 Mi4' }
  ]},
  { id: 'banjo', nombre: 'Banjo de 5 cuerdas', trastes: 17, afinaciones: [
    { id: 'sol', nombre: 'Sol abierta', cuerdas: 'Sol4 Re3 Sol3 Si3 Re4', soloAire: [0] },
    { id: 'doble-do', nombre: 'Doble Do', cuerdas: 'Sol4 Do3 Sol3 Do4 Re4', soloAire: [0] }
  ]},
  { id: 'ukelele', nombre: 'Ukelele', trastes: 12, db: 'ukelele', afinaciones: [
    { id: 'estandar', nombre: 'Estándar', cuerdas: 'Sol4 Do4 Mi4 La4' }
  ]},
  { id: 'rabel', nombre: 'Rabel', trastes: 0, afinaciones: [
    { id: 'comun', nombre: 'Común (edítala según tu zona)', cuerdas: 'Sol3 Re4 La4' }
  ]},
  { id: 'arpa', nombre: 'Arpa diatónica', arpa: true,
    afinaciones: [0, 7, 2, 9, 4, 5, 10, 3, 8].map(k => ({ id: 'en-' + slugify(spell(k, keyPrefersFlats(k, false), true)), tono: k })) }
];

const DEFAULT_INSTRUMENT = { id: 'guitarra', tuning: 'estandar' };
const GRADE_INTERVAL = { I: 0, IV: 5, V: 7, V7: 7 };

// ============ INSTRUMENTOS PROPIOS ============
// Formato en el .md: "Tres cubano = Sol3 Sol4, Do4 Do4, Mi4 Mi4; trastes=17"
const CUSTOM_KEY = 'canciotras.instrumentos';
let customInstruments = [];
try { customInstruments = JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch (_) {}

const customId = nombre => 'propio-' + slugify(nombre);

function customToInstrument(def) {
  return {
    id: customId(def.nombre), nombre: def.nombre, propio: true, def,
    trastes: def.trastes ?? 12,
    afinaciones: [{ id: 'propia', nombre: 'Propia', cuerdas: def.cuerdas }]
  };
}

function parseCustomInstrument(line) {
  const m = String(line).match(/^(.+?)=(.+)$/);
  if (!m) return null;
  const [cuerdas, ...opts] = m[2].split(';');
  const def = { nombre: m[1].trim(), cuerdas: cuerdas.trim(), trastes: 12 };
  for (const o of opts) {
    const t = o.match(/trastes\s*=\s*(\d+)/i);
    if (t) def.trastes = +t[1];
    else if (/sin\s+trastes/i.test(o)) def.trastes = 0;
  }
  return def.nombre && parseCourses(def.cuerdas) ? def : null;
}

const serializeCustomInstrument = def => `${def.nombre} = ${def.cuerdas}; trastes=${def.trastes ?? 12}`;

function registerCustomInstrument(def) {
  if (!def?.nombre || !parseCourses(def.cuerdas)) return null;
  const id = customId(def.nombre);
  customInstruments = customInstruments.filter(c => customId(c.nombre) !== id);
  customInstruments.push({ nombre: def.nombre, cuerdas: def.cuerdas, trastes: def.trastes ?? 12 });
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customInstruments)); } catch (_) {}
  voicingCache.clear();
  return id;
}

const allInstruments = () => [...INSTRUMENTS, ...customInstruments.map(customToInstrument)];
const findInstrument = id => allInstruments().find(i => i.id === id) || INSTRUMENTS[0];
const findTuning = (inst, id) => inst.afinaciones.find(t => t.id === id) || inst.afinaciones[0];
const tuningLabel = t => t.nombre || `En ${keyName(t.tono, false)}`;

function instrumentKind(inst) {
  if (inst.arpa) return 'arpa';
  if (!inst.trastes) return 'sin-trastes';
  return inst.mapa ? 'mapa' : 'trastes';
}

function tuningInfo(inst, t) {
  if (inst.arpa) {
    const pitches = [0, 2, 4, 5, 7, 9, 11, 12].map(i => 60 + t.tono + i);
    return { pitches, names: pitches.map(p => spell(p, keyPrefersFlats(t.tono, false), isLatin())), reentrant: false };
  }
  const courses = parseCourses(t.cuerdas) || [];
  const pitches = courses.map(c => c[0].midi);
  return {
    pitches,
    names: courses.map(c => renderNote(c[0].root, c[0].acc, 0, null, isLatin())),
    reentrant: pitches.some((p, i) => i > 0 && p < pitches[i - 1])
  };
}

// ============ INSTRUMENTOS DE LA CANCIÓN (front matter del .md) ============
// instrumentos: guitarra (tercera-alta), charango      cejilla: guitarra=2
function instrumentsToMeta(list) {
  return list.map(s => {
    const inst = findInstrument(s.id);
    return s.tuning && s.tuning !== inst.afinaciones[0].id ? `${s.id} (${s.tuning})` : s.id;
  }).join(', ');
}

function metaToInstruments(str) {
  const out = [];
  for (const part of String(str || '').split(',')) {
    const m = part.trim().match(/^([^()]+?)\s*(?:\(\s*([^)]+?)\s*\))?$/);
    if (!m) continue;
    const slug = slugify(m[1]);
    const inst = allInstruments().find(i => i.id === slug || slugify(i.nombre) === slug || i.id === 'propio-' + slug);
    if (!inst) continue;
    const t = m[2] ? inst.afinaciones.find(a => a.id === slugify(m[2]) || slugify(tuningLabel(a)) === slugify(m[2])) : null;
    out.push({ id: inst.id, tuning: (t || inst.afinaciones[0]).id });
  }
  return out;
}

const caposToMeta = capos => Object.entries(capos || {}).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(', ');

function metaToCapos(str) {
  const out = {};
  for (const m of String(str || '').matchAll(/([\w-]+)\s*=\s*(\d+)/g)) out[m[1]] = Math.min(12, +m[2]);
  return out;
}

// ============ NOTAS DE CADA ACORDE ============
// Intervalos desde la fundamental por orden de importancia; "?" = nota que se puede omitir
const QUALITY_TONES = {
  '': '0 4 7?', m: '0 3 7?', '5': '0 7',
  '7': '0 4 10 7?', maj7: '0 4 11 7?', m7: '0 3 10 7?', mmaj7: '0 3 11 7?',
  '6': '0 4 9 7?', m6: '0 3 9 7?', '69': '0 4 9 2 7?', m69: '0 3 9 2 7?',
  '9': '0 4 10 2 7?', maj9: '0 4 11 2 7?', m9: '0 3 10 2 7?', add9: '0 4 2 7?', madd9: '0 3 2 7?',
  '11': '0 10 5 7? 2?', m11: '0 3 10 5 7? 2?', '13': '0 4 10 9 7? 2?', m13: '0 3 10 9 7?', maj13: '0 4 11 9 7?',
  sus2: '0 2 7', sus4: '0 5 7', '7sus4': '0 5 10 7?',
  dim: '0 3 6', dim7: '0 3 6 9', m7b5: '0 3 6 10',
  aug: '0 4 8', aug7: '0 4 8 10', '7b5': '0 4 6 10', '7b9': '0 4 10 1 7?', '7#9': '0 4 10 3 7?'
};
const QUALITY_ALIASES = {
  M: '', maj: '', sus: 'sus4', '4': 'sus4', '2': 'add9', add2: 'add9', '+': 'aug', '7#5': 'aug7', '+7': 'aug7',
  '79': '9', m79: 'm9', maj79: 'maj9', M9: 'maj9', '713': '13', '7sus': '7sus4', sus7: '7sus4', '7sus4': '7sus4',
  m7M: 'mmaj7', mM7: 'mmaj7', mmaj7: 'mmaj7', 'mmaj79': 'm9'
};

function canonQuality(q) {
  const s = String(q || '').replace(/[()\s\/,'*]/g, '').replace(/♯/g, '#').replace(/♭/g, 'b');
  if (s in QUALITY_TONES) return s;
  if (s in QUALITY_ALIASES) return QUALITY_ALIASES[s];
  const t = s.replace(/^(min|mi)(?!n)/, 'm').replace(/^-/, 'm')
    .replace(/[º°]/g, 'dim').replace(/ø7?/g, 'm7b5')
    .replace(/7M|M7|Maj7|Δ7?|\^7?|7\+(?!5)/, 'maj7').replace(/-5/, 'b5').replace(/\+5/, '#5');
  if (t in QUALITY_TONES) return t;
  if (t in QUALITY_ALIASES) return QUALITY_ALIASES[t];
  const minor = /^m(?!aj)/.test(t);
  if (/dim/.test(t)) return /7/.test(t) ? 'dim7' : 'dim';
  if (/aug|\+|#5/.test(t)) return /7/.test(t) ? 'aug7' : 'aug';
  if (/sus2/.test(t)) return 'sus2';
  if (/sus/.test(t)) return /7/.test(t) ? '7sus4' : 'sus4';
  if (/maj/.test(t)) return minor ? 'mmaj7' : 'maj7';
  if (/7|9|11|13/.test(t)) return minor ? 'm7' : '7';
  if (/6/.test(t)) return minor ? 'm6' : '6';
  return minor ? 'm' : '';
}

function chordSpec(core) {
  const c = parseChord(core);
  if (!c) return null;
  const root = noteIndex(c.root, c.acc);
  const q = canonQuality(c.mqual);
  const required = [], optional = [];
  for (const p of QUALITY_TONES[q].split(' ')) (p.endsWith('?') ? optional : required).push(mod12(root + parseInt(p, 10)));
  const bass = c.bass ? noteIndex(c.bass, c.bassAcc) : null;
  return { root, q, required, optional, bass, slash: bass != null && bass !== root };
}

// Clave independiente de la notación: "Sol7" y "G7" son el mismo acorde
function chordKey(core) {
  const s = chordSpec(core);
  return s ? `${s.root}${s.q}${s.slash ? '/' + s.bass : ''}` : core;
}

const shiftSpec = (s, semis) => ({
  ...s, root: mod12(s.root + semis), bass: s.bass == null ? null : mod12(s.bass + semis),
  required: s.required.map(p => mod12(p + semis)), optional: s.optional.map(p => mod12(p + semis))
});

const specPcs = s => new Set([...s.required, ...s.optional, ...(s.bass != null ? [s.bass] : [])]);

// ============ BASES DE POSTURAS (vendor/acordes, carga diferida) ============
const dbIndexes = {};

function chordDb(id) {
  const db = window.CANCIOTRAS_ACORDES?.[id];
  if (!db) {
    loadScript(`vendor/acordes/${id}.js`).then(() => {
      voicingCache.clear();
      if (typeof renderPanel === 'function') renderPanel();
    }).catch(() => {});
    return null;
  }
  if (!dbIndexes[id]) {
    const idx = new Map();
    for (const [root, qual, frets, fingers] of db.acordes) {
      const [q, bass] = qual.split('/');
      const key = `${noteIndex(root[0], root.slice(1))}|${canonQuality(q)}|${bass ? noteIndex(bass[0], bass.slice(1)) : ''}`;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push({ frets, fingers });
    }
    dbIndexes[id] = { idx, fuente: db.fuente, pitches: db.afinacion.map(n => parsePitchToken(n).midi) };
  }
  return dbIndexes[id];
}

// Una afinación entera subida o bajada (p. ej. medio tono abajo) usa la misma base, desplazada
function dbShift(pitches, db) {
  if (pitches.length !== db.pitches.length) return null;
  const k = pitches[0] - db.pitches[0];
  return pitches.every((p, i) => p - db.pitches[i] === k) ? k : null;
}

// Comprueba que una postura de la base suene de verdad como el acorde pedido
function voicingFits(frets, pitches, spec, reentrant) {
  const allowed = specPcs(spec), pcs = new Set();
  let low = null;
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] < 0) continue;
    const p = pitches[i] + frets[i];
    if (!allowed.has(mod12(p))) return false;
    pcs.add(mod12(p));
    if (low == null || p < low) low = p;
  }
  if (!spec.required.slice(0, frets.length).every(r => pcs.has(r))) return false;
  return !spec.slash || reentrant || mod12(low) === spec.bass;
}

// ============ GENERADOR DE POSTURAS ============
// Busca en ventanas de 4 trastes. Exige fundamental, 3.ª y 7.ª (la 5.ª es opcional) y el bajo
// correcto; puntúa cuerdas al aire, posición baja, pocos dedos y cejilla.
function generateVoicings(pitches, maxFret, spec, { reentrant = false, openOnly = [], limit = 4 } = {}) {
  const n = pitches.length;
  if (!n) return [];
  const allowed = specPcs(spec);
  const required = spec.required.slice(0, n);
  const minSounding = n <= 4 ? n : n === 5 ? 4 : n - 2;
  const bassPc = spec.bass ?? spec.root;
  const found = new Map();
  const frets = new Array(n);

  function evaluate() {
    let sounding = 0, opens = 0, low = null, first = -1, last = -1;
    const pcs = new Set(), fretted = [];
    for (let i = 0; i < n; i++) {
      const f = frets[i];
      if (f < 0) continue;
      sounding++;
      if (first < 0) first = i;
      last = i;
      const p = pitches[i] + f;
      pcs.add(mod12(p));
      if (low == null || p < low) low = p;
      if (f === 0) opens++; else fretted.push([i, f]);
    }
    if (sounding < minSounding || !required.every(r => pcs.has(r))) return null;
    if (!reentrant && mod12(low) !== bassPc) return null;
    let edgeMuted = 0, innerMuted = 0;
    for (let i = 0; i < n; i++) if (frets[i] < 0) (i > first && i < last ? innerMuted++ : edgeMuted++);
    let minF = Infinity, maxF = 0;
    for (const [, f] of fretted) { minF = Math.min(minF, f); maxF = Math.max(maxF, f); }
    let fingers = fretted.length, barre = false;
    if (fretted.length > 4) {
      const atMin = fretted.filter(([, f]) => f === minF).map(([i]) => i);
      if (atMin.length >= 2) {
        let ok = true;
        for (let i = atMin[0]; i <= atMin.at(-1); i++) if (frets[i] < minF) ok = false;
        if (ok) { barre = true; fingers = 1 + fretted.filter(([, f]) => f !== minF).length; }
      }
    }
    if (fingers > 4) return null;
    const pos = fretted.length ? minF : 0;
    const span = fretted.length ? maxF - minF : 0;
    const optMissing = spec.optional.filter(o => !pcs.has(o)).length;
    let score = pos * 1.1 + span * 0.5 + fingers * 0.5 + (barre ? 1.5 : 0) + innerMuted * 4
      + edgeMuted * (reentrant ? 4 : 1.2) - sounding * 0.8 - opens * 0.25 + optMissing * 0.8;
    if (opens && pos > 4) score += 1.5;
    return { frets: [...frets], score, barre, minF };
  }

  for (let lo = 1; lo <= Math.max(1, maxFret - 3); lo++) {
    const cands = pitches.map((p, i) => {
      const c = [-1];
      if (allowed.has(mod12(p))) c.push(0);
      if (!openOnly.includes(i)) {
        for (let f = lo; f <= Math.min(lo + 3, maxFret); f++) if (allowed.has(mod12(p + f))) c.push(f);
      }
      return c;
    });
    (function walk(i) {
      if (i === n) {
        const v = evaluate();
        if (v) {
          const k = v.frets.join(',');
          if (!found.has(k) || found.get(k).score > v.score) found.set(k, v);
        }
        return;
      }
      for (const f of cands[i]) { frets[i] = f; walk(i + 1); }
    })(0);
  }
  return [...found.values()].sort((a, b) => a.score - b.score).slice(0, limit);
}

function assignFingers(frets, barre = false, minF = 0) {
  const out = frets.map(() => 0);
  const fretted = frets.map((f, i) => [i, f]).filter(([, f]) => f > 0);
  let next = 1;
  if (barre) {
    fretted.filter(([, f]) => f === minF).forEach(([i]) => { out[i] = 1; });
    next = 2;
  }
  fretted.filter(([, f]) => !barre || f !== minF)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .forEach(([i]) => { out[i] = Math.min(4, next++); });
  return out;
}

// ============ POSTURAS DE UN ACORDE ============
const voicingCache = new Map();

// sel = { id, tuning }. Trastes relativos a la cejilla. [{ frets, fingers, origen, fuente }]
function findVoicings(sel, core, capo = 0) {
  const inst = findInstrument(sel.id), t = findTuning(inst, sel.tuning);
  if (instrumentKind(inst) !== 'trastes') return [];
  const info = tuningInfo(inst, t);
  const cacheKey = [inst.id, t.id, info.pitches.join(','), inst.trastes, core, capo].join('|');
  if (voicingCache.has(cacheKey)) return voicingCache.get(cacheKey);
  const spec0 = chordSpec(core);
  if (!spec0) return [];
  const spec = shiftSpec(spec0, -capo);
  const maxFret = Math.max(4, inst.trastes - capo);
  const out = [], seen = new Set();
  const add = v => {
    const k = v.frets.join(',');
    if (v.frets.length === info.pitches.length && !seen.has(k)) { seen.add(k); out.push(v); }
  };

  if (t.propias && !spec.slash) {
    for (const p of t.propias) {
      if (p.trastes && mod12(spec.root - t.tono) === GRADE_INTERVAL[p.grado] && spec.q === p.calidad) {
        add({ frets: p.trastes, fingers: p.dedos || assignFingers(p.trastes), origen: 'tradicional', fuente: t.fuente });
      }
    }
  }
  const db = inst.db && chordDb(inst.db);
  const k = db ? dbShift(info.pitches, db) : null;
  if (k != null) {
    const key = `${mod12(spec.root - k)}|${spec.q}|${spec.slash ? mod12(spec.bass - k) : ''}`;
    for (const v of db.idx.get(key) || []) {
      if (Math.max(...v.frets) <= maxFret && voicingFits(v.frets, info.pitches, spec, info.reentrant)) {
        add({ frets: v.frets, fingers: v.fingers, origen: 'base', fuente: db.fuente });
      }
    }
  }
  for (const v of generateVoicings(info.pitches, maxFret, spec, { reentrant: info.reentrant, openOnly: t.soloAire || [] })) {
    add({ frets: v.frets, fingers: assignFingers(v.frets, v.barre, v.minF), origen: 'calculada' });
  }
  const res = out.slice(0, 8);
  voicingCache.set(cacheKey, res);
  return res;
}

// Cejilla de la afinación traspuesta para tocar en el tono de la canción
function suggestedCapo(t, key) {
  return t.propias && key ? mod12(key.idx - t.tono) : null;
}

function capoFor(d, sel, key) {
  const inst = findInstrument(sel.id);
  if (instrumentKind(inst) !== 'trastes') return 0;
  const explicit = d.capos?.[sel.id];
  if (explicit != null) return explicit;
  const s = suggestedCapo(findTuning(inst, sel.tuning), key);
  return s != null && s <= 7 ? s : 0;
}

// ============ DIAGRAMAS SVG ============
const svgText = (x, y, txt, attrs = '') =>
  `<text x="${x}" y="${y}" text-anchor="middle" ${attrs}>${escapeHtml(txt)}</text>`;

function chordDiagramSvg(v, info) {
  const n = v.frets.length;
  const sx = 17, fy = 18, padL = 20, padT = 22;
  const fretted = v.frets.filter(f => f > 0);
  const maxF = fretted.length ? Math.max(...fretted) : 0;
  const minF = fretted.length ? Math.min(...fretted) : 0;
  const start = maxF <= 5 ? 1 : minF;
  const rows = Math.max(4, maxF - start + 1);
  const w = padL + (n - 1) * sx + 14, h = padT + rows * fy + 16;
  const x = i => padL + i * sx, y = r => padT + r * fy;
  let s = `<svg class="chord-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial, sans-serif">`;
  for (let r = 0; r <= rows; r++) {
    s += `<line x1="${x(0)}" y1="${y(r)}" x2="${x(n - 1)}" y2="${y(r)}" stroke="#5f6368" stroke-width="${r === 0 && start === 1 ? 4 : 1}"/>`;
  }
  for (let i = 0; i < n; i++) s += `<line x1="${x(i)}" y1="${y(0)}" x2="${x(i)}" y2="${y(rows)}" stroke="#5f6368"/>`;
  if (start > 1) s += svgText(padL - 9, y(0) + fy * 0.68, start, 'font-size="11" fill="#202124"');
  const barres = {};
  v.frets.forEach((f, i) => { const d = v.fingers?.[i]; if (f > 0 && d) (barres[d + '@' + f] ||= []).push(i); });
  for (const [k, strs] of Object.entries(barres)) {
    if (strs.length < 2) continue;
    const cy = y(+k.split('@')[1] - start) + fy / 2;
    s += `<rect x="${x(strs[0]) - 7}" y="${cy - 7}" width="${x(strs.at(-1)) - x(strs[0]) + 14}" height="14" rx="7" fill="#202124"/>`;
  }
  v.frets.forEach((f, i) => {
    if (f < 0) s += svgText(x(i), padT - 7, '×', 'font-size="13" fill="#d93025"');
    else if (f === 0) s += `<circle cx="${x(i)}" cy="${padT - 10}" r="4.5" fill="none" stroke="#202124" stroke-width="1.4"/>`;
    else {
      const cy = y(f - start) + fy / 2;
      s += `<circle cx="${x(i)}" cy="${cy}" r="7" fill="#202124"/>`;
      if (v.fingers?.[i]) s += svgText(x(i), cy + 3.5, v.fingers[i], 'font-size="10" font-weight="bold" fill="#fff"');
    }
  });
  info.names.forEach((nm, i) => { s += svgText(x(i), h - 3, nm, 'font-size="8" fill="#80868b"'); });
  return s + '</svg>';
}

// Violín, rabel (sin trastes, primera posición) y bajo: las notas del acorde sobre el diapasón
function fretboardMapSvg(info, spec, { rows = 7, frets = false } = {}) {
  const n = info.pitches.length;
  const sx = 24, fy = 20, padL = 22, padT = 24;
  const w = padL + (n - 1) * sx + 16, h = padT + rows * fy + 16;
  const x = i => padL + i * sx, y = r => padT + r * fy;
  const pcs = specPcs(spec);
  const flats = keyPrefersFlats(spec.root, false);
  let s = `<svg class="chord-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial, sans-serif">`;
  s += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(n - 1)}" y2="${y(0)}" stroke="#5f6368" stroke-width="4"/>`;
  for (let r = 1; r <= rows; r++) {
    s += `<line x1="${x(0)}" y1="${y(r)}" x2="${x(n - 1)}" y2="${y(r)}" stroke="#bdc1c6" ${frets ? '' : 'stroke-dasharray="2 3"'}/>`;
  }
  for (let i = 0; i < n; i++) s += `<line x1="${x(i)}" y1="${y(0)}" x2="${x(i)}" y2="${y(rows)}" stroke="#5f6368"/>`;
  info.pitches.forEach((p, i) => {
    for (let r = 0; r <= rows; r++) {
      const pc = mod12(p + r);
      if (!pcs.has(pc)) continue;
      const cy = r === 0 ? padT - 11 : y(r) - fy / 2;
      const root = pc === spec.root;
      s += `<circle cx="${x(i)}" cy="${cy}" r="8" fill="${root ? '#d93025' : '#1a73e8'}" opacity="${r === 0 ? 0.75 : 1}"/>`;
      s += svgText(x(i), cy + 3, spell(pc, flats, isLatin()), 'font-size="7" font-weight="bold" fill="#fff"');
    }
  });
  info.names.forEach((nm, i) => { s += svgText(x(i), h - 3, nm, 'font-size="8" fill="#80868b"'); });
  return s + '</svg>';
}

// Arpa diatónica: cuerdas que se pulsan
function harpSvg(t, spec) {
  const scale = [0, 2, 4, 5, 7, 9, 11, 12].map(i => mod12(t.tono + i));
  const pcs = specPcs(spec);
  const flats = keyPrefersFlats(t.tono, false);
  const sx = 16, w = 20 + (scale.length - 1) * sx + 20, h = 110;
  let s = `<svg class="chord-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial, sans-serif">`;
  scale.forEach((pc, i) => {
    const x = 20 + i * sx, top = 10 + i * 5, on = pcs.has(pc);
    s += `<line x1="${x}" y1="${top}" x2="${x}" y2="88" stroke="${on ? (pc === spec.root ? '#d93025' : '#1a73e8') : '#bdc1c6'}" stroke-width="${on ? 3 : 1.2}"/>`;
    s += svgText(x, 102, spell(pc, flats, isLatin()), `font-size="8" ${on ? 'font-weight="bold" fill="#202124"' : 'fill="#9aa0a6"'}`);
  });
  return s + '</svg>';
}

// Notas del acorde que el arpa afinada en `t` no tiene
function harpMissing(t, spec) {
  const scale = new Set([0, 2, 4, 5, 7, 9, 11].map(i => mod12(t.tono + i)));
  return [...specPcs(spec)].filter(pc => !scale.has(pc));
}
