'use strict';
// Guardar y abrir canciones en la carpeta "trasponedor" de Música.
// El navegador no permite escribir en una ruta fija: la primera vez se elige la carpeta y
// queda recordada (IndexedDB). Desde entonces Guardar y Abrir empiezan siempre en ella, y
// Guardar sobrescribe el mismo archivo de cada pestaña sin preguntar.
// Los audios y las partituras nunca se copian: se guarda su ruta relativa al .md (o a la
// lista .m3u8) y su "handle", para volver a encontrarlos solos al abrir.

const SONGS_FOLDER = 'trasponedor';
const canPickFiles = !!(window.showSaveFilePicker && window.showOpenFilePicker && window.showDirectoryPicker);
const MD_TYPES = [{ description: 'Canción (Markdown)', accept: { 'text/markdown': ['.md'] } }];
const OPEN_TYPES = [{
  description: 'Canciones y cancioneros',
  accept: {
    'text/markdown': ['.md', '.markdown'],
    'text/plain': ['.txt', '.cho', '.crd', '.chopro', '.chordpro', '.pro'],
    'audio/x-mpegurl': ['.m3u8', '.m3u'],
    'application/json': ['.json']
  }
}];

// ============ INDEXEDDB (los "handles" de archivos y carpetas no caben en localStorage) ============
function handleDb() {
  return handleDb.db ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('canciotras', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function handleStore(mode, fn) {
  try {
    const db = await handleDb();
    return await new Promise((resolve, reject) => {
      const req = fn(db.transaction('handles', mode).objectStore('handles'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return undefined;
  }
}
const handleGet = key => handleStore('readonly', s => s.get(key));
const handleSet = (key, value) => handleStore('readwrite', s => s.put(value, key));
const handleDel = key => handleStore('readwrite', s => s.delete(key));

async function hasPermission(handle, mode = 'readwrite') {
  try {
    if (await handle.queryPermission({ mode }) === 'granted') return true;
    return await handle.requestPermission({ mode }) === 'granted';
  } catch (_) {
    return false;
  }
}

// Sin clic del usuario el navegador no deja pedir permiso: solo se consulta
async function permissionOk(handle, ask, mode = 'read') {
  try {
    if (await handle.queryPermission({ mode }) === 'granted') return true;
    return ask && await handle.requestPermission({ mode }) === 'granted';
  } catch (_) {
    return false;
  }
}

// ============ RUTAS RELATIVAS ============
function normalizeParts(parts) {
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') { if (!out.length) return null; out.pop(); } else out.push(p);
  }
  return out;
}

// Une la carpeta (partes) con una ruta relativa. null si sale de la carpeta de canciones
const joinPath = (dirParts, rel) => normalizeParts([...dirParts, ...decodePath(rel).split('/')]);

// Ruta relativa desde una carpeta (partes) hasta un archivo (partes)
function relPath(fromDir, toFile) {
  let i = 0;
  while (i < fromDir.length && i < toFile.length - 1 && fromDir[i] === toFile[i]) i++;
  return [...fromDir.slice(i).map(() => '..'), ...toFile.slice(i)].join('/');
}

async function fileHandleAt(dir, parts) {
  if (!dir || !parts?.length) return null;
  try {
    let h = dir;
    for (const p of parts.slice(0, -1)) h = await h.getDirectoryHandle(p);
    return await h.getFileHandle(parts.at(-1));
  } catch (_) {
    return null;
  }
}

async function resolveIn(dir, handle) {
  try { return dir && handle ? await dir.resolve(handle) : null; } catch (_) { return null; }
}

// ============ CARPETA DE CANCIONES ============
const savedSongsFolder = () => handleGet('carpeta');

async function songsDirWithPermission(ask = false, mode = 'readwrite') {
  const dir = await savedSongsFolder();
  return dir && await permissionOk(dir, ask, mode) ? dir : null;
}

async function pickSongsFolder() {
  let dir;
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite', startIn: (await savedSongsFolder()) || 'music' });
  } catch (e) {
    if (e.name !== 'AbortError') toast('No se pudo usar esa carpeta');
    return null;
  }
  // Si eligió Música, se usa (o se crea) Música/trasponedor
  if (/^(m[uú]sica|music)$/i.test(dir.name)) dir = await dir.getDirectoryHandle(SONGS_FOLDER, { create: true });
  await handleSet('carpeta', dir);
  toast(`Tus canciones se guardarán en la carpeta "${dir.name}"`, 3500);
  return dir;
}

// La primera vez explica qué carpeta elegir; después la devuelve sin preguntar
async function songsFolder() {
  const dir = await savedSongsFolder();
  if (dir) return dir;
  const go = await showModal({
    title: '¿Dónde guardamos tus canciones?',
    body: `<p>Elige la carpeta <b>${SONGS_FOLDER}</b> dentro de <b>Música</b>.
        Si eliges Música, Cancionero Universal usa (o crea) <b>Música/${SONGS_FOLDER}</b>.</p>
      <p class="hint">Solo se pregunta esta vez: desde ahora Guardar y Abrir empiezan siempre en esa carpeta.</p>`,
    buttons: [{ label: 'Cancelar' }, { label: 'Elegir carpeta', primary: true, value: 'pick' }]
  });
  return go ? pickSongsFolder() : null;
}

async function songsFolderDialog() {
  if (!canPickFiles) {
    toast('Este navegador guarda en la carpeta de Descargas. Para elegir carpeta usa Chrome o Edge.', 5000);
    return;
  }
  const dir = await savedSongsFolder();
  const change = await showModal({
    title: 'Carpeta de canciones',
    body: dir
      ? `<p>Tus canciones se guardan en la carpeta <b>${escapeHtml(dir.name)}</b>.</p>
         <p class="hint">Guardar y Abrir empiezan siempre en esa carpeta.</p>`
      : `<p>Todavía no elegiste carpeta. Te recomendamos <b>Música/${SONGS_FOLDER}</b>.</p>`,
    buttons: [{ label: 'Cerrar' }, { label: dir ? 'Cambiar carpeta…' : 'Elegir carpeta…', primary: true, value: 'pick' }]
  });
  if (change) pickSongsFolder();
}

// ============ CARPETA PARA EXPORTAR ============
// Solo sirve para que el diálogo «Guardar como» empiece ahí: igual se pregunta siempre.
async function exportFolderPath() {
  if (!extractorAllowed()) return '';
  try {
    const r = await fetch(`${extractorBase()}/api/carpeta-exportar`, { cache: 'no-store' });
    return r.ok ? (await r.json()).ruta || '' : '';
  } catch (_) {
    return '';
  }
}

async function pickExportFolder() {
  let dir;
  try {
    dir = await window.showDirectoryPicker({ id: 'cancionero-universal', mode: 'readwrite', startIn: (await handleGet('exportar')) || 'desktop' });
  } catch (e) {
    if (e.name !== 'AbortError') toast('No se pudo usar esa carpeta');
    return null;
  }
  // Si eligió el Escritorio, se usa (o se crea) Escritorio/Cancionero Universal
  if (/^(escritorio|desktop)$/i.test(dir.name)) dir = await dir.getDirectoryHandle(EXPORT_FOLDER, { create: true });
  await handleSet('exportar', dir);
  localStorage.setItem('canciotras-exportado', '1');
  toast(`Al exportar, el diálogo empezará en la carpeta "${dir.name}"`, 3500);
  return dir;
}

async function exportFolderDialog() {
  if (!canPickFiles) {
    toast(isMobileDevice()
      ? 'En el celular lo exportado queda en Descargas, y al terminar puedes compartirlo (WhatsApp, Drive…).'
      : 'Este navegador guarda en la carpeta de Descargas. Para elegir carpeta usa Chrome o Edge.', 6000);
    return;
  }
  const [dir, ruta] = await Promise.all([handleGet('exportar'), exportFolderPath()]);
  const change = await showModal({
    title: 'Carpeta para exportar',
    body: `<p>${dir
      ? `Al exportar (proyectar, Word, página web…), el diálogo «Guardar como» empieza en la carpeta <b>${escapeHtml(dir.name)}</b>.`
      : `Te recomendamos la carpeta <b>${EXPORT_FOLDER}</b> de tu Escritorio.`}</p>
      ${ruta ? `<p class="hint">Ya está creada en: <b>${escapeHtml(ruta)}</b></p>` : ''}
      <p class="hint">Igual se pregunta siempre dónde guardar cada archivo; esto solo elige dónde empieza.
        Si eliges el Escritorio, se usa (o se crea) la carpeta «${EXPORT_FOLDER}».</p>`,
    buttons: [{ label: 'Cerrar' }, { label: dir ? 'Cambiar carpeta…' : 'Elegir carpeta…', primary: true, value: 'pick' }]
  });
  if (change) pickExportFolder();
}

// ============ ARCHIVO DE CADA PESTAÑA ============
const fileHandles = new Map();

async function docFileHandle(d) {
  if (!fileHandles.has(d.id)) {
    const h = await handleGet('archivo:' + d.id);
    if (h) fileHandles.set(d.id, h);
  }
  return fileHandles.get(d.id) || null;
}

function rememberFileHandle(d, handle) {
  fileHandles.set(d.id, handle);
  handleSet('archivo:' + d.id, handle);
}

function forgetFileHandle(id) {
  fileHandles.delete(id);
  handleDel('archivo:' + id);
}

// Carpeta del .md de la pestaña, relativa a la carpeta de canciones ([] = la misma carpeta)
async function docDirParts(d, dir) {
  const parts = await resolveIn(dir, await docFileHandle(d));
  return parts ? parts.slice(0, -1) : null;
}

// ============ ARCHIVOS VINCULADOS (audios y partituras, sin copiarlos) ============
// Clave: "audio:<id>" u "hoja:<id>"
const linkHandles = new Map();

async function linkHandle(key) {
  if (!linkHandles.has(key)) {
    const h = await handleGet(key);
    if (h) linkHandles.set(key, h);
  }
  return linkHandles.get(key) || null;
}

function rememberLinkHandle(key, handle) {
  if (!handle) return;
  linkHandles.set(key, handle);
  handleSet(key, handle);
}

function forgetLinkHandle(key) {
  linkHandles.delete(key);
  handleDel(key);
}

// Ruta con la que se guarda un archivo vinculado, relativa a `fromDir` (carpeta del .md o de la lista)
async function linkedPath(key, src, dir, fromDir, srcDir = fromDir) {
  const parts = await resolveIn(dir, await linkHandle(key));
  if (parts && fromDir) return relPath(fromDir, parts);
  if (!src || isAbsoluteUrl(src)) return src;
  const abs = srcDir && joinPath(srcDir, src);
  return abs && fromDir ? relPath(fromDir, abs) : src.replace(/^\.\//, '');
}

// Busca el archivo de un vínculo: por su handle o por su ruta junto al .md
async function findLinkedFile(key, src, d, ask = false) {
  const h = await linkHandle(key);
  if (h && await permissionOk(h, ask)) {
    try { return await h.getFile(); } catch (_) {}
  }
  if (!src || isAbsoluteUrl(src)) return null;
  const dir = await songsDirWithPermission(ask, 'read');
  if (!dir) return null;
  const base = (await docDirParts(d, dir)) || [];
  const parts = joinPath(base, src);
  const fh = parts && await fileHandleAt(dir, parts);
  if (!fh) return null;
  rememberLinkHandle(key, fh);
  try { return await fh.getFile(); } catch (_) { return null; }
}

// ¿Está fuera de la carpeta de canciones? (entonces su ruta no se puede escribir de forma portable)
async function outsideSongsFolder(handle) {
  const dir = await savedSongsFolder();
  return !!dir && !(await resolveIn(dir, handle));
}

// Vuelve a enlazar los audios locales de una pestaña (tras recargar o abrir). Devuelve
// cuántos siguen sin encontrarse.
async function relinkDocAudios(d, ask = false) {
  let missing = 0;
  for (const a of d.audios) {
    if (a.kind !== 'local' || a.objectUrl) continue;
    const f = await findLinkedFile('audio:' + a.id, a.src, d, ask);
    if (f) a.objectUrl = URL.createObjectURL(f);
    else missing++;
  }
  if (d === cur()) updateAudioBar();
  return missing;
}

async function relinkAll(ask = false) {
  let missing = 0;
  for (const d of docs) missing += await relinkDocAudios(d, ask);
  if (typeof relinkDocSheets === 'function') for (const d of docs) await relinkDocSheets(d, ask);
  return missing;
}

// Botón de la barra de audio: el permiso sobre la carpeta requiere un clic
async function activateFolderAudios() {
  const missing = await relinkAll(true);
  refresh();
  toast(missing ? `${missing} audio(s) no están en la carpeta de canciones` : 'Audios listos', 3000);
}

// ============ ESCRIBIR UNA CANCIÓN ============
// Markdown con las rutas reales de los audios y partituras, relativas a la carpeta del .md
async function markdownFor(d, mdHandle) {
  const dir = await savedSongsFolder();
  const mdParts = dir && mdHandle && await permissionOk(dir, false) ? await resolveIn(dir, mdHandle) : null;
  const fromDir = mdParts ? mdParts.slice(0, -1) : null;
  const srcDir = dir ? await docDirParts(d, dir) : null;
  const audios = [];
  for (const a of d.audios) {
    const src = a.kind === 'local' ? await linkedPath('audio:' + a.id, a.src, dir, fromDir, srcDir ?? fromDir) : a.src;
    if (a.kind === 'local' && src) a.src = src;
    audios.push({ name: a.name, src: a.kind === 'url' ? src : encodePath(src), voice: a.voice, extractor: a.extractor, speed: a.speed, origin: a.origin });
  }
  for (const h of d.sheets || []) {
    if (h.kind === 'local') h.src = await linkedPath('hoja:' + h.id, h.src, dir, fromDir, srcDir ?? fromDir) || h.src;
  }
  return buildMarkdown(d, audios);
}

async function writeText(handle, content) {
  const w = await handle.createWritable();
  await w.write(content);
  await w.close();
}

function afterSave(d, name) {
  markClean(d);
  refresh();
  toast(`Guardado: ${name}`, 2500);
}

// Guardar: sobrescribe el archivo de la pestaña. Guardar como (o la primera vez): pregunta, empezando en la carpeta de canciones
async function saveSong(asNew = false) {
  syncFromEditor();
  const d = cur();
  const name = safeFileName(d.title.trim() || 'Sin título') + '.md';
  if (!canPickFiles) {
    if (await saveFile(buildMarkdown(d), name, 'text/markdown', '.md', 'Canción')) afterSave(d, name);
    return;
  }
  let handle = asNew ? null : await docFileHandle(d);
  if (handle && !await hasPermission(handle)) handle = null;
  if (!handle) {
    const dir = await songsFolder();
    if (!dir) return;
    try {
      handle = await window.showSaveFilePicker({ startIn: dir, suggestedName: name, types: MD_TYPES });
    } catch (e) {
      if (e.name !== 'AbortError') toast('No se pudo guardar');
      return;
    }
  }
  try {
    await writeText(handle, await markdownFor(d, handle));
  } catch (e) {
    toast('No se pudo guardar: ' + e.message, 5000);
    return;
  }
  rememberFileHandle(d, handle);
  afterSave(d, handle.name);
}

async function uniqueFileName(dir, base, ext) {
  for (let i = 1; ; i++) {
    const name = `${base}${i > 1 ? ` (${i})` : ''}${ext}`;
    if (!await fileHandleAt(dir, [name])) return name;
  }
}

// Deja la canción de la pestaña guardada como .md dentro de la carpeta de canciones, sin
// preguntar (para el cancionero). Devuelve las partes de su ruta dentro de la carpeta.
async function ensureSongFile(d, dir) {
  let handle = await docFileHandle(d);
  let parts = handle && await permissionOk(handle, false, 'readwrite') ? await resolveIn(dir, handle) : null;
  if (!parts) {
    const name = await uniqueFileName(dir, safeFileName(d.title.trim() || 'Sin título'), '.md');
    handle = await dir.getFileHandle(name, { create: true });
    parts = [name];
    await writeText(handle, await markdownFor(d, handle));
    rememberFileHandle(d, handle);
    markClean(d);
  } else if (isDirty(d)) {
    await writeText(handle, await markdownFor(d, handle));
    markClean(d);
  }
  return parts;
}

// Abrir: empieza en la carpeta de canciones; lo abierto se guarda luego en el mismo archivo
async function openSongs() {
  if (!canPickFiles) { $('#fileOpen').click(); return; }
  let handles;
  try {
    handles = await window.showOpenFilePicker({ multiple: true, startIn: (await savedSongsFolder()) || 'music', types: OPEN_TYPES });
  } catch (e) {
    if (e.name !== 'AbortError') $('#fileOpen').click();
    return;
  }
  await openFiles(await Promise.all(handles.map(async handle => ({ file: await handle.getFile(), handle }))));
}
