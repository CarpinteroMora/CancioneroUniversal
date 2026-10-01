'use strict';
// Rasgueos: notación, biblioteca de ritmos, dibujo SVG y editor.
// Notación por subdivisión: B abajo, A arriba, b/a suaves, X apagado o chasquido, - silencio,
// > acento (delante del golpe) y | compás. En la letra: [Rasgueo: Vals 3/4 | >B - B A B A]
// Con solo el nombre ([Rasgueo: Cueca]) se usa el patrón de la biblioteca.

const STRUM_LIBRARY = [
  { nombre: 'Pop', compas: '4/4', patron: 'B - B A - A B A' },
  { nombre: 'Balada', compas: '4/4', patron: '>B - - - B - B A' },
  { nombre: 'Vals', compas: '3/4', patron: '>B - B A B A' },
  { nombre: 'Cueca', compas: '6/8', patron: '>B A B >B A B | >B A >B A >B A' },
  { nombre: 'Tonada', compas: '6/8', patron: '>B - A B - A' },
  { nombre: 'Huayno', compas: '2/4', patron: '>B - B A' },
  { nombre: 'Cumbia', compas: '4/4', patron: 'B A X A B A X A' },
  { nombre: 'Bolero', compas: '4/4', patron: '>B - X - B A X -' },
  { nombre: 'Ranchera', compas: '3/4', patron: '>B - A - A -' },
  { nombre: 'Joropo', compas: '3/4', patron: '>B A B A >X A' },
  { nombre: 'Guarania', compas: '3/4', patron: '>B - B - B A' },
  { nombre: 'Rock', compas: '4/4', patron: '>B B B B >B B B B' }
];

const STRUM_KEY = 'canciotras.rasgueos';
function customStrums() {
  try { return JSON.parse(localStorage.getItem(STRUM_KEY)) || []; } catch (_) { return []; }
}
const strumLibrary = () => [...customStrums(), ...STRUM_LIBRARY];
const findStrum = name => strumLibrary().find(r => slugify(r.nombre) === slugify(name || ''));

function parseStrumPattern(str) {
  const bars = [[]];
  let acc = false;
  for (const ch of String(str || '')) {
    if (ch === '>') acc = true;
    else if (ch === '|') { if (bars.at(-1).length) bars.push([]); }
    else if ('BAbaXx-.'.includes(ch)) {
      bars.at(-1).push({ s: ch === 'x' ? 'X' : ch === '.' ? '-' : ch, acc });
      acc = false;
    }
  }
  if (bars.length > 1 && !bars.at(-1).length) bars.pop();
  return bars;
}

const serializeStrum = bars => bars.map(b => b.map(x => (x.acc ? '>' : '') + x.s).join(' ')).join(' | ');
const looksLikePattern = s => /^[\sBAbaXx\-.>|]+$/.test(s) && /[BAbaXx]/.test(s);

function parseStrumMarker(line) {
  const m = String(line).match(STRUM_MARKER_RE);
  if (!m) return null;
  const body = m[1];
  const cut = body.indexOf('|');
  let head = cut < 0 ? body : body.slice(0, cut);
  let patron = cut < 0 ? '' : body.slice(cut + 1);
  if (cut < 0 && looksLikePattern(head)) { patron = head; head = ''; }
  let compas = head.match(/\b(\d{1,2}\/\d{1,2})\b/)?.[1] || '';
  const nombre = head.replace(compas, '').trim();
  if (!patron.trim()) {
    const lib = findStrum(nombre);
    if (lib) { patron = lib.patron; compas ||= lib.compas; }
  }
  return { nombre, compas, patron: patron.trim(), bars: parseStrumPattern(patron) };
}

const strumMarker = (nombre, compas, bars) =>
  `[Rasgueo: ${[nombre.trim(), compas].filter(Boolean).join(' ')} | ${serializeStrum(bars)}]`;

// Rasgueos distintos que usa la canción
function songStrums(text) {
  const out = [], seen = new Set();
  for (const line of text.split('\n')) {
    const r = parseStrumMarker(line);
    if (!r || !r.bars[0]?.length) continue;
    const k = r.nombre + '|' + serializeStrum(r.bars);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}

// ============ DIBUJO ============
function strumSvg(bars, compas = '') {
  const beats = parseInt(compas, 10) || 0;
  const sx = 22, h = 62, pad = 6, gap = 12;
  let pos = pad, s = '';
  bars.forEach((bar, bi) => {
    if (bi) {
      s += `<line x1="${pos + gap / 2}" y1="8" x2="${pos + gap / 2}" y2="44" stroke="#9aa0a6" stroke-width="1.5"/>`;
      pos += gap;
    }
    const spb = beats && bar.length % beats === 0 ? bar.length / beats : bar.length % 2 === 0 ? 2 : 1;
    bar.forEach((st, i) => {
      const cx = pos + sx / 2;
      const soft = st.s === 'b' || st.s === 'a';
      const color = soft ? '#9aa0a6' : '#202124', sw = soft ? 1.6 : 2.6;
      if (st.s === 'B' || st.s === 'b') {
        s += `<line x1="${cx}" y1="12" x2="${cx}" y2="34" stroke="${color}" stroke-width="${sw}"/>`
          + `<polygon points="${cx - 5},32 ${cx + 5},32 ${cx},41" fill="${color}"/>`;
      } else if (st.s === 'A' || st.s === 'a') {
        s += `<line x1="${cx}" y1="41" x2="${cx}" y2="19" stroke="${color}" stroke-width="${sw}"/>`
          + `<polygon points="${cx - 5},21 ${cx + 5},21 ${cx},12" fill="${color}"/>`;
      } else if (st.s === 'X') {
        s += `<text x="${cx}" y="32" text-anchor="middle" font-size="15" fill="#5f6368">✕</text>`;
      } else {
        s += `<circle cx="${cx}" cy="27" r="2" fill="#bdc1c6"/>`;
      }
      if (st.acc) s += `<text x="${cx}" y="9" text-anchor="middle" font-size="11" font-weight="bold" fill="#d93025">&gt;</text>`;
      const label = i % spb === 0 ? String(i / spb + 1) : spb % 2 === 0 && i % spb === spb / 2 ? 'y' : '';
      if (label) s += `<text x="${cx}" y="57" text-anchor="middle" font-size="10" fill="${label === 'y' ? '#9aa0a6' : '#5f6368'}">${label}</text>`;
      pos += sx;
    });
  });
  const w = pos + pad;
  return `<svg class="strum-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial, sans-serif">${s}</svg>`;
}

const strumTitle = r => [r.nombre, r.compas].filter(Boolean).join(' ') || 'Rasgueo';

function strumLineHtml(r) {
  if (!r.bars[0]?.length) return `<div class="line strum-line"><span class="strum-name">🎸 ${escapeHtml(strumTitle(r))}</span></div>`;
  return `<div class="line strum-line"><span class="strum-name">🎸 ${escapeHtml(strumTitle(r))}</span>${strumSvg(r.bars, r.compas)}</div>`;
}

// ============ EDITOR (Insertar > Rasgueo…) ============
const STRUM_CYCLE = ['-', 'B', 'A', 'b', 'a', 'X'];
const STRUM_GLYPH = { '-': '·', B: '↓', A: '↑', b: '↓', a: '↑', X: '✕' };

async function strumDialog() {
  const lib = strumLibrary();
  let bars = parseStrumPattern(lib[0].patron);
  const meters = ['2/4', '3/4', '4/4', '6/8', '12/8'];
  const opts = (list, sel) => list.map(v => `<option${String(v) === String(sel) ? ' selected' : ''}>${v}</option>`).join('');

  const draw = dlg => {
    const grid = dlg.querySelector('#rGrid');
    grid.innerHTML = bars.map((bar, bi) => `<div class="strum-bar">${bar.map((st, i) =>
      `<button type="button" class="strum-cell${st.acc ? ' acc' : ''}${'ba'.includes(st.s) ? ' soft' : ''}" data-b="${bi}" data-i="${i}" title="Clic: cambiar golpe · Clic derecho: acento">${STRUM_GLYPH[st.s]}</button>`).join('')}</div>`).join('');
    dlg.querySelector('#rPreview').innerHTML = strumSvg(bars, dlg.querySelector('#rMeter').value);
  };
  const resize = dlg => {
    const slots = +dlg.querySelector('#rSlots').value, count = +dlg.querySelector('#rBars').value;
    bars = Array.from({ length: count }, (_, bi) =>
      Array.from({ length: slots }, (_, i) => bars[bi]?.[i] || bars[0]?.[i] || { s: '-', acc: false }));
    draw(dlg);
  };
  const loadLib = (dlg, r) => {
    bars = parseStrumPattern(r.patron);
    dlg.querySelector('#rName').value = r.nombre;
    const meter = dlg.querySelector('#rMeter');
    if (!meters.includes(r.compas)) meter.insertAdjacentHTML('beforeend', `<option>${escapeHtml(r.compas)}</option>`);
    meter.value = r.compas;
    const slots = dlg.querySelector('#rSlots');
    if (![...slots.options].some(o => +o.value === bars[0].length)) slots.insertAdjacentHTML('beforeend', `<option>${bars[0].length}</option>`);
    slots.value = bars[0].length;
    dlg.querySelector('#rBars').value = Math.min(4, bars.length);
    draw(dlg);
  };
  const marker = dlg => strumMarker(dlg.querySelector('#rName').value, dlg.querySelector('#rMeter').value, bars);

  const res = await showModal({
    title: 'Insertar rasgueo',
    wide: true,
    body: `
      <label class="field"><span>Ritmo de la biblioteca</span>
        <select id="rLib">${lib.map((r, i) => `<option value="${i}">${escapeHtml(strumTitle(r))}</option>`).join('')}</select></label>
      <div class="strum-fields">
        <label class="field"><span>Nombre</span><input type="text" id="rName"></label>
        <label class="field"><span>Compás</span><select id="rMeter">${opts(meters, '4/4')}</select></label>
        <label class="field"><span>Casillas por compás</span><select id="rSlots">${opts([4, 6, 8, 12, 16], 8)}</select></label>
        <label class="field"><span>Compases</span><select id="rBars">${opts([1, 2, 3, 4], 1)}</select></label>
      </div>
      <div id="rGrid" class="strum-grid"></div>
      <div id="rPreview" class="strum-preview"></div>
      <p class="hint">Clic en una casilla para cambiar el golpe: ↓ abajo, ↑ arriba, gris = suave, ✕ apagado o chasquido, · silencio.
        Clic derecho (o Mayús+clic): acento. Se inserta en la línea del cursor como <code>[Rasgueo: …]</code>.</p>`,
    onOpen: dlg => {
      loadLib(dlg, lib[0]);
      dlg.querySelector('#rLib').onchange = e => loadLib(dlg, lib[+e.target.value]);
      dlg.querySelector('#rSlots').onchange = () => resize(dlg);
      dlg.querySelector('#rBars').onchange = () => resize(dlg);
      dlg.querySelector('#rMeter').onchange = () => draw(dlg);
      const grid = dlg.querySelector('#rGrid');
      const cell = e => { const b = e.target.closest('.strum-cell'); return b && bars[+b.dataset.b][+b.dataset.i]; };
      grid.addEventListener('click', e => {
        const st = cell(e);
        if (!st) return;
        if (e.shiftKey) st.acc = !st.acc;
        else st.s = STRUM_CYCLE[(STRUM_CYCLE.indexOf(st.s) + 1) % STRUM_CYCLE.length];
        draw(dlg);
      });
      grid.addEventListener('contextmenu', e => {
        const st = cell(e);
        if (!st) return;
        e.preventDefault();
        st.acc = !st.acc;
        draw(dlg);
      });
    },
    buttons: [
      { label: 'Cancelar' },
      { label: 'Guardar en mi biblioteca', onClick: dlg => {
        const nombre = dlg.querySelector('#rName').value.trim();
        if (!nombre) return modalFail(dlg, 'Ponle un nombre al rasgueo.');
        const list = customStrums().filter(r => slugify(r.nombre) !== slugify(nombre));
        list.unshift({ nombre, compas: dlg.querySelector('#rMeter').value, patron: serializeStrum(bars) });
        try { localStorage.setItem(STRUM_KEY, JSON.stringify(list)); } catch (_) {}
        toast(`"${nombre}" quedó en tu biblioteca de rasgueos`);
        return false;
      } },
      { label: 'Insertar en la canción', primary: true, onClick: dlg => marker(dlg) }
    ]
  });
  if (!res) return;
  ensureEditMode();
  const v = editor.value, ls = v.lastIndexOf('\n', editor.selectionStart - 1) + 1;
  replaceRange(ls, ls, res + '\n');
  toast('Rasgueo insertado');
}
