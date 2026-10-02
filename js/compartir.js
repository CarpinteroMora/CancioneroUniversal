'use strict';
// Compartir un cancionero (por WhatsApp u otro medio). Va liviano: solo texto. Cada canción viaja
// como su .md (letra, acordes, tags, instrumentos, rasgueos…) con los audios y hojas de internet;
// los archivos del equipo se quedan. Dos formas de enviarlo:
//  - página .html (la del atril) con los datos adentro y un botón «Editar en Cancionero Universal»
//  - enlace a la app: WEB_APP_URL#cancionero=<datos comprimidos>
// Quien lo recibe lo abre en pestañas sin guardar y lo guarda en su carpeta con Guardar cancionero.

const SHARE_FORMAT = 'cancionero-compartido';
const SHARE_HASH = '#cancionero=';
const SHARE_LINK_MAX = 60000;        // WhatsApp corta los mensajes de más de ~65.000 caracteres
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

async function copyLink(link) {
  try {
    await navigator.clipboard.writeText(link);
  } catch (_) {
    const ta = el('textarea');
    ta.value = link;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Enlace copiado: pégalo en WhatsApp', 3000);
}

async function shareBookDialog() {
  syncFromEditor();
  const songs = docs.filter(d => !isBlank(d));
  if (!songs.length) { toast('No hay canciones abiertas para compartir'); return; }
  const res = await showModal({
    title: 'Compartir cancionero',
    body: `${bookPickerHtml(songs)}
      <p class="hint">Va <b>liviano</b>, para enviarlo por WhatsApp: letras, acordes, tags, instrumentos, rasgueos y los
        audios y partituras de internet. Quien lo recibe lo abre en Cancionero Universal y puede editarlo y guardarlo.</p>`,
    onOpen: bookPickerOpen,
    buttons: [{ label: 'Cancelar' }, { label: 'Preparar', primary: true, onClick: dlg => bookPickerRead(dlg, songs) }]
  });
  if (!res) return;

  const { titulo, chosen } = res;
  const { pkg, leftAudios, leftSheets } = buildSharePackage(chosen, titulo);
  const link = await packToLink(pkg);
  const html = new Blob([buildAtrilHtml(chosen, { titulo: chosen.length > 1 ? titulo : '', share: { pkg, link } })], { type: 'text/html' });
  const fileName = safeFileName(titulo) + '.html';
  const file = new File([html], fileName, { type: 'text/html' });
  let canShareFile = false;
  try { canShareFile = !!navigator.canShare?.({ files: [file] }); } catch (_) {}
  const linkOk = link.length <= SHARE_LINK_MAX;
  const n = chosen.length;
  const msg = `Cancionero «${titulo}» (${n} ${n === 1 ? 'canción' : 'canciones'}) para abrir y editar en ${APP_INFO.nombre}`;
  const left = [leftAudios && `${leftAudios === 1 ? '1 audio' : leftAudios + ' audios'}`, leftSheets && `${leftSheets === 1 ? '1 partitura' : leftSheets + ' partituras'}`].filter(Boolean);

  const sendFile = () => {
    if (canShareFile) {
      navigator.share({ files: [file], title: titulo, text: msg }).catch(() => {});
      return false;
    }
    pickSaveTarget(fileName, 'text/html', '.html', 'Página web').then(async save => {
      const saved = save && await save(html);
      if (saved) toast(`Guardado «${saved}». En WhatsApp adjúntalo como Documento.`, 7000);
    });
    return false;
  };
  const sendLink = () => {
    if (navigator.share) navigator.share({ title: titulo, text: msg, url: link }).catch(() => {});
    else copyLink(link);
    return false;
  };

  await showModal({
    title: 'Compartir cancionero',
    body: `<p><b>«${escapeHtml(titulo)}»</b>: ${n} ${n === 1 ? 'canción' : 'canciones'}.
        Archivo de ${fmtSize(html.size)} · enlace de ${link.length.toLocaleString('es')} caracteres.</p>
      ${left.length ? `<p class="hint">${left.join(' y ')} de tu equipo no ${leftAudios + leftSheets > 1 ? 'viajan' : 'viaja'}: los enlaces de internet sí.</p>` : ''}
      <ul class="share-ways">
        <li><b>Archivo:</b> se ve en cualquier navegador, con tono, modo noche y desplazamiento, y trae el botón
          «Editar en Cancionero Universal». En WhatsApp va como <b>Documento</b>.</li>
        <li><b>Enlace:</b> al tocarlo se abre la app directamente con el cancionero.
          ${linkOk ? '' : '<br><b class="share-warn">Es muy largo para un enlace: envía el archivo.</b>'}</li>
      </ul>`,
    onOpen: dlg => {
      if (linkOk) return;
      dlg.querySelectorAll('.modal-actions .btn').forEach(b => { if (/enlace/i.test(b.textContent)) b.disabled = true; });
    },
    buttons: [
      { label: 'Cerrar' },
      { label: 'Copiar enlace', onClick: () => { if (linkOk) copyLink(link); return false; } },
      { label: 'Enviar enlace', onClick: () => linkOk ? sendLink() : false },
      { label: canShareFile ? 'Enviar archivo…' : 'Guardar archivo…', primary: true, onClick: sendFile }
    ]
  });
}
