'use strict';
// Partituras y tablaturas vinculadas a la canción (no se copian) y su vista en el atril.
// Imagen, PDF (pdf.js), MusicXML/.mxl, Guitar Pro 3–7 y alphaTex (alphaTab, que además las
// traspone junto con la canción). Solo una imagen pegada, que no tiene archivo, se guarda una
// vez en la carpeta de canciones como "Título - partitura 1.png".

const SHEET_FORMATS = {
  imagen: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
  pdf: ['pdf'],
  musicxml: ['musicxml', 'mxl', 'xml'],
  gp: ['gp', 'gp3', 'gp4', 'gp5', 'gpx', 'gp7'],
  alphatex: ['alphatex', 'atex'],
  mscz: ['mscz', 'mscx']
};
const TRANSPOSABLE = ['musicxml', 'gp', 'alphatex'];
const MSCZ_MSG = 'MuseScore no se puede mostrar directamente. En MuseScore usa Archivo > Exportar > MusicXML e inserta ese archivo.';
const SHEET_EXTS = Object.values(SHEET_FORMATS).flat().filter(e => !SHEET_FORMATS.mscz.includes(e));
const SHEET_ACCEPT = SHEET_EXTS.map(e => '.' + e).join(',') + ',image/*,application/pdf';
const SHEET_PICKER_TYPES = [{
  description: 'Partituras y tablaturas',
  accept: {
    'image/*': SHEET_FORMATS.imagen.map(e => '.' + e),
    'application/pdf': ['.pdf'],
    'application/octet-stream': [...SHEET_FORMATS.musicxml, ...SHEET_FORMATS.gp, ...SHEET_FORMATS.alphatex, ...SHEET_FORMATS.mscz].map(e => '.' + e)
  }
}];

function sheetFormat(name, mime = '') {
  const ext = (String(name).split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  for (const [f, exts] of Object.entries(SHEET_FORMATS)) if (exts.includes(ext)) return f;
  if (/^image\//.test(mime)) return 'imagen';
  if (mime === 'application/pdf') return 'pdf';
  return null;
}

const isSheetFile = f => !isMediaFile(f) && !!sheetFormat(f.name, f.type);

function urlPath(url) {
  try { return decodeURIComponent(new URL(url).pathname); } catch (_) { return ''; }
}
const isSheetUrl = url => !!sheetFormat(urlPath(url));
const sheetLabel = tipo => tipo === 'tablatura' ? 'Tablatura' : 'Partitura';

function normalizeSheet(h) {
  const src = h.src || '';
  const out = {
    id: h.id || uid(),
    tipo: h.tipo === 'tablatura' ? 'tablatura' : 'partitura',
    formato: h.formato || sheetFormat(src) || 'imagen',
    kind: h.kind || (isAbsoluteUrl(src) ? 'url' : 'local'),
    src,
    name: h.name || fileBase(src) || sheetLabel(h.tipo),
    tono: h.tono ?? null
  };
  if (h.objectUrl) out.objectUrl = h.objectUrl;
  if (h.blob) out.blob = h.blob;
  return out;
}

const storableSheet = ({ objectUrl, blob, ...rest }) => rest;

function revokeDocSheets(d) {
  for (const h of d.sheets || []) if (h.objectUrl) URL.revokeObjectURL(h.objectUrl);
}

// ============ AGREGAR HOJAS ============
async function askSheetType(formato, name) {
  if (formato === 'gp' || formato === 'alphatex') return 'tablatura';
  if (formato === 'musicxml') return 'partitura';
  return showModal({
    title: '¿Partitura o tablatura?',
    body: `<p><b>${escapeHtml(fileBase(name, true))}</b></p>`,
    buttons: [{ label: 'Cancelar' }, { label: '🎸 Tablatura', value: 'tablatura' }, { label: '🎼 Partitura', primary: true, value: 'partitura' }]
  });
}

function pushSheet(d, data) {
  const key = detectKey(d.text);
  const h = normalizeSheet({ ...data, tono: key ? key.idx : null });
  d.sheets.push(h);
  d.view = h.tipo;
  (d.sheetSel ||= {})[h.tipo] = h.id;
  if (d === cur()) {
    if (state.mode !== 'atril') setMode('atril');
    refresh();
  }
  scheduleSave();
  return h;
}

async function addSheetFromFile(file, handle = null, tipo = null, name = '') {
  const formato = sheetFormat(file.name, file.type);
  if (formato === 'mscz') { toast(MSCZ_MSG, 8000); return null; }
  if (!formato) { toast(`"${file.name}" no es una partitura que Cancionero Universal pueda mostrar`, 4000); return null; }
  tipo ||= await askSheetType(formato, file.name);
  if (!tipo) return null;
  const d = cur();
  const h = pushSheet(d, {
    tipo, formato, kind: 'local', src: file.name,
    name: name || fileBase(file.name), blob: file, objectUrl: URL.createObjectURL(file)
  });
  let note = '';
  if (handle) {
    rememberLinkHandle('hoja:' + h.id, handle);
    const dir = await savedSongsFolder();
    if (dir) h.src = await linkedPath('hoja:' + h.id, h.src, dir, (await docDirParts(d, dir)) || []);
    if (await outsideSongsFolder(handle)) note = ' (está fuera de la carpeta de canciones: en otro equipo habrá que volver a vincularla)';
  } else {
    note = '. Déjala junto al .md de la canción para que se encuentre al abrirla';
  }
  scheduleSave();
  toast(`${sheetLabel(tipo)} vinculada: ${h.name}${note}`, note ? 6000 : 2600);
  return h;
}

async function addSheetFromUrl(url, tipo = null, name = '') {
  const formato = sheetFormat(urlPath(url)) || 'imagen';
  if (formato === 'mscz') { toast(MSCZ_MSG, 8000); return null; }
  tipo ||= await askSheetType(formato, urlPath(url) || url);
  if (!tipo) return null;
  const h = pushSheet(cur(), { tipo, formato, kind: 'url', src: url, name: name || fileBase(urlPath(url)) || sheetLabel(tipo) });
  toast(`${sheetLabel(tipo)} vinculada desde internet`);
  return h;
}

// Imagen pegada o arrastrada desde otra app: no tiene archivo, se guarda una vez en la carpeta
async function addPastedImage(blob, tipo = 'partitura', name = '') {
  const d = cur();
  const ext = '.' + ((blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg'));
  const base = `${safeFileName(d.title.trim() || 'Sin título')} - ${tipo}`;
  let dir = canPickFiles ? (await songsDirWithPermission(true, 'readwrite')) : null;
  if (!dir && canPickFiles) {
    dir = await songsFolder();
    if (dir && !await hasPermission(dir)) dir = null;
  }
  let fileName = null;
  if (dir) {
    for (let i = 1; ; i++) {
      fileName = `${base} ${i}${ext}`;
      if (!await fileHandleAt(dir, [fileName])) break;
    }
    const fh = await dir.getFileHandle(fileName, { create: true });
    await writeText(fh, blob);
    const h = pushSheet(d, { tipo, formato: 'imagen', kind: 'local', src: fileName, name: name || fileBase(fileName), blob, objectUrl: URL.createObjectURL(blob) });
    rememberLinkHandle('hoja:' + h.id, fh);
    h.src = await linkedPath('hoja:' + h.id, fileName, dir, (await docDirParts(d, dir)) || []);
    scheduleSave();
    toast(`Imagen guardada como "${fileName}" en la carpeta de canciones`, 4000);
    return h;
  }
  fileName = `${base} 1${ext}`;
  const saved = await saveFile(blob, fileName, blob.type || 'image/png', ext, 'Imagen');
  if (!saved) return null;
  const h = pushSheet(d, { tipo, formato: 'imagen', kind: 'local', src: saved, name: name || fileBase(saved), blob, objectUrl: URL.createObjectURL(blob) });
  toast(`Imagen guardada como "${saved}". Déjala junto al .md de la canción`, 5000);
  return h;
}

// Tras recargar o abrir: vuelve a encontrar los archivos (por su handle o su ruta junto al .md)
async function relinkDocSheets(d, ask = false) {
  let missing = 0;
  for (const h of d.sheets || []) {
    if (h.kind !== 'local' || h.objectUrl) continue;
    const f = await findLinkedFile('hoja:' + h.id, h.src, d, ask);
    if (f) { h.blob = f; h.objectUrl = URL.createObjectURL(f); } else missing++;
  }
  return missing;
}

function currentSheet(d = cur()) {
  const view = atrilView(d);
  if (view === 'letra') return null;
  const list = d.sheets.filter(h => h.tipo === view);
  return list.find(x => x.id === d.sheetSel?.[view]) || list[0];
}

async function removeSheet() {
  const d = cur(), h = currentSheet(d);
  if (!h) return;
  if (!confirm(`¿Quitar "${h.name}" de esta canción? El archivo no se borra.`)) return;
  if (h.objectUrl) URL.revokeObjectURL(h.objectUrl);
  forgetLinkHandle('hoja:' + h.id);
  d.sheets.splice(d.sheets.indexOf(h), 1);
  refresh();
  toast(`${sheetLabel(h.tipo)} quitada`);
}

// ============ DIÁLOGO Insertar > Partitura / Tablatura ============
async function sheetInsertDialog(tipo) {
  let chosen = null;
  const res = await showModal({
    title: `Insertar ${tipo}`,
    body: `
      <div class="sheet-drop" id="sDrop">Suelta aquí el archivo o el enlace, o pega una imagen con Ctrl+V</div>
      <div class="field"><span>Archivo del equipo</span>
        <div class="pick-row"><button type="button" class="btn" id="sPick">Elegir archivo…</button>
        <span id="sChosen" class="hint">Ninguno</span></div>
        <input type="file" id="sFile" accept="${SHEET_ACCEPT}" hidden></div>
      <label class="field"><span>…o enlace (URL)</span><input type="url" id="sUrl" placeholder="https://…"></label>
      <label class="field"><span>Nombre</span><input type="text" id="sName"></label>
      <p class="hint">Imagen, PDF, MusicXML (.musicxml, .mxl), Guitar Pro (.gp3 a .gp) o alphaTex. El archivo no se copia:
        se recuerda dónde está. MusicXML y Guitar Pro se trasponen junto con la canción.
        De MuseScore: Archivo > Exportar > MusicXML.</p>`,
    onOpen: dlg => {
      const form = dlg.querySelector('form');
      const take = (c, label) => {
        if (c.file && sheetFormat(c.file.name, c.file.type) === 'mscz') { modalFail(dlg, MSCZ_MSG); return; }
        if (c.file && !sheetFormat(c.file.name, c.file.type)) { modalFail(dlg, 'Ese archivo no es una partitura que Cancionero Universal pueda mostrar.'); return; }
        chosen = c;
        dlg.querySelector('.modal-error').textContent = '';
        dlg.querySelector('#sChosen').textContent = label;
        const nm = dlg.querySelector('#sName');
        if (!nm.value && c.file) nm.value = fileBase(c.file.name);
      };
      dlg.querySelector('#sPick').onclick = async () => {
        if (canPickFiles) {
          try {
            const [handle] = await window.showOpenFilePicker({ startIn: (await savedSongsFolder()) || 'music', types: SHEET_PICKER_TYPES });
            take({ file: await handle.getFile(), handle }, handle.name);
            return;
          } catch (e) {
            if (e.name === 'AbortError') return;
          }
        }
        dlg.querySelector('#sFile').click();
      };
      dlg.querySelector('#sFile').onchange = e => { const f = e.target.files[0]; if (f) take({ file: f }, f.name); };
      const zone = dlg.querySelector('#sDrop');
      form.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); });
      form.addEventListener('dragleave', e => { if (!form.contains(e.relatedTarget)) zone.classList.remove('over'); });
      form.addEventListener('drop', async e => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('over');
        const item = [...(e.dataTransfer?.items || [])].find(i => i.kind === 'file');
        const pending = item?.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : null;
        const f = e.dataTransfer.files[0];
        if (f) {
          const handle = await pending;
          take({ file: f, handle: handle?.kind === 'file' ? handle : null }, f.name);
          return;
        }
        const url = e.dataTransfer.getData('text/uri-list').split('\n').find(l => /^https?:\/\//i.test(l.trim()));
        if (url) dlg.querySelector('#sUrl').value = url.trim();
      });
      form.addEventListener('paste', e => {
        const img = [...(e.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
        if (!img) return;
        e.preventDefault();
        take({ blob: img }, 'Imagen pegada');
      });
    },
    buttons: [
      { label: 'Cancelar' },
      { label: 'Insertar', primary: true, onClick: dlg => {
        const url = dlg.querySelector('#sUrl').value.trim();
        const name = dlg.querySelector('#sName').value.trim();
        if (chosen) return { ...chosen, name };
        if (url) return /^https?:\/\//i.test(url) ? { url, name } : modalFail(dlg, 'El enlace debe empezar por http:// o https://');
        return modalFail(dlg, 'Elige un archivo, suéltalo aquí, pega una imagen o escribe un enlace.');
      } }
    ]
  });
  if (!res) return;
  if (res.blob) await addPastedImage(res.blob, tipo, res.name);
  else if (res.file) await addSheetFromFile(res.file, res.handle, tipo, res.name);
  else await addSheetFromUrl(res.url, tipo, res.name);
}

// Pegar una imagen (Ctrl+V) en el atril la agrega como partitura
document.addEventListener('paste', e => {
  const t = e.target;
  if (t === editor || t.closest?.('dialog') || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
  const img = [...(e.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
  if (!img) return;
  e.preventDefault();
  addPastedImage(img, 'partitura');
});

// ============ VISTA DEL ATRIL ============
const atrilView = d => d.view && d.view !== 'letra' && d.sheets?.some(h => h.tipo === d.view) ? d.view : 'letra';

function setAtrilView(v) {
  const d = cur();
  if (v !== 'letra' && !d.sheets.some(h => h.tipo === v)) {
    toast(`Esta canción no tiene ${v}. Usa Insertar → ${sheetLabel(v)}…`, 3500);
    return;
  }
  d.view = v;
  if (state.mode !== 'atril') setMode('atril');
  refresh();
}

function updateViewSwitch(d) {
  const sw = $('#viewSwitch');
  sw.hidden = !d.sheets?.length;
  const v = atrilView(d);
  sw.querySelectorAll('button').forEach(b => {
    const t = b.dataset.action.slice(5);
    b.classList.toggle('on', t === v);
    b.disabled = t !== 'letra' && !d.sheets.some(h => h.tipo === t);
  });
}

const signedSemis = n => { n = mod12(n); return n > 6 ? n - 12 : n; };
const sheetSemis = (h, key) => h.tono != null && key ? signedSemis(key.idx - h.tono) : 0;

let sheetApi = null;
function destroySheetApi() {
  try { sheetApi?.destroy(); } catch (_) {}
  sheetApi = null;
}

function renderAtril(d, key) {
  const box = $('#viewMode');
  updateViewSwitch(d);
  const h = currentSheet(d);
  if (!h) {
    if (box.dataset.sig) destroySheetApi();
    delete box.dataset.sig;
    box.innerHTML = renderSong(d.title, d.text, key);
    return;
  }
  const list = d.sheets.filter(x => x.tipo === h.tipo);
  const semis = sheetSemis(h, key);
  const sig = [d.id, h.id, h.objectUrl || h.src, semis, state.notation, d.title, key?.idx, list.length].join('|');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  destroySheetApi();
  let html = renderHeader(d.title, key) + '<div class="sheet-bar">';
  html += list.length > 1
    ? `<select class="sheet-select" title="Elegir hoja">${list.map(x => `<option value="${x.id}"${x === h ? ' selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>`
    : `<span class="sheet-name">${h.tipo === 'tablatura' ? '🎸' : '🎼'} ${escapeHtml(h.name)}</span>`;
  html += '<button type="button" class="sheet-remove" data-action="removeSheet" title="Quitar esta hoja de la canción (no borra el archivo)">Quitar</button></div>';
  if (semis && !TRANSPOSABLE.includes(h.formato)) html += '<div class="sheet-note">Esta partitura es una imagen: no se traspone.</div>';
  else if (semis) html += `<div class="sheet-note ok">Traspuesta ${semis > 0 ? '+' : ''}${semis} semitonos para seguir el tono de la canción.</div>`;
  html += '<div class="sheet-host"></div>';
  box.innerHTML = html;
  drawSheet(h, box.querySelector('.sheet-host'), { semis, view: h.tipo, sig });
}

$('#viewMode').addEventListener('change', e => {
  if (!e.target.matches('.sheet-select')) return;
  const d = cur();
  (d.sheetSel ||= {})[atrilView(d)] = e.target.value;
  refresh();
});

function missingSheetHtml(h) {
  return `<div class="sheet-missing">No encuentro <b>${escapeHtml(h.src || h.name)}</b>.
    ${canPickFiles ? '<br><button type="button" class="relink-btn" data-action="relinkAudios">🔓 Activar archivos de la carpeta</button>'
      : '<br>Vuelve a vincularla con Insertar → Partitura…'}</div>`;
}

const hojaProxyUrl = url => `${extractorBase()}/api/hoja?url=${encodeURIComponent(url)}`;

async function sheetBytes(h) {
  if (h.blob) return new Uint8Array(await h.blob.arrayBuffer());
  if (h.objectUrl) return new Uint8Array(await (await fetch(h.objectUrl)).arrayBuffer());
  let r = null;
  try { r = await fetch(h.src); } catch (_) {}
  if (!r?.ok) {
    try {
      if (!extractorAllowed()) throw new Error('web');
      r = await fetch(hojaProxyUrl(h.src));
    } catch (_) {
      throw new Error('esa página no deja leer el archivo y el reproductor de Cancionero Universal no responde');
    }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'no se pudo descargar');
  }
  return new Uint8Array(await r.arrayBuffer());
}

async function drawSheet(h, host, opts) {
  const stale = () => $('#viewMode').dataset.sig !== opts.sig;
  const src = h.objectUrl || (h.kind === 'url' ? h.src : null);
  if (!src) { host.innerHTML = missingSheetHtml(h); return; }
  try {
    if (h.formato === 'imagen') {
      host.innerHTML = `<img class="sheet-img" alt="${escapeHtml(h.name)}" src="${escapeHtml(src)}">`;
      const img = host.querySelector('img');
      img.onerror = () => {
        if (h.kind === 'url' && !img.dataset.proxy && extractorAllowed()) { img.dataset.proxy = '1'; img.src = hojaProxyUrl(h.src); }
        else host.innerHTML = missingSheetHtml(h);
      };
    } else if (h.formato === 'pdf') {
      await drawPdf(h, host, stale);
    } else {
      await drawScore(h, host, opts, stale);
    }
  } catch (e) {
    if (!stale()) host.innerHTML = `<div class="sheet-missing">No se pudo mostrar "${escapeHtml(h.name)}": ${escapeHtml(e.message || String(e))}</div>`;
  }
}

// pdf.js: en file:// el navegador no deja crear el worker, así que se carga en la página
async function loadPdfJs() {
  if (!window.pdfjsLib) {
    if (location.protocol === 'file:') await loadScript('vendor/pdfjs/pdf.worker.min.js');
    await loadScript('vendor/pdfjs/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  }
  return window.pdfjsLib;
}

async function drawPdf(h, host, stale) {
  host.innerHTML = '<div class="sheet-loading">Cargando PDF…</div>';
  const [lib, data] = await Promise.all([loadPdfJs(), sheetBytes(h)]);
  const pdf = await lib.getDocument({ data }).promise;
  if (stale()) return;
  host.innerHTML = '';
  const width = Math.min(host.clientWidth || 730, 1100);
  const dpr = window.devicePixelRatio || 1;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    if (stale()) return;
    const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width * dpr });
    const c = el('canvas', 'sheet-page');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    c.style.width = width + 'px';
    host.appendChild(c);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }
}

async function drawScore(h, host, { semis, view }, stale) {
  host.innerHTML = '<div class="sheet-loading">Cargando partitura…</div>';
  const [, data] = await Promise.all([loadScript('vendor/alphatab/alphaTab.min.js'), sheetBytes(h)]);
  if (stale()) return;
  host.innerHTML = '';
  const box = el('div', 'sheet-score');
  host.appendChild(box);
  const profile = view === 'tablatura' ? (h.formato === 'musicxml' ? 'Default' : 'Tab') : 'Score';
  const api = new window.alphaTab.AlphaTabApi(box, {
    core: {
      useWorkers: false, engine: 'svg', enableLazyLoading: false,
      fontDirectory: new URL('vendor/alphatab/font/', location.href).href
    },
    display: { staveProfile: profile },
    notation: { transpositionPitches: Array(64).fill(semis) },
    player: { enablePlayer: false }
  });
  sheetApi = api;
  api.error.on(err => {
    if (!stale()) host.innerHTML = `<div class="sheet-missing">No se pudo leer "${escapeHtml(h.name)}": ${escapeHtml(err?.message || String(err))}</div>`;
  });
  if (h.formato === 'alphatex') api.tex(new TextDecoder().decode(data));
  else api.load(data);
}
