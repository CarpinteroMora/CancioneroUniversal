'use strict';
// Archivo → Abrir colección: panel flotante con todo lo que hay en las carpetas que elige el usuario
// (su carpeta de canciones y otras: música, videos, carpetas sincronizadas con Drive, OneDrive o sus
// otros equipos…): canciones .md, audios y videos. Se filtran por tags y lo que se marca se abre en
// pestañas, para armar un cancionero (una misa, una presentación solo de cuecas o tonadas…).
// Tags: los .md los traen en su cabecera. Los audios y videos reúnen los de las canciones que los
// usan, el género que traiga el archivo (mp3) y los que se les ponen aquí, que quedan en
// «cancionero-etiquetas.json» dentro de su carpeta (así viajan con ella a los otros equipos).

const SONG_FILE_RE = /\.(md|markdown|txt|cho|crd|chopro|chordpro|pro)$/i;
const MEDIA_TAGS_FILE = 'cancionero-etiquetas.json';
const COLLECTION_SKIP_DIRS = new Set(['vendor', 'js', 'css', 'servidor', 'node_modules', 'cache']);
const COLLECTION_MAX_ROWS = 300;
const KIND_INFO = {
  song: { icon: '📄', label: 'Canciones' },
  audio: { icon: '🔊', label: 'Audios' },
  video: { icon: '🎬', label: 'Videos' }
};

// folders: [{ handle, songs (es la carpeta de canciones), ok (se pudo leer), tags: { ruta: [tags] } }]
// items: [{ kind, title, tags, path, parts, handle | file, folder, … }]
const coll = { folders: [], items: [], loaded: false, loading: false, terms: '', tags: new Set(), kind: '', showFolders: false };

const mediaKind = name => AUDIO_EXT.includes(mediaExt(name)) ? 'audio' : VIDEO_EXT.includes(mediaExt(name)) ? 'video' : null;
const byTitle = (a, b) => a.title.localeCompare(b.title, 'es');
const unescapeAttr = s => s.replace(/&(amp|quot|#39|lt|gt);/g, (_, e) => ({ amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>' })[e]);

// ============ CARPETAS ============
async function sameEntry(a, b) {
  try { return await a.isSameEntry(b); } catch (_) { return false; }
}

async function folderIndex(handle) {
  for (const [i, f] of coll.folders.entries()) if (await sameEntry(f.handle, handle)) return i;
  return -1;
}

// La carpeta de canciones va primero; las demás se recuerdan en IndexedDB
async function collectionFolders() {
  const songsDir = await savedSongsFolder();
  const list = songsDir ? [{ handle: songsDir, songs: true }] : [];
  for (const h of (await handleGet('colecciones')) || []) {
    let dup = false;
    for (const f of list) if (await sameEntry(f.handle, h)) dup = true;
    if (!dup) list.push({ handle: h, songs: false });
  }
  return list;
}

const saveExtraFolders = () => handleSet('colecciones', coll.folders.filter(f => !f.songs).map(f => f.handle));

async function addCollectionFolder(handle) {
  if (await folderIndex(handle) >= 0) { toast(`«${handle.name}» ya está en la colección`); return; }
  const first = !coll.folders.some(f => f.songs);
  if (first) {
    await handleSet('carpeta', handle);
    toast(`Las canciones nuevas se guardarán en «${handle.name}»`, 3500);
  }
  coll.folders.push({ handle, songs: first });
  await saveExtraFolders();
  await loadCollection(false);
}

async function pickCollectionFolder() {
  let dir;
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite', startIn: (await savedSongsFolder()) || 'music' });
  } catch (e) {
    if (e.name !== 'AbortError') toast('No se pudo usar esa carpeta');
    return;
  }
  await addCollectionFolder(dir);
}

// Desde ahora las canciones nuevas (y los cancioneros) se guardan en esa carpeta
async function makeSongsFolder(i) {
  const f = coll.folders[i];
  await handleSet('carpeta', f.handle);
  coll.folders.forEach(x => { x.songs = x === f; });
  coll.folders.sort((a, b) => b.songs - a.songs);
  await saveExtraFolders();
  toast(`Las canciones nuevas se guardarán en «${f.handle.name}»`, 3500);
  renderCollection();
}

async function removeCollectionFolder(i) {
  const f = coll.folders[i];
  if (!f || f.songs) return;
  coll.folders.splice(i, 1);
  coll.items = coll.items.filter(it => it.folder !== f);
  await saveExtraFolders();
  renderCollection();
}

// ============ LEER LAS CARPETAS ============
async function readMediaTags(dir) {
  try {
    const data = JSON.parse(await (await (await dir.getFileHandle(MEDIA_TAGS_FILE)).getFile()).text());
    return data?.archivos && typeof data.archivos === 'object' ? data.archivos : {};
  } catch (_) {
    return {};
  }
}

async function writeMediaTags(folder) {
  if (!await hasPermission(folder.handle)) throw new Error(`no hay permiso para escribir en «${folder.handle.name}»`);
  const archivos = Object.fromEntries(Object.entries(folder.tags).filter(([, t]) => t.length).sort(([a], [b]) => a.localeCompare(b)));
  const fh = await folder.handle.getFileHandle(MEDIA_TAGS_FILE, { create: true });
  await writeText(fh, JSON.stringify({ formato: 'etiquetas', version: 1, archivos }, null, 2) + '\n');
}

async function scanCollectionDir(dir, parts, out, depth) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') {
      if (depth < 6 && !COLLECTION_SKIP_DIRS.has(name.toLowerCase())) await scanCollectionDir(h, [...parts, name], out, depth + 1);
      continue;
    }
    const kind = /\.(md|markdown)$/i.test(name) ? 'song' : isRecordingSrc([...parts, name].join('/')) ? 'audio' : mediaKind(name);
    if (!kind) continue;
    try { out.push(await collectionItem(await h.getFile(), kind, h, [...parts, name])); } catch (_) {}
  }
}

async function collectionItem(file, kind, handle = null, parts = [file.name]) {
  const it = { kind, handle, file: handle ? null : file, path: parts.join('/'), parts, tags: [], fileTags: [], ownTags: [] };
  if (kind === 'song') {
    const text = await file.text();
    Object.assign(it, songHeadText(text, file.name));
    // Audios y videos de la canción: los locales se enlazan con los archivos de la carpeta
    it.audioSrcs = [];
    it.hasAudio = false;
    for (const m of text.matchAll(/<(?:audio|video)\b[^>]*?\bsrc="([^"]+)"/gi)) {
      it.hasAudio = true;
      const src = unescapeAttr(m[1]);
      if (!isAbsoluteUrl(src)) it.audioSrcs.push(src);
    }
  } else {
    const info = await mp3Tags(file).catch(() => null);
    it.title = info?.title || fileBase(file.name);
    it.fileTags = info?.genres || [];
    it.tags = it.fileTags;
  }
  return it;
}

// Une canciones con sus audios y junta los tags de cada audio o video
function linkCollection(found, sidecar) {
  const media = new Map(found.filter(it => it.kind !== 'song').map(it => [it.path, it]));
  for (const it of found) {
    if (it.kind !== 'song') continue;
    for (const src of it.audioSrcs) {
      const p = joinPath(it.parts.slice(0, -1), src);
      const m = p && media.get(p.join('/'));
      if (m && !(m.songs ||= []).includes(it)) m.songs.push(it);
    }
  }
  for (const m of media.values()) {
    m.ownTags = sidecar[m.path] || [];
    mediaTagsUpdate(m);
  }
}

const mediaTagsUpdate = m => { m.tags = uniqueTags([...m.ownTags, ...m.fileTags, ...(m.songs || []).flatMap(s => s.tags)]); };

async function loadCollection(ask) {
  coll.folders = await collectionFolders();
  coll.loading = true;
  renderCollection();
  const items = coll.items.filter(it => !it.folder);
  for (const f of coll.folders) {
    f.ok = await permissionOk(f.handle, ask, 'read');
    if (!f.ok) continue;
    f.tags = await readMediaTags(f.handle);
    const found = [];
    try { await scanCollectionDir(f.handle, [], found, 0); } catch (_) { f.ok = false; continue; }
    found.forEach(it => { it.folder = f; });
    linkCollection(found, f.tags);
    items.push(...found);
  }
  // Lo que ya estaba abierto sigue marcado
  for (const it of items) {
    it.docId ??= coll.items.find(o => o.folder?.handle.name === it.folder?.handle.name && o.path === it.path)?.docId || null;
  }
  coll.items = items.sort(byTitle);
  coll.loading = false;
  coll.loaded = true;
  renderCollection();
}

// Archivos sueltos (sin carpetas: celular, Firefox, o arrastrados al panel)
async function addCollectionFiles(entries) {
  for (const { file, handle = null } of entries) {
    const kind = SONG_FILE_RE.test(file.name) ? 'song'
      : mediaKind(file.name) || (isMediaFile(file) ? (file.type.startsWith('video/') ? 'video' : 'audio') : null);
    if (!kind) continue;
    if (coll.items.some(it => !it.folder && (it.handle || it.file).name === file.name)) continue;
    const it = await collectionItem(file, kind, handle);
    if (kind !== 'song') mediaTagsUpdate(it);
    coll.items.push(it);
  }
  coll.items.sort(byTitle);
  renderCollection();
}

// ============ TAGS DE UN MP3 (ID3v2: título y género) ============
async function mp3Tags(file) {
  if (mediaExt(file.name) !== 'mp3') return null;
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33 || head[3] < 3) return null;
  const ver = head[3];
  const syncsafe = (b, i) => (b[i] & 0x7f) << 21 | (b[i + 1] & 0x7f) << 14 | (b[i + 2] & 0x7f) << 7 | (b[i + 3] & 0x7f);
  const u32 = (b, i) => (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
  const size = syncsafe(head, 6);
  const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 512 * 1024)).arrayBuffer());
  const text = b => {
    const enc = b[0], body = b.subarray(1);
    const label = enc === 0 ? 'latin1' : enc === 3 ? 'utf-8' : enc === 2 ? 'utf-16be'
      : body[0] === 0xfe && body[1] === 0xff ? 'utf-16be' : 'utf-16le';
    return new TextDecoder(label).decode(body).replace(/^\ufeff/, '').replace(/\0+$/, '').split('\0')[0].trim();
  };
  const frames = {};
  let i = head[5] & 0x40 ? (ver === 4 ? syncsafe(buf, 0) : u32(buf, 0) + 4) : 0;
  while (i + 10 <= buf.length) {
    const id = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4 ? syncsafe(buf, i + 4) : u32(buf, i + 4);
    if (!len || i + 10 + len > buf.length) break;
    if (id === 'TIT2' || id === 'TCON') frames[id] = text(buf.subarray(i + 10, i + 10 + len));
    i += 10 + len;
  }
  // El género puede venir como «Cueca», «(17)», «17» o varios separados por / ; ,
  const genres = (frames.TCON || '').replace(/\(\d+\)/g, ' ').split(/[\/;,\0]+/).map(s => s.trim())
    .filter(s => s && !/^\d+$/.test(s)).map(canonicalTag);
  return { title: frames.TIT2 || '', genres: uniqueTags(genres) };
}

// ============ PANEL ============
const collPanel = el('aside', 'book-picker');
collPanel.id = 'collectionPanel';
collPanel.hidden = true;
collPanel.setAttribute('aria-label', 'Colección');
collPanel.innerHTML = `
  <div class="bp-head">
    <div><b>📚 Colección</b><div class="bp-name hint"></div></div>
    <button type="button" class="panel-close" data-cl="close" aria-label="Cerrar">×</button>
  </div>
  <div class="bp-source"></div>
  <div class="tag-cloud cl-kinds"></div>
  <input type="text" class="tag-search bp-search" placeholder="Buscar por título o tag (varios: separados por coma)" autocomplete="off">
  <div class="tag-cloud bp-tags"></div>
  <div class="bp-list"></div>
  <div class="bp-drop">Suelta aquí canciones, audios, videos o carpetas enteras</div>
  <div class="bp-foot">
    <span class="bp-count"></span>
    <button type="button" class="btn" data-cl="save">Guardar cancionero</button>
    <button type="button" class="btn primary" data-cl="close">Listo</button>
  </div>
  <input type="file" class="bp-files" multiple accept=".md,.markdown,.txt,.cho,.crd,.chopro,.chordpro,.pro,text/markdown,text/plain,${MEDIA_ACCEPT}" hidden>`;
document.body.appendChild(collPanel);

const cq = s => collPanel.querySelector(s);

// Abierto = su pestaña sigue abierta (o hay una con el mismo título, o con ese audio y sin letra)
function collectionDoc(it) {
  const byId = docs.find(d => d.id === it.docId);
  if (byId) return byId;
  if (it.kind === 'song') return docs.find(d => !isBlank(d) && tagNorm(d.title) === tagNorm(it.title)) || null;
  const name = (it.handle || it.file).name;
  return docs.find(d => !d.text.trim() && d.audios.some(a => a.kind === 'local' && fileBase(a.src, true) === name)) || null;
}

function renderCollectionSource() {
  const box = cq('.bp-source');
  if (coll.loading) { box.innerHTML = '<span class="install-spin"></span> Leyendo las carpetas…'; return; }
  const filesBtn = '<button type="button" class="btn small" data-cl="files">Elegir archivos…</button>';
  if (!canPickFiles) {
    box.innerHTML = `${filesBtn} <span class="hint">Canciones (.md), audios o videos guardados en tu dispositivo.</span>`;
    return;
  }
  const count = f => coll.items.filter(it => it.folder === f).length;
  const locked = coll.folders.filter(f => f.ok === false).length;
  const rows = coll.folders.map((f, i) => `<div class="cl-folder${f.ok === false ? ' locked' : ''}">
      <span class="cl-folder-name" title="${f.songs ? 'Aquí se guardan las canciones nuevas y los cancioneros' : ''}">${f.songs ? '⭐' : '📁'} ${escapeHtml(f.handle.name)}</span>
      <small>${f.ok === false ? 'sin permiso' : f.ok ? `${count(f)} archivos` : ''}</small>
      ${f.songs ? '<small class="cl-main">aquí se guarda</small>' : `<button type="button" class="linkish" data-cl="main" data-f="${i}" title="Guardar aquí las canciones nuevas y los cancioneros">guardar aquí</button>
      <button type="button" class="cl-remove" data-cl="remove" data-f="${i}" title="Quitar de la colección (no borra nada)">×</button>`}</div>`).join('');
  box.innerHTML = `<details class="cl-folders"${coll.showFolders || !coll.folders.length ? ' open' : ''}>
      <summary>📁 Carpetas de la colección (${coll.folders.length})</summary>
      ${rows || `<p class="hint">Añade las carpetas donde tienes canciones, audios y videos: también las que se
        sincronizan con Drive, OneDrive o tus otros equipos.</p>`}
      <div class="cl-actions"><button type="button" class="btn small primary" data-cl="add">＋ Añadir carpeta…</button>
        ${coll.folders.length ? '<button type="button" class="btn small" data-cl="reload">Volver a leer</button>' : ''}
        ${filesBtn}</div>
    </details>
    ${locked ? `<button type="button" class="btn small primary" data-cl="reload">🔓 Permitir leer ${locked === 1 ? 'la carpeta' : `${locked} carpetas`}</button>` : ''}`;
  box.querySelector('details').addEventListener('toggle', e => { coll.showFolders = e.target.open; });
}

function itemRow(it) {
  const i = coll.items.indexOf(it);
  const info = KIND_INFO[it.kind];
  const where = [it.folder ? it.folder.handle.name : '', it.path].filter(Boolean).join('/');
  const used = it.songs?.length ? ` · en «${it.songs.map(s => s.title).join('», «')}»` : '';
  const tagBtn = it.kind !== 'song' && it.folder ? `<button type="button" class="cl-tag-btn" data-mt="${i}" title="Poner tags">🏷️</button>` : '';
  return `<label class="bp-row"><input type="checkbox" data-i="${i}"${collectionDoc(it) ? ' checked' : ''}>
    <span class="bp-title"><b>${info.icon} ${escapeHtml(it.title)}${it.hasAudio ? ' <span title="Tiene audio o video">🔊</span>' : ''}</b>
      <small>${escapeHtml(where + used)}</small></span>
    <span class="bp-chips">${it.tags.map(t => tagChip(t)).join('')}${tagBtn}</span></label>`;
}

function renderCollection() {
  if (collPanel.hidden) return;
  cq('.bp-name').textContent = state.cancioneroName ? `Para el cancionero «${state.cancioneroName}»` : '';
  renderCollectionSource();
  const kinds = [['', 'Todo', coll.items.length],
    ...Object.entries(KIND_INFO).map(([k, v]) => [k, `${v.icon} ${v.label}`, coll.items.filter(it => it.kind === k).length])];
  cq('.cl-kinds').innerHTML = kinds.map(([k, label, n]) =>
    `<button type="button" class="tag-opt${coll.kind === k ? ' on' : ''}" data-kind="${k}">${label} <small>${n}</small></button>`).join('');

  const pool = coll.kind ? coll.items.filter(it => it.kind === coll.kind) : coll.items;
  const counts = new Map();
  for (const it of pool) for (const t of it.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const cloud = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  cq('.bp-tags').innerHTML = cloud.map(([t, n]) =>
    `<button type="button" class="tag-opt${coll.tags.has(t) ? ' on' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)} <small>${n}</small></button>`).join('');

  const terms = coll.terms.split(',').map(tagNorm).filter(Boolean);
  const wanted = [...coll.tags].map(tagNorm);
  const shown = pool.filter(it => {
    const tags = it.tags.map(tagNorm);
    return wanted.every(t => tags.includes(t)) &&
      terms.every(q => tagNorm(it.title).includes(q) || tags.some(t => t.includes(q)));
  });
  const empty = coll.items.length ? 'Nada coincide con el filtro.'
    : canPickFiles ? 'Añade una carpeta para ver sus canciones, audios y videos.' : 'Elige archivos para empezar.';
  cq('.bp-list').innerHTML = shown.length
    ? shown.slice(0, COLLECTION_MAX_ROWS).map(itemRow).join('') +
      (shown.length > COLLECTION_MAX_ROWS ? `<p class="hint bp-empty">Se muestran ${COLLECTION_MAX_ROWS} de ${shown.length}: filtra por tags o busca para ver el resto.</p>` : '')
    : `<p class="hint bp-empty">${coll.loading ? '' : empty}</p>`;
  const n = docs.filter(d => !isBlank(d)).length;
  cq('.bp-count').textContent = `${n} ${n === 1 ? 'elegida' : 'elegidas'} para el cancionero`;
}

async function openCollection() {
  updateChromeHeight();
  collPanel.hidden = false;
  document.body.classList.add('picker-open');
  renderCollection();
  if (canPickFiles && !coll.loaded && !coll.loading) await loadCollection(true);
}

function closeCollection() {
  collPanel.hidden = true;
  document.body.classList.remove('picker-open');
}

async function toggleCollectionItem(it, on) {
  if (on) {
    if (collectionDoc(it)) return;
    const file = it.handle ? await it.handle.getFile() : it.file;
    if (it.kind === 'song') {
      await openFiles([{ file, handle: it.handle }]);
    } else {
      openInTab({ title: it.title, text: '', tags: it.tags });
      await attachLocalFile(file, { handle: it.handle, name: it.title });
    }
    it.docId = cur().id;
  } else {
    const d = collectionDoc(it);
    if (d) closeTab(d.id);
    it.docId = null;
  }
  renderCollection();
}

async function editMediaTags(it) {
  const known = [...new Set([...coll.items.flatMap(x => x.tags), ...[...TAG_INDEX.values()].map(e => e.tag)])].sort((a, b) => a.localeCompare(b, 'es'));
  const inherited = uniqueTags([...it.fileTags, ...(it.songs || []).flatMap(s => s.tags)]);
  const res = await showModal({
    title: `🏷️ Tags de ${KIND_INFO[it.kind].icon} ${escapeHtml(it.title)}`,
    body: `<label class="field"><span>Tags (separados por coma)</span>
        <input type="text" id="mtTags" list="mtList" value="${escapeHtml(it.ownTags.join(', '))}" placeholder="Por ejemplo: Cueca, Fiestas Patrias, Instrumental" autocomplete="off"></label>
      <datalist id="mtList">${known.map(t => `<option value="${escapeHtml(t)}">`).join('')}</datalist>
      ${inherited.length ? `<p class="hint">Además tiene ${inherited.map(t => tagChip(t)).join(' ')} (del archivo o de la canción que lo usa).</p>` : ''}
      <p class="hint">Se guardan en «${MEDIA_TAGS_FILE}», dentro de la carpeta «${escapeHtml(it.folder.handle.name)}»:
        así viajan con ella a tus otros equipos.</p>`,
    onOpen: d => d.querySelector('#mtTags').focus(),
    buttons: [
      { label: 'Cancelar' },
      { label: 'Guardar', primary: true, onClick: d => ({ tags: metaToTags(d.querySelector('#mtTags').value) }) }
    ]
  });
  if (!res) return;
  const prev = it.folder.tags[it.path];
  it.folder.tags[it.path] = res.tags;
  try {
    await writeMediaTags(it.folder);
  } catch (e) {
    it.folder.tags[it.path] = prev;
    toast('No se pudieron guardar los tags: ' + e.message, 5000);
    return;
  }
  it.ownTags = res.tags;
  mediaTagsUpdate(it);
  const d = collectionDoc(it);
  if (d && !d.text.trim()) { d.tags = uniqueTags([...d.tags, ...it.tags]); refresh(); }
  renderCollection();
  toast(it.ownTags.length ? `Tags: ${it.ownTags.join(', ')}` : 'Sin tags propios', 2500);
}

collPanel.addEventListener('click', async e => {
  const mt = e.target.closest('[data-mt]');
  if (mt) { e.preventDefault(); editMediaTags(coll.items[+mt.dataset.mt]); return; }
  const tag = e.target.closest('[data-tag]');
  if (tag) {
    const t = tag.dataset.tag;
    if (coll.tags.has(t)) coll.tags.delete(t); else coll.tags.add(t);
    renderCollection();
    return;
  }
  const kind = e.target.closest('[data-kind]');
  if (kind) { coll.kind = kind.dataset.kind; renderCollection(); return; }
  const b = e.target.closest('[data-cl]');
  if (!b) return;
  const act = b.dataset.cl, i = +b.dataset.f;
  if (act === 'close') closeCollection();
  else if (act === 'save') saveCancioneroDialog().then(renderCollection);
  else if (act === 'add') pickCollectionFolder();
  else if (act === 'reload') loadCollection(true);
  else if (act === 'main') makeSongsFolder(i);
  else if (act === 'remove') removeCollectionFolder(i);
  else if (act === 'files') cq('.bp-files').click();
});
collPanel.addEventListener('change', async e => {
  if (e.target.matches('.bp-files')) {
    await addCollectionFiles([...e.target.files].map(file => ({ file })));
    e.target.value = '';
    return;
  }
  const box = e.target.closest('input[type=checkbox][data-i]');
  if (!box) return;
  box.disabled = true;
  await toggleCollectionItem(coll.items[+box.dataset.i], box.checked);
  box.disabled = false;
});
cq('.bp-search').addEventListener('input', e => { coll.terms = e.target.value; renderCollection(); });

// Soltar en el panel: los archivos se suman a la lista (sin abrirlos) y las carpetas, a la colección
collPanel.addEventListener('dragenter', () => collPanel.classList.add('drop-over'));
collPanel.addEventListener('dragleave', e => { if (!collPanel.contains(e.relatedTarget)) collPanel.classList.remove('drop-over'); });
collPanel.addEventListener('drop', async e => {
  e.preventDefault();
  e.stopPropagation();
  collPanel.classList.remove('drop-over');
  const files = [...(e.dataTransfer?.files || [])];
  // Los handles hay que pedirlos antes del primer await
  const pending = [...(e.dataTransfer?.items || [])].filter(i => i.kind === 'file')
    .map(i => i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null));
  const handles = await Promise.all(pending);
  for (const h of handles) if (h?.kind === 'directory') await addCollectionFolder(h);
  const handleFor = f => handles.find(h => h?.kind === 'file' && h.name === f.name) || null;
  await addCollectionFiles(files.filter(f => !handles.some(h => h?.kind === 'directory' && h.name === f.name))
    .map(file => ({ file, handle: handleFor(file) })));
});

// Las casillas siguen a las pestañas (también si se cierran o se abren por otro camino)
new MutationObserver(renderCollection).observe($('#tabs'), { childList: true });
