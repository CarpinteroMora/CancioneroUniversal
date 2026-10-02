'use strict';
// Notación, detección de acordes, voces y transposición (sin acceso al DOM).

// ============ NOTACIÓN ============
// Índice 0 = Do/C, 1 = Do#/Reb, ... 11 = Si/B
const LATIN_SHARP = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const LATIN_FLAT  = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
const ENG_SHARP   = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ENG_FLAT    = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURAL_INDEX = { Do: 0, Re: 2, Mi: 4, Fa: 5, Sol: 7, La: 9, Si: 11, C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTAL_KEYS = new Set([1, 3, 6, 8, 10]);

// Armaduras: tonalidades que se escriben con bemoles
const MAJOR_FLAT_KEYS = new Set([1, 3, 5, 8, 10]);   // Reb Mib Fa Lab Sib
const MINOR_FLAT_KEYS = new Set([0, 2, 3, 5, 7, 10]); // Dom Rem Mibm Fam Solm Sibm
const keyPrefersFlats = (idx, minor) => (minor ? MINOR_FLAT_KEYS : MAJOR_FLAT_KEYS).has(idx);

const mod12 = n => ((n % 12) + 12) % 12;

function spell(idx, flats, latin) {
  const table = latin ? (flats ? LATIN_FLAT : LATIN_SHARP) : (flats ? ENG_FLAT : ENG_SHARP);
  return table[mod12(idx)];
}

// ============ DETECCIÓN DE ACORDES ============
// La nota en minúscula indica acorde menor: «la» = Lam, «e7» = Em7
const ROOT_SRC = '(Do|Re|Mi|Fa|Sol|La|Si|DO|RE|MI|FA|SOL|LA|SI|do|re|mi|fa|sol|la|si|[A-G]|[a-g])';
const ACC_SRC = '(#|b|♯|♭)?';
const QUAL_SRC = "((?:maj|min|dim|aug|sus|add|alt|omit|m|M|º|°|ø|Δ|\\^|\\+|-|'|\\*|[0-9]|#|b|♯|♭|\\(|\\)|,|\\/(?=[0-9#b♯♭]))*)";
const CHORD_RE = new RegExp(`^${ROOT_SRC}${ACC_SRC}${QUAL_SRC}(?:\\/${ROOT_SRC}${ACC_SRC})?$`);
const NEUTRAL_TOKEN = /^(\|+:?|:?\|+|-+|\/+|\.{2,}|%|x\d+|\(x?\d+x?\)|\(?bis\)?|.+:)$/i;

const isLowerRoot = root => root === root.toLowerCase();
const isMinorQuality = q => /^(m(?!aj)|min|-)/.test(q);

// qual: tal como está escrito; mqual: con la «m» que implica la minúscula (para tono y diagramas)
function parseChord(core) {
  const m = core.match(CHORD_RE);
  if (!m) return null;
  const qual = m[3] || '';
  const minor = isLowerRoot(m[1]) && !isMinorQuality(qual);
  return { root: m[1], acc: m[2] || '', qual, mqual: minor ? 'm' + qual : qual, bass: m[4] || '', bassAcc: m[5] || '' };
}

function splitPunct(tok) {
  const m = tok.match(/^([(\[|]*)(.*?)([)\]|,.;!?]*)$/);
  return m ? [m[1], m[2], m[3]] : ['', tok, ''];
}

function isChordToken(tok) {
  const core = splitPunct(tok)[1];
  return !!core && CHORD_RE.test(core);
}

function noteIndex(root, acc) {
  const r = root[0].toUpperCase() + root.slice(1).toLowerCase();
  let i = NATURAL_INDEX[r];
  if (acc === '#' || acc === '♯') i++;
  else if (acc === 'b' || acc === '♭') i--;
  return mod12(i);
}

// Reescribe una nota: transpuesta `semis` y/o en otra notación, conservando mayúsculas (DO, SOL…)
// y minúsculas (la, e: acordes menores)
function renderNote(root, acc, semis, flats, targetLatin) {
  const srcLatin = root.length > 1;
  const latin = targetLatin ?? srcLatin;
  if (semis === 0 && latin === srcLatin) return root + acc;
  const useFlats = flats ?? /b|♭/.test(acc);
  let name = spell(noteIndex(root, acc) + semis, useFlats, latin);
  if (isLowerRoot(root)) {
    name = name.toLowerCase();
  } else if (srcLatin && latin && root === root.toUpperCase()) {
    name = name.replace(/^(Do|Re|Mi|Fa|Sol|La|Si)/, s => s.toUpperCase());
  }
  return name;
}

function mapChordToken(tok, fn) {
  const [pre, core, post] = splitPunct(tok);
  const c = core && parseChord(core);
  return c ? pre + fn(c) + post : tok;
}

function transposeToken(tok, semis, flats) {
  return mapChordToken(tok, c =>
    renderNote(c.root, c.acc, semis, flats) + c.qual +
    (c.bass ? '/' + renderNote(c.bass, c.bassAcc, semis, flats) : ''));
}

function convertTokenNotation(tok, targetLatin) {
  return mapChordToken(tok, c =>
    renderNote(c.root, c.acc, 0, null, targetLatin) + c.qual +
    (c.bass ? '/' + renderNote(c.bass, c.bassAcc, 0, null, targetLatin) : ''));
}

// ============ VOCES ============
const VOICES = {
  unica:        { label: 'Única',        color: '#5f6368' },
  tenor:        { label: 'Tenor',        color: '#1e88e5' },
  soprano:      { label: 'Soprano',      color: '#d81b60' },
  bajo:         { label: 'Bajo',         color: '#2e7d32' },
  mezzosoprano: { label: 'Mezzosoprano', color: '#8e24aa' },
  castrati:     { label: 'Castrati',     color: '#ef6c00' }
};
const VOICE_ORDER = ['unica', 'tenor', 'soprano', 'bajo', 'mezzosoprano', 'castrati'];

function parseVoiceMarker(line) {
  const m = line.match(/^\s*\[\s*(?:voz|voces|voice)\s*:\s*([^\]]+?)\s*\]\s*$/i);
  if (!m) return null;
  const norm = m[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const alias = {
    unica: 'unica', todos: 'unica', todas: 'unica', tutti: 'unica',
    soprano: 'soprano', mezzosoprano: 'mezzosoprano', mezzo: 'mezzosoprano', metsosoprano: 'mezzosoprano',
    tenor: 'tenor', bajo: 'bajo', bass: 'bajo', castrati: 'castrati', castrato: 'castrati'
  };
  const key = alias[norm] || norm;
  return { key, label: VOICES[key]?.label || m[1] };
}

const voiceMarker = key => `[Voz: ${VOICES[key]?.label || key}]`;

function activeVoiceAt(text) {
  let key = 'unica';
  for (const l of text.split('\n')) {
    const vm = parseVoiceMarker(l);
    if (vm) key = vm.key;
  }
  return key;
}

// Quita marcadores redundantes: seguidos, iguales a la voz activa o al final del texto.
// Devuelve las líneas resultantes y, para cada línea original, su nuevo índice (-1 si se quitó).
function normalizeVoiceMarkers(lines) {
  const out = [], map = [];
  let active = 'unica', pending = null;
  lines.forEach((l, i) => {
    const vm = parseVoiceMarker(l);
    if (vm) { pending = { l, key: vm.key }; map[i] = -1; return; }
    if (pending) {
      if (pending.key !== active) { out.push(pending.l); active = pending.key; }
      pending = null;
    }
    map[i] = out.length;
    out.push(l);
  });
  return { out, map };
}

// ============ TIPOS DE LÍNEA ============
const COMMENT_RE = /^\s*>\s?(.*)$/;
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;

const STRUM_MARKER_RE = /^\s*\[\s*(?:rasgueo|ritmo|strum)\s*:\s*([^\]]*?)\s*\]\s*$/i;

const isSpecialLine = line => COMMENT_RE.test(line) || HEADING_RE.test(line) || !!parseVoiceMarker(line) || STRUM_MARKER_RE.test(line);

function isChordLine(line) {
  if (!line.trim() || isSpecialLine(line)) return false;
  let chords = 0, others = 0;
  for (const tok of line.trim().split(/\s+/)) {
    if (isChordToken(tok)) chords++;
    else if (!NEUTRAL_TOKEN.test(tok)) others++;
  }
  return chords > 0 && chords / (chords + others) >= 0.7 && !SUNG_SYLLABLES_RE.test(line);
}

// «la la la», «mi, mi»: sílabas cantadas (la misma nota en minúscula repetida con un solo espacio)
const SUNG_SYLLABLES_RE = /(?:^|\s)(do|re|mi|fa|sol|la|si|[a-g])[,.;!?]* \1(?=[\s,.;!?]|$)/;

// ============ TRANSPOSICIÓN ============
// Recoloca los tokens de una línea de acordes en sus columnas originales,
// para que sigan alineados con la letra aunque cambie su longitud.
function layoutChordLine(line, mapTok) {
  const parts = [];
  const re = /\S+/g;
  let m, len = 0;
  while ((m = re.exec(line))) {
    const isChord = isChordToken(m[0]);
    const text = isChord ? mapTok(m[0]) : m[0];
    let pad = m.index - len;
    if (len > 0 && pad < 1) pad = 1;
    if (pad < 0) pad = 0;
    parts.push({ pad, text, isChord });
    len += pad + text.length;
  }
  return parts;
}

function transposeText(text, semis, flats) {
  return text.split('\n').map(line => {
    if (!isChordLine(line)) return line;
    return layoutChordLine(line, t => transposeToken(t, semis, flats))
      .map(p => ' '.repeat(p.pad) + p.text).join('');
  }).join('\n');
}

// El tono es el del primer acorde de la canción
function detectKey(text) {
  for (const line of text.split('\n')) {
    if (!isChordLine(line)) continue;
    for (const tok of line.trim().split(/\s+/)) {
      const core = splitPunct(tok)[1];
      const c = core && parseChord(core);
      if (c) return { idx: noteIndex(c.root, c.acc), minor: isMinorQuality(c.mqual), chord: core };
    }
  }
  return null;
}

const keyName = (idx, minor, latin = isLatin()) => spell(idx, keyPrefersFlats(idx, minor), latin) + (minor ? 'm' : '');
const keyLabel = (k, latin = isLatin()) => spell(k.idx, keyPrefersFlats(k.idx, k.minor), latin) + (k.minor ? ' menor' : ' mayor');
