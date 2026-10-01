'use strict';
// Panel lateral de acordes: instrumento, afinación y cejilla; un diagrama por cada acorde de la
// canción (ya traspuesto) y sus rasgueos. Se redibuja en cada refresh().

const voicingChoice = new Map();
let highlightedChord = null;

function songChords(text) {
  const out = [], seen = new Set();
  for (const line of text.split('\n')) {
    if (!isChordLine(line)) continue;
    for (const tok of line.trim().split(/\s+/)) {
      const core = splitPunct(tok)[1];
      if (!core || !parseChord(core)) continue;
      const k = chordKey(core);
      if (!seen.has(k)) { seen.add(k); out.push(core); }
    }
  }
  return out;
}

const songInstruments = d => d.instruments?.length ? d.instruments : [{ ...DEFAULT_INSTRUMENT }];
function panelSelection(d) {
  const list = songInstruments(d);
  return list[Math.min(d.panelInst || 0, list.length - 1)];
}

// Textos con notas en latina ("Do# y La") en la notación elegida
const noteWords = s => String(s).replace(/\b(Do|Re|Mi|Fa|Sol|La|Si)(#|b)?(?![a-záéíóúñ])/g,
  (m, r, a) => renderNote(r, a || '', 0, null, isLatin()));

const shortTuning = t => {
  const s = tuningLabel(t).replace(/^Traspuesta:\s*/, '').replace(/\s*\(.*\)$/, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function capoMessage(t, key) {
  const s = suggestedCapo(t, key);
  if (s == null) return '';
  const target = keyName(key.idx, false);
  if (s === 0) return `${shortTuning(t)}: ya está en el tono de la canción (${target}).`;
  if (s <= 7) return `${shortTuning(t)}: pon la cejilla en el traste ${s} para tocar en ${target}.`;
  return `${shortTuning(t)}: para tocar en ${target} baja la afinación ${12 - s} semitono${12 - s > 1 ? 's' : ''} (o cejilla en el traste ${s}).`;
}

function chordCard(sel, inst, t, info, core, capo, label = '') {
  const kind = instrumentKind(inst);
  const key = chordKey(core);
  const spec = chordSpec(core);
  let body = '', foot = '';
  if (kind === 'trastes') {
    const vs = findVoicings(sel, core, capo);
    if (!vs.length) body = '<div class="chord-none">Sin postura</div>';
    else {
      const ck = `${sel.id}|${sel.tuning}|${key}|${capo}`;
      const i = (voicingChoice.get(ck) || 0) % vs.length;
      const v = vs[i];
      body = chordDiagramSvg(v, info);
      if (vs.length > 1) {
        foot += `<button type="button" class="v-nav" data-vkey="${escapeHtml(ck)}" data-step="-1" data-n="${vs.length}" title="Postura anterior">‹</button>`
          + `<span class="v-count">${i + 1}/${vs.length}</span>`
          + `<button type="button" class="v-nav" data-vkey="${escapeHtml(ck)}" data-step="1" data-n="${vs.length}" title="Otra postura">›</button>`;
      }
      const origin = v.origen === 'base' ? v.fuente.split(/[ ,]/)[0] : v.origen;
      foot += `<span class="chord-origin ${v.origen}" title="${escapeHtml(v.fuente || (v.origen === 'calculada' ? 'Calculada por Cancionero Universal' : ''))}">${escapeHtml(origin)}</span>`;
    }
  } else if (kind === 'arpa') {
    body = harpSvg(t, spec);
    const miss = harpMissing(t, spec);
    if (miss.length) foot = `<span class="chord-origin">falta ${miss.map(pc => spell(pc, keyPrefersFlats(t.tono, false), isLatin())).join(', ')}</span>`;
  } else {
    body = fretboardMapSvg(info, spec, { rows: kind === 'mapa' ? 5 : 7, frets: kind === 'mapa' });
  }
  return `<div class="chord-card${key === highlightedChord && !label ? ' hl' : ''}" data-key="${escapeHtml(key)}">
    <div class="chord-name">${label ? `<small>${escapeHtml(label)}</small> ` : ''}${escapeHtml(convertTokenNotation(core, isLatin()))}</div>
    ${body}<div class="chord-foot">${foot}</div></div>`;
}

function updateChromeHeight() {
  document.documentElement.style.setProperty('--chrome-h', $('.chrome').offsetHeight + 'px');
}

function renderPanel() {
  const panel = $('#sidePanel');
  document.body.classList.toggle('show-panel', !!state.showPanel);
  panel.hidden = !state.showPanel;
  if (!state.showPanel) return;
  updateChromeHeight();
  const d = cur(), key = detectedKey;
  const sel = panelSelection(d);
  const inst = findInstrument(sel.id), t = findTuning(inst, sel.tuning);
  const info = tuningInfo(inst, t), kind = instrumentKind(inst);
  const capo = capoFor(d, sel, key);
  const song = songInstruments(d);
  const others = allInstruments().filter(i => !song.some(s => s.id === i.id));

  let html = '<section class="panel-sec"><div class="panel-row">'
    + `<select id="pInst" title="Instrumento"><optgroup label="De esta canción">${song.map(s =>
      `<option value="${s.id}"${s === sel ? ' selected' : ''}>${escapeHtml(findInstrument(s.id).nombre)}</option>`).join('')}</optgroup>`
    + `<optgroup label="Agregar a la canción">${others.map(i => `<option value="${i.id}">${escapeHtml(i.nombre)}</option>`).join('')}</optgroup></select>`
    + '<button type="button" class="panel-link" data-action="instrumentDialog" title="Instrumentos de la canción e instrumentos propios">⚙</button></div>';
  if (inst.afinaciones.length > 1) {
    html += `<select id="pTuning" title="Afinación">${inst.afinaciones.map(a =>
      `<option value="${a.id}"${a === t ? ' selected' : ''}>${escapeHtml(tuningLabel(a))}</option>`).join('')}</select>`;
  }
  html += `<div class="panel-strings">${kind === 'arpa' ? 'Escala' : 'Cuerdas'}: <b>${escapeHtml(info.names.join(' '))}</b></div>`;
  if (kind === 'trastes') {
    const auto = t.propias && d.capos?.[sel.id] == null;
    html += `<div class="panel-capo">Cejilla: <button type="button" data-capo="-1" title="Bajar la cejilla">−</button>
      <b>${capo ? 'traste ' + capo : 'sin cejilla'}</b><button type="button" data-capo="1" title="Subir la cejilla">+</button>
      ${t.propias ? (auto ? '<span class="hint">(sugerida)</span>' : '<button type="button" class="panel-link" data-capo="auto">usar la sugerida</button>') : ''}</div>`;
  }
  if (t.diablitos) html += `<div class="hint">Diablitos al aire: ${escapeHtml(noteWords(t.diablitos))}</div>`;
  if (kind === 'sin-trastes') html += '<div class="hint">Sin trastes: notas del acorde en primera posición (rojo = fundamental).</div>';
  if (t.fuente) html += `<div class="hint">Fuente: ${escapeHtml(t.fuente)}</div>`;
  html += '</section>';

  if (t.propias && key) {
    html += `<section class="panel-sec"><div class="panel-sec-title">Tónica · Subdominante · Dominante</div>
      <p class="panel-tip">${escapeHtml(capoMessage(t, key))}</p><div class="chord-grid">`;
    for (const p of t.propias) {
      const pc = t.tono + GRADE_INTERVAL[p.grado] + capo;
      html += chordCard(sel, inst, t, info, spell(pc, keyPrefersFlats(mod12(t.tono + capo), false), true) + p.calidad, capo, p.grado);
    }
    html += '</div></section>';
  }

  const chords = songChords(d.text);
  html += '<section class="panel-sec"><div class="panel-sec-title">Acordes de la canción</div>';
  html += chords.length
    ? `<div class="chord-grid song-chords">${chords.map(c => chordCard(sel, inst, t, info, c, capo)).join('')}</div>`
    : '<p class="hint">La canción no tiene acordes.</p>';
  html += '</section>';

  const strums = songStrums(d.text);
  html += '<section class="panel-sec"><div class="panel-sec-title">Rasgueos</div>';
  html += strums.length
    ? strums.map(r => `<div class="panel-strum"><div class="strum-name">🎸 ${escapeHtml(strumTitle(r))}</div>${strumSvg(r.bars, r.compas)}</div>`).join('')
    : '<p class="hint">Sin rasgueos. Agrégalos con Insertar → Rasgueo…</p>';
  html += '</section>';
  $('#panelBody').innerHTML = html;
}

function togglePanel() {
  state.showPanel = !state.showPanel;
  renderPanel();
  scheduleSave();
}

function selectPanelInstrument(id) {
  const d = cur();
  d.instruments = d.instruments?.length ? d.instruments : [];
  let i = d.instruments.findIndex(s => s.id === id);
  if (i < 0) {
    d.instruments.push({ id, tuning: findInstrument(id).afinaciones[0].id });
    i = d.instruments.length - 1;
  }
  d.panelInst = i;
  refresh();
}

function setPanelTuning(tid) {
  const d = cur();
  if (!d.instruments?.length) d.instruments = [{ ...DEFAULT_INSTRUMENT }];
  d.instruments[Math.min(d.panelInst || 0, d.instruments.length - 1)].tuning = tid;
  refresh();
}

function changeCapo(step) {
  const d = cur(), sel = panelSelection(d);
  d.capos ||= {};
  if (step === 'auto') delete d.capos[sel.id];
  else d.capos[sel.id] = Math.max(0, Math.min(12, capoFor(d, sel, detectedKey) + +step));
  if (!d.instruments?.length) d.instruments = [{ ...sel }];
  refresh();
}

function highlightChord(key) {
  highlightedChord = key;
  const panel = $('#sidePanel');
  panel.querySelectorAll('.chord-card.hl').forEach(x => x.classList.remove('hl'));
  const card = [...panel.querySelectorAll('.song-chords .chord-card')].find(x => x.dataset.key === key);
  if (card) {
    card.classList.add('hl');
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

$('#sidePanel').addEventListener('change', e => {
  if (e.target.id === 'pInst') selectPanelInstrument(e.target.value);
  else if (e.target.id === 'pTuning') setPanelTuning(e.target.value);
});

$('#sidePanel').addEventListener('click', e => {
  const nav = e.target.closest('.v-nav');
  if (nav) {
    const k = nav.dataset.vkey, n = +nav.dataset.n;
    voicingChoice.set(k, ((voicingChoice.get(k) || 0) + +nav.dataset.step + n) % n);
    renderPanel();
    return;
  }
  const cb = e.target.closest('[data-capo]');
  if (cb) changeCapo(cb.dataset.capo);
});

// Tocar un acorde en el atril resalta su diagrama
$('#viewMode').addEventListener('click', e => {
  const c = e.target.closest('.chord[data-chord]');
  if (!c) return;
  if (!state.showPanel) { state.showPanel = true; renderPanel(); scheduleSave(); }
  highlightChord(chordKey(c.dataset.chord));
});

window.addEventListener('resize', () => { if (state.showPanel) updateChromeHeight(); });

// ============ Insertar > Instrumento… ============
async function instrumentDialog() {
  syncFromEditor();
  const d = cur();
  let list = songInstruments(d).map(s => ({ ...s }));
  const capos = { ...(d.capos || {}) };

  const drawList = dlg => {
    dlg.querySelector('#iList').innerHTML = list.map((s, i) => {
      const inst = findInstrument(s.id);
      const tunings = inst.afinaciones.length > 1
        ? `<select data-tuning="${i}">${inst.afinaciones.map(a => `<option value="${a.id}"${a.id === s.tuning ? ' selected' : ''}>${escapeHtml(tuningLabel(a))}</option>`).join('')}</select>`
        : `<span class="hint">${escapeHtml(tuningLabel(inst.afinaciones[0]))}</span>`;
      const capo = instrumentKind(inst) === 'trastes'
        ? `<label class="inst-capo">Cejilla <input type="number" min="0" max="12" data-capo-i="${i}" value="${capos[s.id] ?? ''}" placeholder="${findTuning(inst, s.tuning).propias ? 'auto' : '0'}"></label>` : '';
      return `<div class="inst-row"><b>${escapeHtml(inst.nombre)}</b>${tunings}${capo}
        <button type="button" class="btn" data-del="${i}" title="Quitar de la canción">Quitar</button></div>`;
    }).join('') || '<p class="hint">Sin instrumentos: el panel muestra guitarra estándar.</p>';
    dlg.querySelector('#iAdd').innerHTML = allInstruments().filter(i => !list.some(s => s.id === i.id))
      .map(i => `<option value="${i.id}">${escapeHtml(i.nombre)}</option>`).join('');
  };

  const res = await showModal({
    title: 'Instrumentos de la canción',
    wide: true,
    body: `
      <div id="iList" class="inst-list"></div>
      <div class="pick-row"><select id="iAdd"></select><button type="button" class="btn" id="iAddBtn">Agregar</button></div>
      <details class="advanced"><summary>Crear un instrumento o una afinación propia</summary>
        <label class="field"><span>Nombre</span><input type="text" id="cName" placeholder="Tres cubano"></label>
        <label class="field"><span>Cuerdas, de grave a aguda como se ven en el diagrama</span>
          <input type="text" id="cStrings" placeholder="Sol3 Sol4, Do4 Do4, Mi4 Mi4">
          <small>Nota y octava (Mi2, Fa#3, Sib3 o E2, F#3). Los órdenes dobles o triples, separados por comas.</small></label>
        <label class="field"><span>Trastes (0 = sin trastes, como el violín)</span><input type="number" id="cFrets" min="0" max="24" value="12"></label>
        <div class="pick-row">
          <button type="button" class="btn" id="cCopy">Partir de la afinación elegida arriba</button>
          <button type="button" class="btn primary" id="cCreate">Crear y agregar</button></div>
      </details>
      <p class="hint">Se guardan en la canción (.md). Los instrumentos propios quedan además en este navegador.</p>`,
    onOpen: dlg => {
      drawList(dlg);
      dlg.querySelector('#iList').addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.tuning) list[+t.dataset.tuning].tuning = t.value;
        if (t.dataset.capoI) {
          const id = list[+t.dataset.capoI].id;
          if (t.value === '') delete capos[id]; else capos[id] = Math.max(0, Math.min(12, +t.value));
        }
      });
      dlg.querySelector('#iList').addEventListener('click', e => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        list.splice(+b.dataset.del, 1);
        drawList(dlg);
      });
      dlg.querySelector('#iAddBtn').onclick = () => {
        const id = dlg.querySelector('#iAdd').value;
        if (!id) return;
        list.push({ id, tuning: findInstrument(id).afinaciones[0].id });
        drawList(dlg);
      };
      dlg.querySelector('#cCopy').onclick = () => {
        const s = list[0] || DEFAULT_INSTRUMENT;
        const inst = findInstrument(s.id), t = findTuning(inst, s.tuning);
        if (inst.arpa) return;
        dlg.querySelector('#cName').value = `${inst.nombre} (mi afinación)`;
        dlg.querySelector('#cStrings').value = t.cuerdas;
        dlg.querySelector('#cFrets').value = inst.trastes;
      };
      dlg.querySelector('#cCreate').onclick = () => {
        const def = {
          nombre: dlg.querySelector('#cName').value.trim(),
          cuerdas: dlg.querySelector('#cStrings').value.trim(),
          trastes: Math.max(0, Math.min(24, +dlg.querySelector('#cFrets').value || 0))
        };
        if (!def.nombre) { modalFail(dlg, 'Ponle un nombre al instrumento.'); return; }
        if (!parseCourses(def.cuerdas)) { modalFail(dlg, 'Escribe cada cuerda con nota y octava, por ejemplo: Mi2 La2 Re3 Sol3 Si3 Mi4'); return; }
        const id = registerCustomInstrument(def);
        list = list.filter(s => s.id !== id);
        list.push({ id, tuning: 'propia' });
        dlg.querySelector('.modal-error').textContent = '';
        drawList(dlg);
        toast(`"${def.nombre}" creado`);
      };
    },
    buttons: [{ label: 'Cancelar' }, { label: 'Aceptar', primary: true, value: true }]
  });
  if (!res) return;
  d.instruments = list;
  d.capos = Object.fromEntries(Object.entries(capos).filter(([id]) => list.some(s => s.id === id)));
  d.panelInst = 0;
  if (!state.showPanel) state.showPanel = true;
  refresh();
}
