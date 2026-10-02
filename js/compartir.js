'use strict';
// Compartir un cancionero (por WhatsApp u otro medio). Va liviano: solo texto. Cada canción viaja
// como su .md (letra, acordes, tags, instrumentos, rasgueos…) con los audios y hojas de internet;
// los archivos del equipo se quedan. Se envía una página .html (la del atril) con los datos adentro y
// un botón «Editar en Cancionero Universal», que abre la app con WEB_APP_URL#cancionero=<datos>.
// Ese enlace va dentro del archivo: enviado como mensaje, WhatsApp lo cortaría.
// Quien lo recibe lo abre en pestañas sin guardar y lo guarda en su carpeta con Guardar cancionero.

const SHARE_FORMAT = 'cancionero-compartido';
const SHARE_HASH = '#cancionero=';
const SHARE_MAX_SONGS = 300;
const SHARE_MAX_BYTES = 5 * 1024 * 1024;
const SHARE_DATA_ID = 'cancionero-datos';

const isWebUrl = s => /^https?:\/\//i.test(String(s || ''));
const isStreamingUrl = url => { try { const h = new URL(url).hostname; return STREAMING_SITES.some(([re]) => re.test(h)); } catch (_) { return false; } };

// ============ PAQUETE ============
// Un audio del equipo que salió de una página (YouTube…) viaja como enlace a esa página
function buildSharePackage(list, titulo) {
  syncFromEditor();
  let leftAudios = 0, leftSheets = 0;
  const canciones = list.map(d => {
    const audios = [];
    for (const a of d.audios) {
      if (a.kind === 'url' && isWebUrl(a.src)) audios.push(a);
      else if (isWebUrl(a.origin)) audios.push({ ...a, kind: 'url', src: a.origin, extractor: isStreamingUrl(a.origin) || undefined, origin: undefined });
      else leftAudios++;
    }
    const sheets = d.sheets.filter(h => h.kind === 'url' && isWebUrl(h.src));
    leftSheets += d.sheets.length - sheets.length;
    return { md: buildMarkdown({ ...d, audios, sheets }) };
  });
  const pkg = {
    formato: SHARE_FORMAT, version: 1, titulo: titulo || list[0]?.title.trim() || 'Cancionero',
    notacion: isLatin() ? 'latina' : 'anglosajona', app: `${APP_INFO.nombre} ${APP_INFO.version}`, canciones
  };
  return { pkg, leftAudios, leftSheets };
}

function checkSharePackage(data) {
  if (data?.formato !== SHARE_FORMAT || !Array.isArray(data.canciones)) throw new Error('No es un cancionero compartido.');
  const canciones = data.canciones.map(c => c?.md).filter(md => typeof md === 'string' && md.trim());
  if (!canciones.length) throw new Error('El cancionero viene vacío.');
  if (canciones.length > SHARE_MAX_SONGS) throw new Error(`Trae demasiadas canciones (más de ${SHARE_MAX_SONGS}).`);
  return {
    titulo: String(data.titulo || 'Cancionero').slice(0, 200),
    notacion: data.notacion === 'latina' || data.notacion === 'anglosajona' ? data.notacion : '',
    canciones
  };
}

// ============ ENLACE ============
const toBase64Url = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// Lee un flujo sin pasar del máximo (un enlace dañado o malicioso podría inflarse sin fin)
async function readLimited(stream) {
  const reader = stream.getReader(), parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > SHARE_MAX_BYTES) { reader.cancel().catch(() => {}); throw new Error('El cancionero es demasiado grande.'); }
    parts.push(value);
  }
  return new TextDecoder().decode(await new Blob(parts).arrayBuffer());
}

// «z» + deflate en base64url; «j» + JSON en base64url (navegadores sin CompressionStream)
async function packToLink(pkg) {
  const json = JSON.stringify(pkg);
  let data;
  if (window.CompressionStream) {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    data = 'z' + toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
  } else {
    data = 'j' + toBase64Url(new TextEncoder().encode(json));
  }
  return WEB_APP_URL + SHARE_HASH + data;
}

async function linkToPack(data) {
  let json;
  try {
    const bytes = fromBase64Url(decodeURIComponent(data.slice(1)));
    if (data[0] === 'z') {
      if (!window.DecompressionStream) throw new Error('old');
      json = await readLimited(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
    } else if (data[0] === 'j') {
      if (bytes.length > SHARE_MAX_BYTES) throw new Error('El cancionero es demasiado grande.');
      json = new TextDecoder().decode(bytes);
    } else throw new Error('bad');
  } catch (e) {
    if (e.message === 'old') throw new Error('Este navegador es muy antiguo para abrir enlaces de cancioneros: actualízalo o pide el archivo .html.');
    if (/demasiado grande/.test(e.message)) throw e;
    throw new Error('El enlace está incompleto o dañado (a veces WhatsApp lo corta).');
  }
  let parsed;
  try { parsed = JSON.parse(json); } catch (_) { throw new Error('El enlace está incompleto o dañado.'); }
  return checkSharePackage(parsed);
}

// Página .html exportada: los datos van en <script type="application/json" id="cancionero-datos">
function pageToPack(html) {
  const m = html.match(new RegExp(`<script type="application/json" id="${SHARE_DATA_ID}">([\\s\\S]*?)</script>`));
  if (!m) return null;
  let parsed;
  try { parsed = JSON.parse(m[1]); } catch (_) { throw new Error('Los datos de la página están dañados.'); }
  return checkSharePackage(parsed);
}

// ============ RECIBIR ============
async function openSharedBook(pkg) {
  const songs = pkg.canciones.map(md => parseMarkdown(md));
  const choice = await askReplaceTabs(pkg.titulo, songs.length);
  if (!choice) return false;
  const opened = songs.map(s => makeDoc({
    ...s, audios: s.audios.filter(a => isWebUrl(a.src)), sheets: s.sheets.filter(h => isWebUrl(h.src)), clean: false
  }));
  replaceOrAddTabs(opened, choice === 'replace');
  if (choice === 'replace' || !state.cancioneroName) setActiveBook(pkg.titulo, null, '', false);
  if (pkg.notacion) state.notation = pkg.notacion === 'latina' ? 'latin' : 'eng';
  state.mode = 'atril';
  applyState();
  refresh();
  toast(`Cancionero «${pkg.titulo}» recibido: ${opened.length} ${opened.length === 1 ? 'canción' : 'canciones'}. ` +
    'Guárdalo con Archivo → Guardar cancionero para tenerlo en tu carpeta.', 7000);
  return true;
}

function sharedOpenFailed(e) {
  showModal({
    title: 'No se pudo abrir el cancionero',
    body: `<p>${escapeHtml(e.message)}</p><p class="hint">Pide que te lo envíen de nuevo, o que te manden el archivo .html.</p>`
  });
}

async function openSharedFromHash() {
  if (!location.hash.startsWith(SHARE_HASH)) return false;
  const data = location.hash.slice(SHARE_HASH.length);
  history.replaceState(null, '', location.pathname + location.search);
  try {
    await openSharedBook(await linkToPack(data));
  } catch (e) {
    sharedOpenFailed(e);
  }
  return true;
}
window.addEventListener('hashchange', openSharedFromHash);

async function openSharedPage(html, name) {
  let pkg;
  try { pkg = pageToPack(html); } catch (e) { sharedOpenFailed(e); return; }
  if (!pkg) { toast(`«${name}» no trae un cancionero para editar`, 4000); return; }
  await openSharedBook(pkg);
}

// ============ ENVIAR ============
const fmtSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

async function prepareShareFile(titulo, chosen) {
  const { pkg, leftAudios, leftSheets } = buildSharePackage(chosen, titulo);
  const link = await packToLink(pkg);
  const html = new Blob([buildAtrilHtml(chosen, { titulo: chosen.length > 1 ? titulo : '', share: { pkg, link } })], { type: 'text/html' });
  const fileName = safeFileName(titulo) + '.html';
  return { titulo, n: chosen.length, html, fileName, file: new File([html], fileName, { type: 'text/html' }), leftAudios, leftSheets };
}

function shareSummaryHtml(r) {
  const left = [r.leftAudios && (r.leftAudios === 1 ? '1 audio' : r.leftAudios + ' audios'),
    r.leftSheets && (r.leftSheets === 1 ? '1 partitura' : r.leftSheets + ' partituras')].filter(Boolean);
  return `Archivo «${escapeHtml(r.fileName)}» de ${fmtSize(r.html.size)} · ${r.n} ${r.n === 1 ? 'canción' : 'canciones'}.` +
    (left.length ? `<br>${left.join(' y ')} de tu equipo no ${r.leftAudios + r.leftSheets > 1 ? 'viajan' : 'viaja'}: los de internet sí.` : '');
}

// navigator.share con archivos solo funciona justo después del toque: el .html se prepara antes,
// cada vez que cambia el título o las canciones, para que al tocar «Enviar» ya esté listo.
async function shareBookDialog() {
  syncFromEditor();
  const songs = docs.filter(d => !isBlank(d));
  if (!songs.length) { toast('No hay canciones abiertas para compartir'); return; }
  let canShareFiles = false;
  try { canShareFiles = !!navigator.canShare?.({ files: [new File(['<html>'], 'cancionero.html', { type: 'text/html' })] }); } catch (_) {}

  let ready = null, preparing = null, seq = 0, timer = 0, closed = false;
  const prepare = dlg => {
    clearTimeout(timer);
    const my = ++seq;
    ready = null;
    preparing = null;
    const info = dlg.querySelector('.share-info');
    const titulo = dlg.querySelector('#xTitle').value.trim();
    const chosen = [...dlg.querySelectorAll('.export-list input:checked')].map(c => songs[+c.dataset.i]);
    if (!titulo || !chosen.length) { info.textContent = ''; return; }
    info.textContent = 'Preparando el archivo…';
    preparing = prepareShareFile(titulo, chosen).then(r => {
      if (my === seq) { ready = r; info.innerHTML = shareSummaryHtml(r); }
      return r;
    }, e => {
      if (my === seq) info.textContent = 'No se pudo preparar: ' + e.message;
      throw e;
    });
    preparing.catch(() => {});
  };

  const deliver = (dlg, r) => {
    if (closed) return;
    const msg = `Cancionero «${r.titulo}» (${r.n} ${r.n === 1 ? 'canción' : 'canciones'}) para abrir y editar en ${APP_INFO.nombre}`;
    if (canShareFiles) {
      return navigator.share({ files: [r.file], title: r.titulo, text: msg }).then(() => dlg.close(), e => {
        if (e.name === 'AbortError') return;
        if (e.name === 'NotAllowedError') modalFail(dlg, 'El archivo ya está listo: vuelve a tocar «Enviar por WhatsApp».');
        else modalFail(dlg, 'No se pudo compartir: ' + e.message);
      });
    }
    return pickSaveTarget(r.fileName, 'text/html', '.html', 'Página web').then(async save => {
      const saved = save && await save(r.html);
      if (!saved) return;
      dlg.close();
      toast(`Guardado «${saved}». En WhatsApp adjúntalo como Documento.`, 7000);
    });
  };

  const send = dlg => {
    if (!bookPickerRead(dlg, songs)) return false;
    modalFail(dlg, '');
    if (ready) deliver(dlg, ready);
    else {
      if (!preparing) prepare(dlg);
      preparing.then(r => deliver(dlg, r), () => {});
    }
    return false;
  };

  await showModal({
    title: 'Compartir cancionero',
    body: `${bookPickerHtml(songs)}
      <p class="hint">Va <b>liviano</b>: letras, acordes, tags, instrumentos, rasgueos y los audios y partituras de internet.
        Se envía un archivo <b>.html</b> (en WhatsApp llega como <b>Documento</b>) que se ve en cualquier navegador y trae
        el botón «Editar en ${APP_INFO.nombre}» para abrirlo en la app, editarlo y guardarlo.</p>
      <p class="hint share-info"></p>`,
    onOpen: dlg => {
      bookPickerOpen(dlg);
      const form = dlg.querySelector('form');
      form.querySelector('#xTitle').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => prepare(dlg), 400); });
      form.addEventListener('change', e => { if (e.target.matches('.export-list input')) prepare(dlg); });
      form.querySelector('#xAll').addEventListener('click', () => prepare(dlg));
      form.querySelector('#xNone').addEventListener('click', () => prepare(dlg));
      prepare(dlg);
    },
    buttons: [
      { label: 'Cancelar' },
      { label: canShareFiles ? 'Enviar por WhatsApp…' : 'Guardar archivo…', primary: true, onClick: send }
    ]
  });
  closed = true;
  clearTimeout(timer);
  seq++;
}
