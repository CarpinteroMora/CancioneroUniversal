'use strict';
// Pestañas: cada una es una canción con su texto, audios, historial y estado de guardado.

let docs = [];
let activeId = null;

const cur = () => docs.find(d => d.id === activeId) || docs[0];

function makeDoc({ id, title = 'Sin título', text = '', audios = [], currentAudioId = null, clean = true, scrollSpeed = null,
  sheets = [], instruments = [], capos = {}, view = null, sheetSel = {}, panelInst = 0, tags = [] } = {}) {
  const d = {
    id: id || uid(),
    title, text,
    audios: uniqueAudios(audios).map(normalizeAudio),
    currentAudioId,
    scrollSpeed: scrollSpeed ? clampLevel(scrollSpeed) : null,
    sheets: (sheets || []).map(normalizeSheet),
    instruments: instruments || [],
    capos: capos || {},
    view, sheetSel: sheetSel || {}, panelInst: panelInst || 0,
    tags: uniqueTags(tags || []),
    hist: { stack: [{ text, s: 0, e: 0 }], idx: 0, timer: null },
    sel: [0, 0],
    scroll: 0,
    clean: ''
  };
  if (!d.audios.some(a => a.id === d.currentAudioId)) d.currentAudioId = d.audios[0]?.id ?? null;
  if (clean) d.clean = docSignature(d);
  return d;
}

const docSignature = d => [d.title, d.text, d.audios.map(a => a.src).join('|'), d.sheets.map(h => h.src).join('|'),
  instrumentsToMeta(d.instruments), caposToMeta(d.capos), tagsToMeta(d.tags)].join('\u0000');
const isDirty = d => docSignature(d) !== d.clean;
const isBlank = d => !d.text.trim() && !d.audios.length && !d.sheets.length;
const markClean = (d = cur()) => { d.clean = docSignature(d); };

// El editor contiene siempre el texto de la pestaña activa
function syncFromEditor() {
  const d = cur();
  if (!d) return;
  d.text = editor.value;
  d.title = titleEl.value;
  d.sel = [editor.selectionStart, editor.selectionEnd];
}

function activate(id) {
  activeId = id;
  const d = cur();
  editor.value = d.text;
  titleEl.value = d.title;
  try { editor.setSelectionRange(d.sel[0], d.sel[1]); } catch (_) {}
  updateAudioBar();
  refresh();
  window.scrollTo(0, d.scroll || 0);
}

function leaveCurrent() {
  const d = cur();
  if (!d) return;
  histPush();
  syncFromEditor();
  d.scroll = window.scrollY;
}

function switchTab(id) {
  if (id === activeId) return;
  leaveCurrent();
  activate(id);
}

// Abre una canción en una pestaña nueva (reutiliza la actual si está vacía)
function openInTab(data, reuse = true) {
  const c = cur();
  leaveCurrent();
  const d = makeDoc(data);
  if (reuse && c && isBlank(c)) docs.splice(docs.indexOf(c), 1, d);
  else docs.splice(c ? docs.indexOf(c) + 1 : docs.length, 0, d);
  activate(d.id);
  return d;
}

function newTab() {
  openInTab({ title: 'Sin título', text: '' }, false);
  setMode('edit');
  titleEl.select();
}

function closeTab(id = activeId) {
  const d = docs.find(x => x.id === id);
  if (!d) return;
  if (d.id === activeId) syncFromEditor();
  if (isDirty(d) && !isBlank(d) && !confirm(`"${d.title}" tiene cambios sin guardar. ¿Cerrar la pestaña?`)) return;
  const i = docs.indexOf(d);
  revokeDocAudios(d);
  revokeDocSheets(d);
  forgetFileHandle(d.id);
  docs.splice(i, 1);
  if (!docs.length) docs.push(makeDoc());
  if (d.id === activeId) activate(docs[Math.min(i, docs.length - 1)].id);
  else { renderTabs(); scheduleSave(); }
}

function cycleTab(delta) {
  const i = docs.indexOf(cur());
  switchTab(docs[(i + delta + docs.length) % docs.length].id);
}

function moveTab(fromId, toId) {
  const from = docs.findIndex(d => d.id === fromId);
  const to = docs.findIndex(d => d.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [d] = docs.splice(from, 1);
  docs.splice(to, 0, d);
  renderTabs();
  scheduleSave();
}

function renderTabs() {
  const bar = $('#tabs');
  bar.innerHTML = '';
  for (const d of docs) {
    const t = el('div', 'tab' + (d.id === activeId ? ' active' : ''));
    t.dataset.id = d.id;
    t.draggable = true;
    t.setAttribute('role', 'tab');
    t.title = d.title + (isDirty(d) ? ' (cambios sin guardar)' : '');
    if (d.audios.length) t.appendChild(el('span', 'tab-audio', '🔊'));
    t.appendChild(el('span', 'tab-title', d.title.trim() || 'Sin título'));
    if (isDirty(d) && !isBlank(d)) t.appendChild(el('span', 'tab-dirty', '●'));
    const x = el('button', 'tab-close', '×');
    x.type = 'button';
    x.title = 'Cerrar pestaña (Ctrl+Alt+W)';
    t.appendChild(x);
    bar.appendChild(t);
  }
  const add = el('button', 'tab-add', '+');
  add.type = 'button';
  add.title = 'Nueva pestaña (Ctrl+Alt+N)';
  add.dataset.action = 'new';
  bar.appendChild(add);
}

function bindTabs() {
  const bar = $('#tabs');
  let dragId = null;
  bar.addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    if (e.target.closest('.tab-close')) closeTab(t.dataset.id);
    else switchTab(t.dataset.id);
  });
  bar.addEventListener('auxclick', e => {
    const t = e.target.closest('.tab');
    if (t && e.button === 1) { e.preventDefault(); closeTab(t.dataset.id); }
  });
  bar.addEventListener('dblclick', e => { if (e.target === bar) newTab(); });
  bar.addEventListener('dragstart', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    dragId = t.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  bar.addEventListener('dragover', e => {
    const t = e.target.closest('.tab');
    if (!t || !dragId) return;
    e.preventDefault();
    bar.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    t.classList.add('drag-over');
  });
  bar.addEventListener('drop', e => {
    const t = e.target.closest('.tab');
    if (t && dragId) { e.preventDefault(); moveTab(dragId, t.dataset.id); }
    dragId = null;
  });
  bar.addEventListener('dragend', () => {
    dragId = null;
    bar.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
  });
}

// ============ HISTORIAL (deshacer / rehacer) por pestaña ============
function histPush() {
  const h = cur().hist;
  clearTimeout(h.timer);
  h.timer = null;
  const text = editor.value;
  if (h.stack[h.idx]?.text === text) return;
  h.stack.length = h.idx + 1;
  h.stack.push({ text, s: editor.selectionStart, e: editor.selectionEnd });
  if (h.stack.length > 300) h.stack.shift();
  h.idx = h.stack.length - 1;
}

function histSchedule() {
  const h = cur().hist;
  clearTimeout(h.timer);
  h.timer = setTimeout(histPush, 500);
}

function applySnapshot(snap) {
  editor.value = snap.text;
  try { editor.setSelectionRange(snap.s, snap.e); } catch (_) {}
  refresh();
}

function undo() {
  histPush();
  const h = cur().hist;
  if (h.idx <= 0) { toast('Nada que deshacer', 1200); return; }
  h.idx--;
  applySnapshot(h.stack[h.idx]);
}

function redo() {
  histPush();
  const h = cur().hist;
  if (h.idx >= h.stack.length - 1) { toast('Nada que rehacer', 1200); return; }
  h.idx++;
  applySnapshot(h.stack[h.idx]);
}

// ============ SESIÓN (guardado automático en el navegador) ============
const STORE_KEY = 'canciotras.v3';
const OLD_STORE_KEY = 'trasponedor.v2';
let saveTimer = null;

function saveNow() {
  clearTimeout(saveTimer);
  syncFromEditor();
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      activeId,
      state,
      docs: docs.map(d => ({
        id: d.id, title: d.title, text: d.text,
        audios: d.audios.map(({ objectUrl, retries, fallbackTried, viaOrigin, ...rest }) => rest),
        currentAudioId: d.currentAudioId,
        scrollSpeed: d.scrollSpeed,
        sheets: d.sheets.map(storableSheet),
        instruments: d.instruments, capos: d.capos, view: d.view, sheetSel: d.sheetSel, panelInst: d.panelInst,
        tags: d.tags,
        clean: !isDirty(d)
      }))
    }));
  } catch (_) {}
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

function loadSession() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) {}
  if (data?.docs?.length) {
    Object.assign(state, data.state || {});
    docs = data.docs.map(makeDoc);
    activeId = docs.some(d => d.id === data.activeId) ? data.activeId : docs[0].id;
    return true;
  }
  try { data = JSON.parse(localStorage.getItem(OLD_STORE_KEY)); } catch (_) {}
  if (data && typeof data.text === 'string') {
    const { showPreview, ...oldState } = data.state || {};
    Object.assign(state, oldState);
    docs = [makeDoc({ title: data.title || 'Sin título', text: data.text, audios: data.audios || [] })];
    activeId = docs[0].id;
    return true;
  }
  return false;
}

window.addEventListener('beforeunload', saveNow);
