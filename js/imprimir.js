'use strict';
// Imprimir con vista previa: canción actual, cancionero completo y tríptico para la asamblea.
// Las páginas se arman aquí midiendo cada estrofa, para que los saltos de página y de columna
// caigan siempre entre estrofas y nunca separen una línea de acordes de su letra.

const PAPERS = {
  carta:  { label: 'Carta',  w: 215.9, h: 279.4 },
  oficio: { label: 'Oficio', w: 215.9, h: 330.2 },
  a4:     { label: 'A4',     w: 210,   h: 297 }
};
const PX_PER_MM = 96 / 25.4;
const PRINT_MIN_PT = 7;
const LEGIBLE_PT = 8;
const TRIPTYCH_MAX_PT = 30;
const SONG_PAGE = { margin: 12, gap: 8 };
const TRIPTYCH_PAD = { x: 8, y: 9 };
const PRINT_OPTS_KEY = 'canciotras.impresion';
const PRINT_DEFAULTS = {
  papel: 'carta', orientacion: 'vertical', acordes: true, unaHoja: true, columnas: 'auto', letra: 12,
  comentarios: true, portada: true, titulo: '', subtitulo: '', hojas: 2, portadaTriptico: false, secciones: true
};

function loadPrintOpts() {
  try { return { ...PRINT_DEFAULTS, ...JSON.parse(localStorage.getItem(PRINT_OPTS_KEY) || '{}') }; }
  catch (_) { return { ...PRINT_DEFAULTS }; }
}

const pv = { el: null, mode: 'cancion', opts: loadPrintOpts(), selected: new Set(), breaks: new Set(),
  html: '', pageW: 0, pageH: 0, zoom: 0, timer: null, clickTimer: null };

// ============ ESTROFAS ============
// Una estrofa (bloque separado por líneas en blanco o títulos de sección) nunca se corta.
// Dentro de ella, las unidades (acordes + su letra) solo se separan si la estrofa no cabe
// entera en una columna vacía.
function printBlocks(text, { chords, comments, headings }) {
  const blocks = [], lines = text.split('\n');
  let units = [], pre = [], preStart = -1, voice = null, voiceStart = false;
  const flush = () => { if (units.length) blocks.push({ units, line: units[0].line }); units = []; };
  const addPre = (l, i) => { if (preStart < 0) preStart = i; pre.push(l); };
  const addUnit = (ls, i) => {
    units.push({ lines: pre.concat(ls), voice, voiceStart, line: preStart >= 0 ? preStart : i });
    pre = []; preStart = -1; voiceStart = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const vm = parseVoiceMarker(l);
    if (vm) {
      if (chords) { voice = vm.key === 'unica' ? null : vm; voiceStart = !!voice; }
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    if (HEADING_RE.test(l)) { flush(); if (headings) addPre(l, i); continue; }
    if (COMMENT_RE.test(l)) {
      if (!comments) continue;
      if (units.length && !pre.length) units.at(-1).lines.push(l);
      else addPre(l, i);
      continue;
    }
    if (STRUM_MARKER_RE.test(l)) { if (chords) addPre(l, i); continue; }
    if (isChordLine(l)) {
      if (!chords) continue;
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && !isSpecialLine(next) && !isChordLine(next)) { addUnit([l, next], i); i++; }
      else addUnit([l], i);
      continue;
    }
    addUnit([chords ? l : l.trim()], i);
  }
  if (pre.length) {
    const last = units.at(-1) || blocks.at(-1)?.units.at(-1);
    if (last) last.lines.push(...pre);
  }
  flush();
  return blocks;
}

function songItems(d, o, lyricsOnly) {
  const title = escapeHtml(d.title.trim() || 'Sin título');
  const key = lyricsOnly ? null : detectKey(d.text);
  const head = lyricsOnly
    ? `<div class="pv-song-title">${title}</div>`
    : `<header class="song-header"><div class="song-title">${title}</div>` +
      (key ? `<div class="song-meta">Tono: <strong>${escapeHtml(keyLabel(key))}</strong></div>` : '') + '</header>';
  const blocks = printBlocks(d.text, {
    chords: !lyricsOnly,
    comments: !lyricsOnly && o.comentarios,
    headings: !lyricsOnly || o.secciones
  });
  return [
    { id: d.id + ':t', doc: d.id, line: 0, keepNext: true, units: [{ html: head }] },
    ...blocks.map((b, i) => ({
      id: d.id + ':' + i, doc: d.id, line: b.line,
      units: b.units.map(u => ({ html: u.lines.map(renderLine).join(''), voice: u.voice, voiceStart: u.voiceStart }))
    }))
  ];
}

function itemHtml(it, from = 0, to = it.units.length) {
  let html = '', open = null;
  for (let k = from; k < to; k++) {
    const u = it.units[k];
    const v = u.voice?.key || null;
    if (v !== open) {
      if (open) html += '</section>';
      if (v) html += `<section class="voice-section" style="--vc:${VOICES[v]?.color || '#607d8b'}">` +
        (u.voiceStart ? `<div class="voice-label">🎤 ${escapeHtml(u.voice.label)}</div>` : '');
      open = v;
    }
    html += `<div class="pv-unit">${u.html}</div>`;
  }
  if (open) html += '</section>';
  return html;
}

// ============ MEDIDAS Y REPARTO ============
let measurer = null;
function measureItems(items, widthMm, pt, cls) {
  if (!measurer) {
    measurer = el('div');
    measurer.setAttribute('aria-hidden', 'true');
    measurer.style.cssText = 'position:fixed;left:-30000px;top:0;visibility:hidden;pointer-events:none';
    document.body.appendChild(measurer);
  }
  const key = cls + '|' + widthMm;
  if (measurer._items !== items || measurer._key !== key) {
    measurer.className = 'pv-col song-render ' + cls;
    measurer.style.width = widthMm + 'mm';
    measurer.innerHTML = items.map(it => `<div class="pv-item">${itemHtml(it)}</div>`).join('');
    measurer._items = items;
    measurer._key = key;
  }
  measurer.style.fontSize = pt + 'pt';
  let wide = false;
  const list = items.map((it, i) => {
    const node = measurer.children[i];
    if (node.scrollWidth > node.clientWidth + 1) wide = true;
    const h = node.getBoundingClientRect().height;
    const us = [...node.querySelectorAll('.pv-unit')].map(u => u.getBoundingClientRect().height);
    return { it, h, us, extra: Math.max(0, h - us.reduce((a, b) => a + b, 0)) };
  });
  return { list, wide };
}

// Reparte las estrofas en columnas de alto H (px). El título de cada canción va siempre
// junto con su primera estrofa.
function packColumns(list, H) {
  const cols = [[]];
  let used = 0;
  const newCol = () => { cols.push([]); used = 0; };
  const put = (m, from, to, h) => { cols.at(-1).push({ it: m.it, from, to }); used += h; };
  list.forEach((m, k) => {
    if ((m.it.breakBefore || pv.breaks.has(m.it.id)) && cols.at(-1).length) newCol();
    let need = m.h;
    const n = m.it.keepNext && list[k + 1];
    if (n) need += n.h <= H ? n.h : n.extra + (n.us[0] || 0);
    if (need > H - used && cols.at(-1).length) newCol();
    if (m.h <= H - used) { put(m, 0, m.us.length, m.h); return; }
    let from = 0;
    while (from < m.us.length) {
      let to = from, h = m.extra;
      while (to < m.us.length && h + m.us[to] <= H - used) h += m.us[to++];
      if (to === from) {
        if (cols.at(-1).length) { newCol(); continue; }
        h += m.us[to++];
      }
      put(m, from, to, h);
      from = to;
      if (from < m.us.length) newCol();
    }
  });
  if (cols.length > 1 && !cols.at(-1).length) cols.pop();
  return cols;
}

// Mayor tamaño de letra (en pasos de medio punto) con el que todo cabe en maxCols columnas
function fitFont(items, widthMm, H, cls, maxCols, loPt, hiPt, needWidth) {
  const tryPt = pt => {
    const r = measureItems(items, widthMm, pt, cls);
    if (needWidth && r.wide) return null;
    const cols = packColumns(r.list, H);
    return cols.length <= maxCols ? cols : null;
  };
  let lo = Math.round(loPt * 2), hi = Math.round(hiPt * 2);
  let best = tryPt(lo / 2);
  if (!best) return null;
  const top = tryPt(hi / 2);
  if (top) return { pt: hi / 2, cols: top };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const c = tryPt(mid / 2);
    if (c) { lo = mid; best = c; } else hi = mid;
  }
  return { pt: lo / 2, cols: best };
}

// Mayor letra (hasta maxPt) con la que ninguna línea de acordes se sale de la columna
function fitWidth(items, widthMm, cls, maxPt) {
  let lo = PRINT_MIN_PT * 2, hi = Math.round(maxPt * 2);
  if (!measureItems(items, widthMm, hi / 2, cls).wide) return hi / 2;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (measureItems(items, widthMm, mid / 2, cls).wide) hi = mid; else lo = mid;
  }
  return lo / 2;
}

const chunk = (arr, n) => arr.reduce((acc, x, i) => (i % n ? acc.at(-1).push(x) : acc.push([x]), acc), []);

// ============ CANCIÓN Y CANCIONERO ============
function songGeometry(o) {
  const p = PAPERS[o.papel] || PAPERS.carta;
  const land = o.orientacion === 'horizontal';
  const W = land ? p.h : p.w, H = land ? p.w : p.h;
  const innerW = W - 2 * SONG_PAGE.margin, innerH = H - 2 * SONG_PAGE.margin;
  return { W, H, innerW, innerH, colH: innerH * PX_PER_MM - 2,
    colW: c => (innerW - SONG_PAGE.gap * (c - 1)) / c };
}

function layoutSong(items, g, o, lyricsOnly) {
  const cls = lyricsOnly ? 'pv-lyrics' : '';
  const maxPt = +o.letra || PRINT_DEFAULTS.letra;
  const cands = o.columnas === 'auto' ? [1, 2, 3] : [+o.columnas];
  if (o.unaHoja) {
    // Si no cabe en una hoja con letra legible, en el menor número de páginas posible
    for (let pages = 1; pages <= 6; pages++) {
      let best = null;
      for (const c of cands) {
        const r = fitFont(items, g.colW(c), g.colH, cls, pages * c, LEGIBLE_PT, maxPt, !lyricsOnly);
        if (r && (!best || r.pt >= best.pt + 1)) best = { ...r, c };
        if (best && best.pt >= maxPt) break;
      }
      if (best) return { pt: best.pt, c: best.c, pages: chunk(best.cols, best.c), fits: pages === 1 };
    }
  }
  const c = o.columnas === 'auto' ? (o.unaHoja ? 2 : 1) : +o.columnas;
  const pt = lyricsOnly ? maxPt : fitWidth(items, g.colW(c), cls, maxPt);
  const cols = packColumns(measureItems(items, g.colW(c), pt, cls).list, g.colH);
  return { pt, c, pages: chunk(cols, c), fits: !o.unaHoja };
}

function colHtml(col, pt, cls, style) {
  return `<div class="pv-col song-render ${cls}" style="${style};font-size:${pt}pt">` +
    col.map(s => `<div class="pv-item${pv.breaks.has(s.it.id) ? ' pv-break' : ''}" data-bid="${escapeHtml(s.it.id)}"` +
      ` data-doc="${escapeHtml(s.it.doc || '')}" data-line="${s.it.line || 0}">${itemHtml(s.it, s.from, s.to)}</div>`).join('') +
    '</div>';
}

function pageHtml(W, H, inner, label = '') {
  return `<div class="pv-wrap">${label ? `<div class="pv-label pv-only">${label}</div>` : ''}` +
    `<div class="pv-page" style="width:${W}mm;height:${H - 0.5}mm">${inner}</div></div>`;
}

function layoutSongs() {
  const o = pv.opts, lyricsOnly = !o.acordes, book = pv.mode === 'cancionero';
  const list = book ? docs.filter(d => pv.selected.has(d.id)) : [cur()];
  if (!list.length) return { html: '', status: '<p class="pv-warn">Elige al menos una canción.</p>' };
  const g = songGeometry(o);
  const cls = lyricsOnly ? 'pv-lyrics' : '';
  const results = list.map(d => ({ d, ...layoutSong(songItems(d, o, lyricsOnly), g, o, lyricsOnly) }));
  const cover = book && o.portada;
  let n = cover ? 2 : 1;
  results.forEach(r => { r.start = n; n += r.pages.length; });
  const total = n - 1;
  let html = '';
  if (cover) {
    const title = escapeHtml(o.titulo.trim() || state.cancioneroName || 'Cancionero');
    html += pageHtml(g.W, g.H, `<div class="pv-book-cover" style="left:${SONG_PAGE.margin}mm;top:${SONG_PAGE.margin * 1.5}mm;right:${SONG_PAGE.margin}mm">` +
      `<h1>${title}</h1><ol class="${results.length > 34 ? 'two' : ''}">` +
      results.map(r => `<li><span>${escapeHtml(r.d.title.trim() || 'Sin título')}</span><i></i><b>${r.start}</b></li>`).join('') +
      '</ol></div>', 'Portada');
  }
  for (const r of results) {
    r.pages.forEach((cols, i) => {
      const wMm = g.colW(r.c);
      const colsHtml = cols.map(col => colHtml(col, r.pt, cls, '')).join('');
      const foot = book ? String(r.start + i)
        : r.pages.length > 1 ? `${escapeHtml(r.d.title.trim() || 'Sin título')} · ${i + 1}/${r.pages.length}` : '';
      html += pageHtml(g.W, g.H,
        `<div class="pv-cols" style="left:${SONG_PAGE.margin}mm;top:${SONG_PAGE.margin}mm;width:${g.innerW}mm;height:${g.innerH}mm;` +
        `grid-template-columns:repeat(${r.c}, ${wMm}mm);column-gap:${SONG_PAGE.gap}mm">${colsHtml}</div>` +
        (foot ? `<div class="pv-foot">${foot}</div>` : ''),
        `Página ${r.start + i}${i === 0 && results.length > 1 ? ' · ' + escapeHtml(r.d.title.trim() || 'Sin título') : ''}`);
    });
  }
  pv.pageW = g.W; pv.pageH = g.H;
  const rows = results.map(r => {
    const pages = r.pages.length;
    const warn = o.unaHoja && !r.fits
      ? ' <span class="pv-warn">⚠ no cabe en una hoja con letra legible (prueba Horizontal, papel Oficio o un clic en sus estrofas)</span>' : '';
    const small = r.pt < (+o.letra) ? ' (achicada para calzar)' : '';
    return `<li><b>${escapeHtml(r.d.title.trim() || 'Sin título')}</b>: ${pages} ${pages === 1 ? 'página' : 'páginas'}` +
      `${r.c > 1 ? `, ${r.c} columnas` : ''}, letra de ${fmtPt(r.pt)} pt${small}${warn}</li>`;
  }).join('');
  return { html, status: `<p><b>Total: ${total} ${total === 1 ? 'página' : 'páginas'}</b></p><ul>${rows}</ul>` };
}

const fmtPt = pt => String(pt).replace('.', ',');

// ============ TRÍPTICO ============
// Hoja apaisada doblada en tres (plegado envolvente). Orden de lectura en cada hoja:
// 1 portada, 2-3-4 interior, 5 solapa, 6 contraportada. Cara exterior: 5 6 1; interior: 2 3 4.
const TRIPTYCH_FACES = [[4, 5, 0], [1, 2, 3]];
const PANEL_ROLE = ['portada', 'interior izquierda', 'interior centro', 'interior derecha', 'solapa', 'contraportada'];

function layoutTriptych() {
  const o = pv.opts;
  const list = docs.filter(d => pv.selected.has(d.id));
  if (!list.length) return { html: '', status: '<p class="pv-warn">Elige al menos una canción.</p>' };
  const p = PAPERS[o.papel] || PAPERS.carta;
  const W = p.h, H = p.w, panelW = W / 3;
  const colW = panelW - 2 * TRIPTYCH_PAD.x, colHmm = H - 2 * TRIPTYCH_PAD.y;
  const colH = colHmm * PX_PER_MM - 2;
  const title = o.titulo.trim() || state.cancioneroName || 'Cancionero';
  const index = o.portadaTriptico
    ? `<ol>${list.map(d => `<li>${escapeHtml(d.title.trim() || 'Sin título')}</li>`).join('')}</ol>` : '';
  const cover = { id: 'portada', line: 0, keepNext: !o.portadaTriptico, units: [{ html:
    `<div class="pv-cover"><div class="pv-cover-title">${escapeHtml(title)}</div>` +
    (o.subtitulo.trim() ? `<div class="pv-cover-sub">${escapeHtml(o.subtitulo.trim())}</div>` : '') + index + '</div>' }] };
  const items = [cover];
  list.forEach((d, i) => {
    const its = songItems(d, o, true);
    if (i === 0 && o.portadaTriptico) its[0].breakBefore = true;
    items.push(...its);
  });
  const cls = 'pv-lyrics pv-tri';
  const maxPanels = (+o.hojas || 1) * 6;
  let fit = fitFont(items, colW, colH, cls, maxPanels, PRINT_MIN_PT, TRIPTYCH_MAX_PT, false);
  const fits = !!fit;
  if (!fit) fit = { pt: PRINT_MIN_PT, cols: packColumns(measureItems(items, colW, PRINT_MIN_PT, cls).list, colH) };
  const sheets = Math.ceil(fit.cols.length / 6);
  let html = '';
  for (let s = 0; s < sheets; s++) {
    TRIPTYCH_FACES.forEach((face, fi) => {
      const panels = face.map((r, slot) => {
        const idx = s * 6 + r, col = fit.cols[idx];
        return `<div class="pv-panel" style="left:${slot * panelW}mm;width:${panelW}mm">` +
          `<div class="pv-num pv-only">${idx + 1} · ${PANEL_ROLE[r]}</div>` +
          (col ? colHtml(col, fit.pt, cls, `position:absolute;left:${TRIPTYCH_PAD.x}mm;top:${TRIPTYCH_PAD.y}mm;width:${colW}mm;height:${colHmm}mm`) : '') +
          '</div>';
      }).join('');
      html += pageHtml(W, H, panels, `Hoja ${s + 1} · ${fi ? 'cara interior (al reverso)' : 'cara exterior (portada)'}`);
    });
  }
  pv.pageW = W; pv.pageH = H;
  const status = `<p><b>${sheets} ${sheets === 1 ? 'hoja' : 'hojas'} (${sheets * 2} caras) · letra de ${fmtPt(fit.pt)} pt</b></p>` +
    (fits ? '' : `<p class="pv-warn">⚠ No cabe en ${o.hojas} ${+o.hojas === 1 ? 'hoja' : 'hojas'} ni con la letra más chica; quita canciones o permite más hojas.</p>`) +
    '<p>Imprime a <b>doble cara, girando por el borde corto</b>. Después dobla la hoja en tres con la portada hacia afuera.</p>';
  return { html, status };
}

// ============ VISTA PREVIA ============
const seg = (name, val, options) => `<div class="pv-seg">${options.map(([v, l]) =>
  `<label><input type="radio" name="${name}" value="${v}"${String(val) === String(v) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
const check = (opt, val, label) =>
  `<label class="pv-check"><input type="checkbox" data-opt="${opt}"${val ? ' checked' : ''}> ${label}</label>`;
const paperSelect = o => `<select data-opt="papel">${Object.entries(PAPERS).map(([k, p]) =>
  `<option value="${k}"${o.papel === k ? ' selected' : ''}>${p.label} (${p.w} × ${p.h} mm)</option>`).join('')}</select>`;

function pvSideHtml() {
  const o = pv.opts, m = pv.mode, tri = m === 'triptico';
  let h = `<h2>🖨️ Imprimir</h2>
    <div class="pv-group"><b>Qué imprimir</b>${seg('pvMode', m, [['cancion', 'Canción'], ['cancionero', 'Cancionero'], ['triptico', 'Tríptico']])}</div>`;
  if (!tri) {
    h += `<div class="pv-group pv-question"><b>¿Cada canción en una sola hoja?</b>
        ${seg('unaHoja', o.unaHoja, [[true, 'Sí, en una hoja'], [false, 'No, seguida']])}
        <span class="hint">${o.unaHoja
          ? 'Si no cabe, se pone en columnas y se achica la letra, sin separar los acordes de su letra.'
          : 'Los saltos de página caen siempre entre estrofas.'}</span></div>
      <div class="pv-group"><b>Contenido</b>${seg('acordes', o.acordes, [[true, 'Letra y acordes'], [false, 'Solo letra']])}
        ${o.acordes ? check('comentarios', o.comentarios, 'Comentarios') : check('secciones', o.secciones, 'Títulos de sección (Coro, Estrofa…)')}</div>
      <div class="pv-group"><b>Columnas</b>${seg('columnas', o.columnas, [['auto', 'Automático'], [1, '1'], [2, '2'], [3, '3']])}</div>
      <div class="pv-group"><b>${o.unaHoja ? 'Letra (tamaño máximo)' : 'Tamaño de letra'}: <span id="pvLetra">${fmtPt(o.letra)} pt</span></b>
        <input type="range" data-opt="letra" min="8" max="24" step="0.5" value="${o.letra}"></div>
      <div class="pv-group"><b>Papel</b>${paperSelect(o)}${seg('orientacion', o.orientacion, [['vertical', 'Vertical'], ['horizontal', 'Horizontal']])}</div>`;
    if (m === 'cancionero') {
      h += `<div class="pv-group"><b>Portada</b>${check('portada', o.portada, 'Portada con índice')}
        ${o.portada ? `<input type="text" data-opt="titulo" value="${escapeHtml(o.titulo)}" placeholder="${escapeHtml(state.cancioneroName || 'Título del cancionero')}">` : ''}</div>`;
    }
  } else {
    h += `<div class="pv-group pv-question"><b>Para el público o la asamblea</b>
        <span class="hint">Solo letra, lo más grande posible sin pasarse de las hojas elegidas.</span>
        ${seg('hojas', o.hojas, [[1, '1 hoja (2 caras)'], [2, '2 hojas (4 caras)']])}</div>
      <div class="pv-group"><b>Portada</b>
        <input type="text" data-opt="titulo" value="${escapeHtml(o.titulo)}" placeholder="${escapeHtml(state.cancioneroName || 'Título')}">
        <input type="text" data-opt="subtitulo" value="${escapeHtml(o.subtitulo)}" placeholder="Subtítulo (fecha, celebración…)">
        ${check('portadaTriptico', o.portadaTriptico, 'Portada aparte, con índice')}
        ${check('secciones', o.secciones, 'Títulos de sección (Coro, Estrofa…)')}</div>
      <div class="pv-group"><b>Papel</b>${paperSelect(o)}</div>`;
  }
  if (m !== 'cancion') {
    h += `<div class="pv-group"><b>Canciones <span class="hint">(en el orden de las pestañas)</span></b>
      <div class="pv-songs">${docs.map(d => `<label><input type="checkbox" data-song="${escapeHtml(d.id)}"${pv.selected.has(d.id) ? ' checked' : ''}>
        ${escapeHtml(d.title.trim() || 'Sin título')}</label>`).join('')}</div>
      <div class="pv-row"><button type="button" class="btn small" data-pv="all">Todas</button><button type="button" class="btn small" data-pv="none">Ninguna</button></div></div>`;
  }
  h += `<div class="pv-tip">✋ <b>Clic</b> en una estrofa: pasa a la columna o página siguiente (otro clic lo deshace).
      <b>Doble clic</b>: ir a editarla.${pv.breaks.size ? ` <button type="button" class="linkish" data-pv="clearBreaks">Quitar mis saltos (${pv.breaks.size})</button>` : ''}</div>
    <div class="pv-status" id="pvStatus"></div>
    <div class="pv-actions"><button type="button" class="btn" data-pv="close">Cerrar</button>
      <button type="button" class="btn primary" data-pv="print">🖨️ Imprimir</button></div>`;
  return h;
}

function buildPreview() {
  const root = el('div', 'pv');
  root.id = 'printPreview';
  root.hidden = true;
  root.innerHTML = `<aside class="pv-side" id="pvSide"></aside>
    <div class="pv-stage" id="pvStage">
      <div class="pv-zoombar"><button type="button" class="btn small" data-pv="zoomOut" title="Alejar">−</button>
        <span id="pvZoomLabel">100%</span>
        <button type="button" class="btn small" data-pv="zoomIn" title="Acercar">+</button>
        <button type="button" class="btn small" data-pv="zoomFit">Ajustar al ancho</button></div>
      <div class="pv-sheets" id="pvSheets"></div>
    </div>`;
  document.body.appendChild(root);
  pv.el = root;

  root.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'pvMode') { pv.mode = t.value; pvRefresh(true); return; }
    if (t.dataset.song) {
      t.checked ? pv.selected.add(t.dataset.song) : pv.selected.delete(t.dataset.song);
      pvRefresh();
      return;
    }
    const opt = t.dataset.opt || (t.type === 'radio' ? t.name : null);
    if (!opt || !(opt in PRINT_DEFAULTS)) return;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (v === 'true') v = true; else if (v === 'false') v = false;
    else if (typeof PRINT_DEFAULTS[opt] === 'number') v = +v;
    setPrintOpt(opt, v, t.type !== 'text' && t.type !== 'range');
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.opt === 'letra') {
      $('#pvLetra').textContent = fmtPt(+t.value) + ' pt';
      setPrintOpt('letra', +t.value, false, 250);
    } else if (t.type === 'text' && t.dataset.opt) setPrintOpt(t.dataset.opt, t.value, false, 400);
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-pv]');
    if (b) { pvCommand(b.dataset.pv); return; }
    const item = e.target.closest('#pvSheets .pv-item');
    if (!item) return;
    clearTimeout(pv.clickTimer);
    pv.clickTimer = setTimeout(() => toggleBreak(item.dataset.bid), 260);
  });
  root.addEventListener('dblclick', e => {
    const item = e.target.closest('#pvSheets .pv-item');
    if (!item || !item.dataset.doc) return;
    clearTimeout(pv.clickTimer);
    editFromPreview(item.dataset.doc, +item.dataset.line || 0);
  });
  window.addEventListener('resize', () => { if (!pv.el.hidden && !pv.zoom) pvZoom(); });
}

function setPrintOpt(opt, v, rebuildSide, delay = 0) {
  pv.opts[opt] = v;
  try { localStorage.setItem(PRINT_OPTS_KEY, JSON.stringify(pv.opts)); } catch (_) {}
  pvRefresh(rebuildSide, delay);
}

function pvRefresh(rebuildSide = false, delay = 0) {
  clearTimeout(pv.timer);
  if (rebuildSide) $('#pvSide').innerHTML = pvSideHtml();
  const run = () => {
    const res = pv.mode === 'triptico' ? layoutTriptych() : layoutSongs();
    pv.html = res.html;
    $('#pvSheets').innerHTML = res.html || '<p class="pv-empty">Nada que imprimir.</p>';
    $('#pvStatus').innerHTML = res.status;
    pvZoom();
  };
  if (delay) pv.timer = setTimeout(run, delay); else run();
}

function pvZoom() {
  const sheets = $('#pvSheets');
  let z = pv.zoom;
  if (!z) {
    const avail = $('#pvStage').clientWidth - 48;
    z = Math.min(1, avail / (pv.pageW * PX_PER_MM || 1));
  }
  sheets.style.zoom = z;
  $('#pvZoomLabel').textContent = Math.round(z * 100) + '%';
}

function pvCommand(cmd) {
  switch (cmd) {
    case 'close': return closePrintPreview();
    case 'print': return printFromPreview();
    case 'all': docs.forEach(d => pv.selected.add(d.id)); return pvRefresh(true);
    case 'none': pv.selected.clear(); return pvRefresh(true);
    case 'clearBreaks': pv.breaks.clear(); return pvRefresh(true);
    case 'zoomFit': pv.zoom = 0; return pvZoom();
    case 'zoomIn':
    case 'zoomOut': {
      const now = parseFloat($('#pvSheets').style.zoom) || 1;
      pv.zoom = Math.min(2, Math.max(0.25, Math.round((now + (cmd === 'zoomIn' ? 0.1 : -0.1)) * 10) / 10));
      return pvZoom();
    }
  }
}

function toggleBreak(id) {
  if (!id) return;
  pv.breaks.has(id) ? pv.breaks.delete(id) : pv.breaks.add(id);
  const stage = $('#pvStage'), y = stage.scrollTop;
  pvRefresh(true);
  stage.scrollTop = y;
}

function editFromPreview(docId, line) {
  closePrintPreview();
  if (docId !== activeId) switchTab(docId);
  setMode('edit');
  const lines = editor.value.split('\n');
  const pos = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  editor.setSelectionRange(pos, pos);
  editor.focus({ preventScroll: true });
  const lh = parseFloat(getComputedStyle(editor).lineHeight) || 22;
  window.scrollTo(0, Math.max(0, editor.getBoundingClientRect().top + window.scrollY + line * lh - window.innerHeight / 3));
}

function openPrintPreview(mode = 'cancion') {
  syncFromEditor();
  if (typeof stopAutoscroll === 'function') stopAutoscroll();
  if (!pv.el) buildPreview();
  pv.mode = mode;
  pv.selected = new Set(docs.map(d => d.id));
  const ids = new Set(docs.map(d => d.id));
  for (const b of [...pv.breaks]) if (!ids.has(b.split(':')[0])) pv.breaks.delete(b);
  pv.el.hidden = false;
  document.body.classList.add('pv-open');
  pvRefresh(true);
  $('#pvSide').querySelector('.btn.primary')?.focus();
}

function closePrintPreview() {
  if (!pv.el || pv.el.hidden) return;
  clearTimeout(pv.timer);
  pv.el.hidden = true;
  document.body.classList.remove('pv-open');
  $('#pvSheets').innerHTML = '';
}

function printFromPreview() {
  if (!pv.html) { toast('No hay nada que imprimir'); return; }
  $('#printAll').innerHTML = pv.html;
  let st = $('#pvPageCss');
  if (!st) { st = el('style'); st.id = 'pvPageCss'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${pv.pageW}mm ${pv.pageH}mm; margin: 0; }`;
  document.body.classList.add('printing-all');
  window.print();
}

window.addEventListener('afterprint', () => {
  if (!document.body.classList.contains('printing-all')) return;
  document.body.classList.remove('printing-all');
  $('#printAll').innerHTML = '';
  const st = $('#pvPageCss');
  if (st) st.textContent = '';
});

// Con la vista previa abierta, el teclado solo sirve para ella
document.addEventListener('keydown', e => {
  if (!pv.el || pv.el.hidden || e.target.closest?.('dialog')) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape') { e.preventDefault(); closePrintPreview(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); printFromPreview(); }
}, true);
