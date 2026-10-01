'use strict';
/*
 * CANCIONERO — lista .m3u8 (UTF-8) que solo guarda rutas: no copia audios ni crea carpetas.
 * VLC y cualquier reproductor la abren como lista de audios; las líneas #CANCIOTRAS… (que
 * los reproductores ignoran) dicen a qué canción (.md) pertenece cada audio.
 *
 *   #EXTM3U
 *   #PLAYLIST:Mi cancionero
 *   #CANCIOTRAS:version=2;app=CancioTras 3.1.0;notacion=latina;creado=2026-09-29T20:50:00Z
 *   #EXTINF:-1,Abre tu jardin
 *   #CANCIOTRAS-CANCION:Abre tu jardin.md        ← .md de la canción (ruta relativa a la lista)
 *   #CANCIOTRAS-TONO:Mi mayor                   ← solo en la primera entrada de cada canción
 *   #CANCIOTRAS-DESPLAZAMIENTO:4                 ← velocidad del atril (1 = más lento … 20)
 *   #CANCIOTRAS-ETIQUETAS:Católico, Entrada      ← etiquetas para buscar y clasificar
 *   #CANCIOTRAS-AUDIO:nombre=Pista;voz=todas;velocidad=0.75;pagina=https%3A%2F%2Fwww.youtube.com%2F…
 *   http://127.0.0.1:8777/api/audio?url=…        ← audio de una página (YouTube…) por el servidor local
 *   #EXTINF:-1,Coro
 *   #CANCIOTRAS-CANCION:Coro.md
 *   #CANCIOTRAS-AUDIO:nombre=Coro;origen=https%3A%2F%2F…
 *   audio/coro.webm                              ← archivo de audio (ruta relativa a la lista)
 *   #CANCIOTRAS-CANCION:Himno.md                 ← canción sin audio: solo etiquetas, sin entrada
 *   #CANCIOTRAS-TITULO:Himno                       (así VLC no intenta abrir el .md como música)
 *   #CANCIOTRAS-SIN-AUDIO
 *
 * - Varias voces de una canción = entradas seguidas con la misma CANCIOTRAS-CANCION.
 * - Valores de CANCIOTRAS-AUDIO codificados con encodeURIComponent (voz: todas|tenor|soprano|
 *   bajo|mezzosoprano|castrati; pagina: página cuyo audio se obtiene con yt-dlp (VLC no sabe
 *   sacarlo de YouTube, por eso la entrada apunta al servidor de CancioTras); origen: página de
 *   donde salió un audio local, para escucharlo desde ahí si el archivo no aparece).
 * - Se leen también las listas anteriores (entrada = página de YouTube con extraer=1, o el .md).
 * - Todo lo demás de la canción (texto, partituras, instrumentos, rasgueos) está en su .md.
 * - Se siguen pudiendo abrir los cancioneros viejos (.cancionero.json, formato "cancionero" v1).
 */

const M3U_TAG = '#CANCIOTRAS';

const tagValue = v => encodeURIComponent(String(v));
const tagPairs = obj => Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${k}=${tagValue(v)}`).join(';');
function parsePairs(s) {
  const out = {};
  for (const part of (s || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1)); } catch (_) { out[part.slice(0, i).trim()] = part.slice(i + 1); }
  }
  return out;
}
const m3uLine = s => String(s).replace(/[\r\n]+/g, ' ');
const M3U_TYPES = [{ description: 'Cancionero (lista .m3u8)', accept: { 'audio/x-mpegurl': ['.m3u8'] } }];

// ============ CANCIONERO ACTIVO ============
// Nombre en state.cancioneroName y ruta para mostrar en state.cancioneroPath. El handle de su
// .m3u8 (si ya se guardó, o se abrió desde la carpeta de canciones) queda en IndexedDB para que
// «Guardar cancionero» escriba siempre en el mismo archivo.
let bookHandle;

async function activeBookHandle() {
  if (bookHandle === undefined) bookHandle = (await handleGet('cancionero')) || null;
  return bookHandle;
}

const bookSongs = () => docs.filter(d => !isBlank(d));
// Todo lo que se escribe en la lista: si cambia, el cancionero tiene cambios sin guardar
const bookSignature = () => [state.cancioneroName, ...bookSongs().map(d => [d.id, d.title.trim(), d.scrollSpeed || '',
  tagsToMeta(d.tags), d.audios.map(a => [a.src, a.name, a.voice, a.speed || ''].join('|')).join(',')].join('\u0001'))].join('\u0000');
const bookDirty = () => bookSongs().length > 0 && bookSignature() !== state.cancioneroClean;

function setActiveBook(name, handle = null, path = '', clean = true) {
  state.cancioneroName = name || '';
  state.cancioneroPath = path || (handle ? handle.name : '');
  bookHandle = handle;
  if (handle) handleSet('cancionero', handle); else handleDel('cancionero');
  syncFromEditor();
  state.cancioneroClean = clean ? bookSignature() : '';
  renderBookName();
  scheduleSave();
}

function renderBookName() {
  const b = $('#bookName');
  const dirty = bookDirty();
  b.querySelector('.book-label').textContent = state.cancioneroName || 'Cancionero sin nombre';
  b.classList.toggle('dirty', dirty);
  b.classList.toggle('unsaved', !state.cancioneroPath);
  b.title = state.cancioneroPath
    ? `Cancionero activo: ${state.cancioneroPath}${dirty ? ' (cambios sin guardar)' : ''}. Clic para guardarlo`
    : 'Cancionero sin guardar todavía: clic para elegir dónde guardarlo';
}

// ============ GUARDAR ============
// songPath(d): ruta del .md de la canción relativa a la lista
async function buildM3u8(name, songPath) {
  syncFromEditor();
  const out = ['#EXTM3U', `#PLAYLIST:${m3uLine(name)}`,
    `${M3U_TAG}:${tagPairs({ version: 2, app: `${APP_INFO.nombre} ${APP_INFO.version}`, notacion: isLatin() ? 'latina' : 'anglosajona', creado: new Date().toISOString() })}`];
  for (const d of docs) {
    if (isBlank(d)) continue;
    const md = await songPath(d);
    const title = m3uLine(d.title.trim() || 'Sin título');
    const key = detectKey(d.text);
    const songTags = [`${M3U_TAG}-CANCION:${md}`];
    if (key) songTags.push(`${M3U_TAG}-TONO:${keyLabel(key, isLatin())}`);
    if (d.scrollSpeed) songTags.push(`${M3U_TAG}-DESPLAZAMIENTO:${d.scrollSpeed}`);
    if (d.tags?.length) songTags.push(`${M3U_TAG}-ETIQUETAS:${m3uLine(tagsToMeta(d.tags))}`);
    if (!d.audios.length) {
      out.push(...songTags, `${M3U_TAG}-TITULO:${title}`, `${M3U_TAG}-SIN-AUDIO`);
      continue;
    }
    d.audios.forEach((a, i) => {
      const voice = a.voice !== 'todas' && VOICES[a.voice] ? ` (${VOICES[a.voice].label})` : '';
      out.push(`#EXTINF:-1,${title}${voice}`, ...(i ? songTags.slice(0, 1) : songTags),
        `${M3U_TAG}-AUDIO:${tagPairs({ nombre: a.name, voz: a.voice, velocidad: a.speed && a.speed !== 1 ? a.speed : '', pagina: a.extractor ? a.src : '', origen: a.extractor ? '' : a.origin })}`,
        a.path);
    });
  }
  return out.join('\n') + '\n';
}

// Entrada de la lista para un audio: archivo local (ruta relativa), archivo web o, para
// páginas como YouTube, el servidor de CancioTras (VLC no sabe sacarles el audio)
const m3uAudioPath = (a, localPath) =>
  a.kind === 'local' ? localPath : a.extractor ? extractorListUrl(a.src) : a.src;

// Rutas de los audios relativas a la lista (listParts: carpeta de la lista dentro de la de canciones)
async function prepareAudioPaths(dir, listParts) {
  for (const d of docs) {
    const srcDir = (await docDirParts(d, dir)) || [];
    for (const a of d.audios) {
      a.path = m3uAudioPath(a, a.kind === 'local' ? await linkedPath('audio:' + a.id, a.src, dir, listParts, srcDir) : null);
    }
  }
}

async function askBookName(songs, where) {
  return showModal({
    title: 'Guardar cancionero',
    body: `
      <p>Se guardarán las <b>${songs.length}</b> canciones abiertas, en el orden de las pestañas.</p>
      <ol class="book-list">${songs.map(d => `<li>${escapeHtml(d.title.trim() || 'Sin título')}</li>`).join('')}</ol>
      <label class="field"><span>Nombre del cancionero</span>
        <input type="text" id="mBook" value="${escapeHtml(state.cancioneroName || 'Mi cancionero')}"></label>
      <p class="hint">Se guarda como lista <b>.m3u8</b>: ocupa muy poco porque solo anota dónde está
        cada canción y cada audio (se abre también en VLC). ${where}</p>`,
    onOpen: d => d.querySelector('#mBook').select(),
    buttons: [
      { label: 'Cancelar' },
      {
        label: canPickFiles ? 'Elegir dónde guardar…' : 'Guardar', primary: true,
        onClick: d => d.querySelector('#mBook').value.trim() || modalFail(d, 'Escribe un nombre para el cancionero.')
      }
    ]
  });
}

// Pide nombre y lugar del .m3u8; el diálogo empieza en `startParts` (dentro de la carpeta de canciones),
// y la lista tiene que quedar dentro de esa carpeta para poder anotar rutas relativas.
async function pickBookFile(dir, songs, startParts) {
  const folderName = [dir.name, ...startParts].join('/');
  let name = await askBookName(songs, `Te sugerimos guardarla en la carpeta <b>${escapeHtml(folderName)}</b>;
    las canciones que aún no tienen archivo se guardan como .md junto a ella.`);
  if (!name) return null;
  const startIn = (await dirHandleAt(dir, startParts)) || dir;
  for (;;) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({ startIn, suggestedName: safeFileName(name) + '.m3u8', types: M3U_TYPES });
    } catch (e) {
      if (e.name !== 'AbortError') toast('No se pudo guardar el cancionero');
      return null;
    }
    const parts = await resolveIn(dir, handle);
    if (parts) {
      const base = fileBase(handle.name);
      return { handle, parts, name: base === safeFileName(name) ? name : base };
    }
    const again = await showModal({
      title: 'Elige otra ubicación',
      body: `<p>El cancionero tiene que quedar dentro de tu carpeta de canciones <b>${escapeHtml(dir.name)}</b>
        (o en una de sus subcarpetas) para encontrar después sus canciones y audios.</p>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Elegir de nuevo…', primary: true, value: true }]
    });
    if (!again) return null;
  }
}

// Devuelve true si el cancionero quedó guardado. Si ya tiene archivo se sobrescribe sin preguntar;
// si no (o con asNew), se piden el nombre y el lugar. folderParts: subcarpeta (de la carpeta de
// canciones) donde guardar las canciones nuevas y donde empieza el diálogo; por defecto, la de la lista.
async function saveCancioneroDialog(asNew = false, folderParts = null) {
  syncFromEditor();
  const songs = bookSongs();
  if (!songs.length) { toast('No hay canciones abiertas para guardar'); return false; }

  // Sin acceso a carpetas (Firefox, Safari): la lista apunta a "Título.md" junto a ella
  if (!canPickFiles) {
    const name = await askBookName(songs, 'Queda en Descargas: guarda cada canción (.md) junto a la lista para que se encuentren.');
    if (!name) return false;
    for (const d of docs) for (const a of d.audios) a.path = m3uAudioPath(a, a.src.replace(/^\.\//, ''));
    const text = await buildM3u8(name, async d => safeFileName(d.title.trim() || 'Sin título') + '.md');
    for (const d of docs) for (const a of d.audios) delete a.path;
    const fileName = safeFileName(name) + '.m3u8';
    if (await saveFile(text, fileName, 'audio/x-mpegurl', '.m3u8', 'Cancionero')) {
      setActiveBook(name, null, 'Descargas/' + fileName);
      toast('Cancionero guardado. Guarda cada canción (.md) junto a la lista para que se encuentren.', 6000);
      return true;
    }
    return false;
  }

  const dir = await songsFolder();
  if (!dir || !await hasPermission(dir)) return false;
  let handle = asNew ? null : await activeBookHandle();
  let parts = handle && await resolveIn(dir, handle);
  let name = state.cancioneroName || fileBase(handle?.name || '') || 'Mi cancionero';
  if (!parts) {
    const picked = await pickBookFile(dir, songs, folderParts || []);
    if (!picked) return false;
    ({ handle, parts, name } = picked);
  }
  const listParts = parts.slice(0, -1);
  try {
    toast('Guardando cancionero…', 60000);
    await prepareAudioPaths(dir, listParts);
    const text = await buildM3u8(name, async d => relPath(listParts, await ensureSongFile(d, dir, folderParts || listParts)));
    await writeText(handle, text);
    const path = [dir.name, ...parts].join('/');
    setActiveBook(name, handle, path);
    refresh();
    const kb = Math.max(1, Math.round(new Blob([text]).size / 1024));
    toast(`Cancionero guardado en "${path}" (${songs.length} canciones, ${kb} KB)`, 4000);
    return true;
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar el cancionero: ' + err.message, 5000);
    return false;
  } finally {
    for (const d of docs) for (const a of d.audios) delete a.path;
  }
}

// Antes de cerrar todas las pestañas (nuevo cancionero, abrir otro en su lugar): cada canción con
// cambios se guarda en su archivo y el cancionero en su .m3u8; lo que aún no tiene archivo se guarda
// en la carpeta sugerida (o se pregunta dónde). Devuelve false si se canceló.
async function saveBeforeClosing(title) {
  syncFromEditor();
  const songs = bookSongs();
  const changed = songs.filter(d => isDirty(d));
  const book = bookDirty();
  if (!changed.length && !book) return true;

  const dir = canPickFiles ? await savedSongsFolder() : null;
  const bookFile = dir && await activeBookHandle();
  const bookParts = bookFile ? await resolveIn(dir, bookFile) : null;
  let folder = bookParts ? bookParts.slice(0, -1) : [];
  const files = new Map();
  for (const d of changed) files.set(d, await docFileHandle(d));
  const fresh = songs.filter(d => !files.get(d) && (book || isDirty(d)));
  const folderLabel = () => dir ? [dir.name, ...folder].join('/') : `Música/${SONGS_FOLDER}`;
  const bookName = escapeHtml(state.cancioneroName || 'Mi cancionero');

  const choice = await showModal({
    title,
    body: `
      <p>Antes de cerrar las pestañas se guarda cada canción en su archivo.</p>
      ${changed.length ? `<ul class="book-list">${changed.map(d => `<li><b>${escapeHtml(d.title.trim() || 'Sin título')}</b> —
        ${files.get(d) ? `en «${escapeHtml(files.get(d).name)}»` : 'nueva'}</li>`).join('')}</ul>` : ''}
      ${fresh.length && canPickFiles ? `<p>Las canciones que aún no tienen archivo se guardan en
        📁 <b class="cf-name">${escapeHtml(folderLabel())}</b>
        ${dir ? '<button type="button" class="linkish" data-cf>Cambiar carpeta…</button>' : ''}</p>` : ''}
      ${book ? `<label class="support-check"><input type="checkbox" id="cfBook" checked>
        Guardar también el cancionero «${bookName}» (.m3u8)
        ${state.cancioneroPath && bookParts ? `en «${escapeHtml(state.cancioneroPath)}»` : '— después eliges dónde'}</label>` : ''}
      ${!canPickFiles ? '<p class="hint">Este navegador lo descarga todo junto (en Descargas).</p>' : ''}`,
    onOpen: d => {
      const btn = d.querySelector('[data-cf]');
      if (btn) btn.onclick = async () => {
        let picked;
        try {
          picked = await window.showDirectoryPicker({ mode: 'readwrite', startIn: (await dirHandleAt(dir, folder)) || dir });
        } catch (_) { return; }
        const parts = await resolveIn(dir, picked);
        if (!parts) { modalFail(d, `Elige la carpeta «${dir.name}» o una de sus subcarpetas.`); return; }
        modalFail(d, '');
        folder = parts;
        d.querySelector('.cf-name').textContent = folderLabel();
      };
    },
    buttons: [
      { label: 'Cancelar' },
      { label: 'Cerrar sin guardar', value: 'skip' },
      { label: 'Guardar y cerrar', primary: true, onClick: d => d.querySelector('#cfBook')?.checked ? 'book' : 'songs' }
    ]
  });
  if (!choice) return false;
  if (choice === 'skip') return true;
  if (!canPickFiles) return downloadSongs(choice === 'book' ? songs : changed, choice === 'book' ? state.cancioneroName || 'Mi cancionero' : null);
  return choice === 'book' ? saveCancioneroDialog(false, folder) : saveChangedSongs(folder);
}

// ============ ABRIR ============
function parseM3u8(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const list = { title: '', meta: {}, entries: [] };
  let e = {};
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    let m;
    if ((m = l.match(/^#PLAYLIST:(.*)$/))) list.title = m[1].trim();
    else if ((m = l.match(/^#CANCIOTRAS:(.*)$/))) list.meta = parsePairs(m[1]);
    else if ((m = l.match(/^#EXTINF:[^,]*,(.*)$/))) e.title = m[1].trim();
    else if ((m = l.match(/^#CANCIOTRAS-CANCION:(.*)$/))) e.song = m[1].trim();
    else if ((m = l.match(/^#CANCIOTRAS-TONO:(.*)$/))) e.key = m[1].trim();
    else if ((m = l.match(/^#CANCIOTRAS-DESPLAZAMIENTO:(.*)$/))) e.scroll = +m[1];
    else if ((m = l.match(/^#CANCIOTRAS-ETIQUETAS:(.*)$/))) e.tags = metaToTags(m[1]);
    else if ((m = l.match(/^#CANCIOTRAS-AUDIO:(.*)$/))) e.audio = parsePairs(m[1]);
    else if ((m = l.match(/^#CANCIOTRAS-TITULO:(.*)$/))) e.title = m[1].trim();
    else if (/^#CANCIOTRAS-SIN-AUDIO\b/.test(l)) {
      if (e.song) list.entries.push({ ...e, uri: e.song, noAudio: true });
      e = {};
    }
    else if (l.startsWith('#')) continue;
    else { list.entries.push({ ...e, uri: l }); e = {}; }
  }
  return list;
}

const isAudioUri = uri => !/\.(md|markdown)$/i.test(uri.split(/[?#]/)[0]);
const fileUriToPath = uri => /^file:\/\//i.test(uri) ? decodeURIComponent(uri.replace(/^file:\/\/[^/]*/i, '')) : uri;

// Agrupa las entradas por canción (propias) o una canción por entrada (listas de otras apps)
function m3uSongs(list) {
  const songs = [];
  for (const e of list.entries) {
    const last = songs.at(-1);
    if (e.song && last?.md === e.song) { last.entries.push(e); continue; }
    songs.push({ md: e.song || (isAudioUri(e.uri) ? null : e.uri), title: (e.title || '').replace(/\s\((Tenor|Soprano|Bajo|Mezzosoprano|Castrati)\)$/, ''), key: e.key, scroll: e.scroll, tags: e.tags || [], entries: [e] });
  }
  return songs;
}

// dir: carpeta desde la que se resuelven las rutas; baseParts: carpeta de la lista dentro de dir.
// texts: { "Canción.md": texto } para listas que traen sus canciones (el cancionero de ejemplo).
// origin: { handle, path } del .m3u8 si está en la carpeta de canciones (Guardar escribe ahí).
async function loadM3u8(list, dir, baseParts, texts = null, origin = null) {
  const songs = m3uSongs(list);
  if (!songs.length) { toast('La lista está vacía'); return; }
  const choice = await askReplaceTabs(list.title || 'Cancionero', songs.length);
  if (!choice) return;
  const readParts = async parts => {
    const h = dir && parts && await fileHandleAt(dir, parts);
    return h ? { handle: h, parts, file: await h.getFile() } : null;
  };
  const readText = rel => texts?.[rel] == null ? null
    : { handle: null, parts: [rel], file: new File([texts[rel]], rel, { type: 'text/markdown' }) };
  const readFile = rel => texts ? readText(rel)
    : readParts(isAbsoluteUrl(rel) && !/^file:/i.test(rel) ? null : joinPath(baseParts, fileUriToPath(rel)));

  const opened = [];
  let missingMd = 0, missingAudio = 0;
  for (const s of songs) {
    let data = null, mdHandle = null, mdDir = baseParts;
    if (s.md) {
      const f = await readFile(s.md);
      if (f) {
        data = parseMarkdown(await f.file.text(), f.file.name);
        mdHandle = f.handle;
        mdDir = f.parts.slice(0, -1);
      } else missingMd++;
    }
    if (!data) {
      // Sin .md: la canción se arma con lo que dice la lista
      data = { title: s.title || fileBase(s.entries[0].uri) || 'Sin título', text: '', audios: [], scrollSpeed: s.scroll || null, tags: s.tags };
      for (const e of s.entries) {
        if (e.noAudio || !isAudioUri(e.uri)) continue;
        const a = e.audio || {};
        const page = a.pagina || extractorPageOf(e.uri);
        const src = page || fileUriToPath(e.uri);
        data.audios.push({ src, name: a.nombre || e.title || fileBase(src), voice: a.voz || 'todas', kind: isAbsoluteUrl(src) ? 'url' : 'local', extractor: page || a.extraer ? true : undefined, speed: +a.velocidad || undefined, origin: a.origen });
      }
    } else {
      if (s.scroll && !data.scrollSpeed) data.scrollSpeed = s.scroll;
      if (s.tags.length && !data.tags?.length) data.tags = s.tags;
    }
    const d = makeDoc({ ...data, clean: true });
    if (mdHandle) rememberFileHandle(d, mdHandle);
    // Los audios locales se buscan ya, desde la carpeta de la lista o del .md
    for (const a of d.audios) {
      if (a.kind !== 'local') continue;
      const f = await readParts(joinPath(mdHandle ? mdDir : baseParts, a.src));
      if (f) {
        a.objectUrl = URL.createObjectURL(f.file);
        rememberLinkHandle('audio:' + a.id, f.handle);
      } else missingAudio++;
    }
    for (const h of d.sheets) {
      if (h.kind !== 'local') continue;
      const f = await readParts(joinPath(mdHandle ? mdDir : baseParts, h.src));
      if (f) {
        h.blob = f.file;
        h.objectUrl = URL.createObjectURL(f.file);
        rememberLinkHandle('hoja:' + h.id, f.handle);
      }
    }
    opened.push(d);
  }
  replaceOrAddTabs(opened, choice === 'replace');
  const title = list.title || fileBase(origin?.handle?.name || '') || 'Cancionero';
  if (choice === 'replace') setActiveBook(title, origin?.handle || null, origin?.path || '');
  else if (!state.cancioneroName) setActiveBook(title, null, '', false);
  if (list.meta.notacion === 'anglosajona' || list.meta.notacion === 'latina') {
    state.notation = list.meta.notacion === 'latina' ? 'latin' : 'eng';
    applyState();
    refresh();
  }
  const notes = [];
  if (missingMd) notes.push(`${missingMd} canción(es) no se encontraron`);
  if (missingAudio) notes.push(`${missingAudio} audio(s) no se encontraron`);
  toast(`Cancionero "${list.title || ''}" abierto: ${opened.length} canciones${notes.length ? '. ' + notes.join(', ') : ''}`, notes.length ? 6000 : 3000);
}

async function askReplaceTabs(title, count) {
  syncFromEditor();
  if (!docs.some(d => !isBlank(d))) return 'replace';
  const choice = await showModal({
    title: 'Abrir cancionero',
    body: `<p>“${escapeHtml(title)}” tiene <b>${count}</b> canciones. ¿Qué hacemos con las pestañas abiertas?</p>`,
    buttons: [
      { label: 'Cancelar' },
      { label: 'Añadir a las pestañas', value: 'add' },
      { label: 'Reemplazar pestañas', primary: true, value: 'replace' }
    ]
  });
  if (choice === 'replace' && !await saveBeforeClosing('Antes de reemplazar las pestañas')) return null;
  return choice;
}

function replaceOrAddTabs(newDocs, replace) {
  leaveCurrent();
  if (replace) {
    docs.forEach(d => { revokeDocAudios(d); revokeDocSheets(d); forgetFileHandle(d.id); });
    docs = [];
  } else {
    docs = docs.filter(d => !isBlank(d));
  }
  docs.push(...newDocs);
  activate(newDocs[0].id);
}

// Abre una lista .m3u8/.m3u. Si está dentro de la carpeta de canciones, las rutas se resuelven
// solas; si no, se pide una vez la carpeta donde está la lista.
async function openM3u8(file, handle) {
  const list = parseM3u8(await file.text());
  let dir = null, baseParts = [], origin = null;
  if (canPickFiles) {
    const songsDir = await songsDirWithPermission(true, 'read');
    const parts = handle && await resolveIn(songsDir, handle);
    if (parts) {
      dir = songsDir;
      baseParts = parts.slice(0, -1);
      origin = { handle, path: [songsDir.name, ...parts].join('/') };
    } else {
      const go = await showModal({
        title: 'Abrir cancionero',
        body: `<p>Para encontrar las canciones y los audios de <b>${escapeHtml(file.name)}</b>,
          elige la carpeta donde está guardada la lista.</p>`,
        buttons: [{ label: 'Abrir sin audios' }, { label: 'Elegir carpeta…', primary: true, value: 'pick' }]
      });
      if (go) {
        try {
          dir = await window.showDirectoryPicker({ mode: 'read', startIn: (await savedSongsFolder()) || 'music' });
        } catch (_) { dir = null; }
      }
    }
  }
  await loadM3u8(list, dir, baseParts, null, origin);
}

// ---- Cancioneros viejos (.cancionero.json v1): solo lectura ----
const isCancionero = data => data?.formato === 'cancionero' && Array.isArray(data.canciones);

// Sus audios copiados (carpeta audio/ junto al .json) siguen siendo los principales; la página
// de donde salieron queda como respaldo por si el archivo no aparece.
async function loadCancionero(data, handle = null) {
  if (!isCancionero(data)) { toast('El archivo no es un cancionero válido'); return; }
  const choice = await askReplaceTabs(data.titulo || 'Cancionero', data.canciones.length);
  if (!choice) return;
  let base = [];
  if (handle && canPickFiles) {
    const parts = await resolveIn(await songsDirWithPermission(false, 'read'), handle);
    if (parts) base = parts.slice(0, -1);
  }
  const songs = [...data.canciones].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const newDocs = songs.map(s => makeDoc({
    title: s.titulo || 'Sin título',
    text: typeof s.texto === 'string' ? s.texto : '',
    scrollSpeed: +s.desplazamiento || null,
    audios: (s.audios || []).filter(a => a?.ruta).map(a => {
      const kind = a.tipo || (isAbsoluteUrl(a.ruta) ? 'url' : 'local');
      const src = kind === 'local' ? (joinPath(base, a.ruta) || []).join('/') || a.ruta : a.ruta;
      return { name: a.nombre, src, voice: a.voz || 'todas', kind, extractor: kind === 'url' && !!a.extraer, speed: +a.velocidad || undefined, origin: a.origen };
    })
  }));
  if (!newDocs.length) { toast('El cancionero está vacío'); return; }
  replaceOrAddTabs(newDocs, choice === 'replace');
  if (choice === 'replace' || !state.cancioneroName) setActiveBook(data.titulo || 'Cancionero', null, '', false);
  toast(`Cancionero "${data.titulo || ''}" abierto: ${newDocs.length} canciones. Guárdalo de nuevo para pasarlo al formato .m3u8.`, 5000);
  relinkAll();
}
