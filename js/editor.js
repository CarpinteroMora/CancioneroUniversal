'use strict';
// Operaciones sobre el texto de la canción activa: transposición, formato, voces y portapapeles.

// ============ CAMBIOS DE TEXTO (con historial) ============
function setText(text, { keepSelection = false, selStart, selEnd } = {}) {
  histPush();
  const s = editor.selectionStart, e = editor.selectionEnd;
  editor.value = text;
  if (selStart != null) editor.setSelectionRange(selStart, selEnd ?? selStart);
  else if (keepSelection) editor.setSelectionRange(Math.min(s, text.length), Math.min(e, text.length));
  histPush();
  refresh();
}

function replaceRange(s, e, text, select = false) {
  histPush();
  editor.setRangeText(text, s, e, select ? 'select' : 'end');
  histPush();
  refresh();
}

function insertAtCursor(text) {
  ensureEditMode();
  replaceRange(editor.selectionStart, editor.selectionEnd, text.replace(/\r\n?/g, '\n'));
}

function ensureEditMode() {
  if (state.mode !== 'edit') setMode('edit');
  editor.focus({ preventScroll: true });
}

function selectedLines() {
  const v = editor.value;
  const s = editor.selectionStart;
  let e = editor.selectionEnd;
  if (e > s && v[e - 1] === '\n') e--;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', e);
  if (le < 0) le = v.length;
  return { ls, le };
}

// ============ TRANSPOSICIÓN ============
function transposeTo(target) {
  const key = detectKey(editor.value);
  if (!key) { toast('No se detectó ningún acorde para transponer'); return; }
  const semis = mod12(target - key.idx);
  if (!semis) return;
  const flats = keyPrefersFlats(target, key.minor);
  setText(transposeText(editor.value, semis, flats), { keepSelection: true });
  toast(`Transpuesto a ${keyLabel({ idx: target, minor: key.minor })}`, 1500);
}

// ============ FORMATO ============
function toggleWrap(open, close) {
  ensureEditMode();
  const v = editor.value;
  let s = editor.selectionStart, e = editor.selectionEnd;
  if (s === e) {
    while (s > 0 && !/\s/.test(v[s - 1])) s--;
    while (e < v.length && !/\s/.test(v[e])) e++;
    if (s === e) {
      replaceRange(s, e, open + close);
      editor.setSelectionRange(s + open.length, s + open.length);
      return;
    }
  }
  const sel = v.slice(s, e);
  if (v.slice(s - open.length, s) === open && v.slice(e, e + close.length) === close) {
    setText(v.slice(0, s - open.length) + sel + v.slice(e + close.length),
      { selStart: s - open.length, selEnd: e - open.length });
    return;
  }
  if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) {
    replaceRange(s, e, sel.slice(open.length, sel.length - close.length), true);
    return;
  }
  let skipped = false;
  const out = sel.split('\n').map(l => {
    if (!l.trim() || isSpecialLine(l)) return l;
    if (isChordLine(l)) { skipped = true; return l; }
    const m = l.match(/^(\s*)(.*?)(\s*)$/);
    return m[1] + open + m[2] + close + m[3];
  }).join('\n');
  if (out === sel) {
    if (skipped) toast('El formato no se aplica a las líneas de acordes');
    return;
  }
  replaceRange(s, e, out, true);
}

function clearFormat() {
  ensureEditMode();
  let s = editor.selectionStart, e = editor.selectionEnd;
  if (s === e) ({ ls: s, le: e } = selectedLines());
  const sel = editor.value.slice(s, e);
  const out = stripInlineMd(sel);
  if (out !== sel) replaceRange(s, e, out, true);
}

function toggleLinePrefix(prefix, re) {
  ensureEditMode();
  const { ls, le } = selectedLines();
  const lines = editor.value.slice(ls, le).split('\n');
  if (lines.length === 1 && !lines[0].trim()) {
    replaceRange(ls, le, prefix);
    return;
  }
  const filled = lines.filter(l => l.trim());
  const allHave = filled.length && filled.every(l => re.test(l));
  const out = lines.map(l => !l.trim() ? l : (allHave ? l.replace(re, '') : prefix + l)).join('\n');
  replaceRange(ls, le, out, true);
}

// ============ VOCES ============
function assignVoice(key) {
  ensureEditMode();
  const v = editor.value;
  let { ls, le } = selectedLines();
  // Incluir la línea de acordes que acompaña a la letra seleccionada
  const firstEnd = v.indexOf('\n', ls) < 0 ? v.length : v.indexOf('\n', ls);
  if (ls > 0 && !isChordLine(v.slice(ls, firstEnd))) {
    const prevStart = v.lastIndexOf('\n', ls - 2) + 1;
    if (isChordLine(v.slice(prevStart, ls - 1))) ls = prevStart;
  }
  const lastStart = v.lastIndexOf('\n', le - 1) + 1;
  if (le < v.length && isChordLine(v.slice(lastStart, le))) {
    let nextEnd = v.indexOf('\n', le + 1);
    if (nextEnd < 0) nextEnd = v.length;
    const next = v.slice(le + 1, nextEnd);
    if (next.trim() && !isChordLine(next) && !isSpecialLine(next)) le = nextEnd;
  }
  const before = v.slice(0, ls);
  const block = v.slice(ls, le);
  const after = v.slice(le);
  const restoreKey = activeVoiceAt(before + block);
  const blockLines = block.split('\n').filter(l => !parseVoiceMarker(l));
  if (!blockLines.length) { toast('Selecciona las líneas de letra que canta esa voz'); return; }
  const beforeLines = before ? before.slice(0, -1).split('\n') : [];
  const afterLines = after ? after.slice(1).split('\n') : [];
  const all = [...beforeLines, voiceMarker(key), ...blockLines, voiceMarker(restoreKey), ...afterLines];
  const first = beforeLines.length + 1;
  const last = first + blockLines.length - 1;
  const { out, map } = normalizeVoiceMarkers(all);
  const offset = n => out.slice(0, n).reduce((acc, l) => acc + l.length + 1, 0);
  setText(out.join('\n'), { selStart: offset(map[first]), selEnd: offset(map[last]) + out[map[last]].length });
  toast(key === 'unica' ? 'Líneas marcadas como voz única' : `Líneas asignadas a ${VOICES[key].label}`);
}

function setHighlight(key) {
  state.highlight = key;
  const d = cur();
  const match = d.audios.find(a => a.voice === key);
  if (match) { d.currentAudioId = match.id; updateAudioBar(); }
  refresh();
  toast(key === 'todas' ? 'Mostrando todas las voces' : `Resaltando ${VOICES[key].label}`, 1500);
}

// ============ PORTAPAPELES ============
async function pasteFromMenu(plain) {
  ensureEditMode();
  try {
    if (!plain && navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      let html = '', text = '';
      for (const it of items) {
        if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
        if (it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text();
      }
      insertAtCursor(clipboardToText(html, text, false));
      return;
    }
    insertAtCursor(await navigator.clipboard.readText());
  } catch (_) {
    toast('El navegador no permite pegar desde el menú. Usa Ctrl+V (o Ctrl+Shift+V sin formato).', 4500);
  }
}

async function writeClipboard(text, fallbackCmd) {
  try { await navigator.clipboard.writeText(text); }
  catch (_) { document.execCommand(fallbackCmd); }
}

async function copySelection(cut) {
  if (state.mode === 'edit') {
    editor.focus();
    const s = editor.selectionStart, e = editor.selectionEnd;
    if (s === e) { toast('Selecciona el texto que quieres ' + (cut ? 'cortar' : 'copiar')); return; }
    await writeClipboard(editor.value.slice(s, e), cut ? 'cut' : 'copy');
    if (cut) replaceRange(s, e, '');
    return;
  }
  if (cut) { toast('Pasa a Edición para cortar texto'); return; }
  const t = window.getSelection().toString();
  if (t) { await writeClipboard(t, 'copy'); toast('Copiado', 1200); }
  else { await writeClipboard(editor.value, 'copy'); toast('Canción completa copiada', 1500); }
}

function selectAll() {
  if (state.mode === 'edit') { editor.focus(); editor.select(); return; }
  const r = document.createRange();
  r.selectNodeContents($('#viewMode'));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// ============ EVENTOS DEL EDITOR ============
let plainPasteNext = false;

editor.addEventListener('input', () => { histSchedule(); scheduleRefresh(); autosize(); });

editor.addEventListener('beforeinput', e => {
  if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); }
  else if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); }
});

editor.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
    plainPasteNext = true;
    setTimeout(() => { plainPasteNext = false; }, 800);
  }
});

editor.addEventListener('paste', e => {
  const cd = e.clipboardData;
  if (!cd) return;
  e.preventDefault();
  const img = [...cd.files].find(f => /^image\//.test(f.type));
  if (img && !cd.getData('text/plain')) { addPastedImage(img, 'partitura'); return; }
  const text = clipboardToText(cd.getData('text/html'), cd.getData('text/plain'), plainPasteNext);
  plainPasteNext = false;
  replaceRange(editor.selectionStart, editor.selectionEnd, text.replace(/\r\n?/g, '\n'));
});
