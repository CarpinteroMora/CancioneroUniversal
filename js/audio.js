'use strict';
// Audios vinculados a cada canción y barra de reproducción inferior (solo controles).
// Se aceptan archivos de audio o de video; los videos se reproducen solo como audio.

const AUDIO_EXT = ['mp3', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac', 'flac', 'weba', 'wma', 'amr'];
const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv', '3gp', 'avi', 'mpeg', 'mpg'];
const MEDIA_ACCEPT = 'audio/*,video/*,' + [...AUDIO_EXT, ...VIDEO_EXT].map(e => '.' + e).join(',');

const mediaExt = src => (String(src).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
// Las grabaciones (Herramientas → Grabar) son .webm de solo audio y van en una carpeta «audios»
const isRecordingSrc = src => mediaExt(src) === 'webm' && /(^|\/)audios?\//i.test(String(src));
const isVideoSrc = src => VIDEO_EXT.includes(mediaExt(src)) && !isRecordingSrc(src);
const isMediaFile = f => /^(audio|video)\//.test(f.type) || [...AUDIO_EXT, ...VIDEO_EXT].includes(mediaExt(f.name));

// Páginas de plataformas: no son archivos; su audio se obtiene con el servidor local (extractor.js)
const STREAMING_SITES = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'],
  [/(^|\.)vimeo\.com$/, 'Vimeo'],
  [/(^|\.)spotify\.com$/, 'Spotify'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud'],
  [/(^|\.)deezer\.com$/, 'Deezer'],
  [/(^|\.)music\.apple\.com$/, 'Apple Music'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)facebook\.com$|(^|\.)fb\.watch$/, 'Facebook']
];

// Convierte enlaces "para compartir" en enlaces directos al archivo
function normalizeMediaUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (_) { return { url: raw }; }
  const host = u.hostname.toLowerCase();
  const site = STREAMING_SITES.find(([re]) => re.test(host));
  if (site) return { url: raw, streaming: site[1] };

  if (/(^|\.)dropbox\.com$/.test(host)) {
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    return { url: u.toString(), note: 'Enlace de Dropbox convertido a descarga directa.' };
  }
  if (host === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || u.searchParams.get('id');
    if (id) return { url: `https://drive.google.com/uc?export=download&id=${id}`, note: 'Enlace de Google Drive convertido a descarga directa (el archivo debe ser público).' };
  }
  if (host === 'github.com') {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (m) return { url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`, note: 'Enlace de GitHub convertido a archivo directo.' };
  }
  return { url: u.toString() };
}

function normalizeAudio(a) {
  const kind = a.kind || (isAbsoluteUrl(a.src) ? 'url' : 'local');
  const item = {
    id: a.id || uid(),
    name: a.name || fileBase(a.src),
    src: a.src,
    kind,
    voice: a.voice || 'todas',
    objectUrl: a.objectUrl || null,
    extractor: kind === 'url' && (a.extractor ?? !!normalizeMediaUrl(a.src).streaming)
  };
  if (a.origin) item.origin = a.origin;
  if (a.speed && a.speed !== 1) item.speed = clampSpeed(a.speed);
  return item;
}

// Velocidad de reproducción por audio (el tono se mantiene: más lento no suena más grave)
const SPEED_MIN = 0.25, SPEED_MAX = 1.5;
const clampSpeed = v => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round((+v || 1) * 20) / 20));
const speedText = v => String(Math.round(v * 100) / 100).replace('.', ',') + '×';

function applySpeed() {
  const v = currentAudio()?.speed || 1;
  const p = $('#audioPlayer');
  p.preservesPitch = true;
  p.defaultPlaybackRate = v;
  p.playbackRate = v;
  $('#speedRange').value = v;
  const label = $('#speedLabel');
  label.textContent = speedText(v);
  label.classList.toggle('slow', v < 1);
  label.classList.toggle('fast', v > 1);
  ytApplySpeed();
}

// YouTube solo acepta velocidades de a 0,25
const ytSpeedMode = () => $('#audioBar').classList.contains('yt-mode');
const speedStep = () => ytSpeedMode() ? 0.25 : 0.05;

function setSpeed(v) {
  const a = currentAudio();
  if (!a) return;
  v = clampSpeed(ytSpeedMode() ? Math.round(v * 4) / 4 : v);
  if (v === 1) delete a.speed; else a.speed = v;
  applySpeed();
  scheduleSave();
}

$('#speedRange').addEventListener('input', e => setSpeed(e.target.value));
$('#speedDown').addEventListener('click', () => setSpeed((currentAudio()?.speed || 1) - speedStep()));
$('#speedUp').addEventListener('click', () => setSpeed((currentAudio()?.speed || 1) + speedStep()));
$('#speedLabel').addEventListener('click', () => setSpeed(1));
document.querySelectorAll('.speed button').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
$('#audioPlayer').addEventListener('loadedmetadata', applySpeed);

function currentAudio(d = cur()) {
  return d?.audios.find(a => a.id === d.currentAudioId) || null;
}

function addAudio(a, select = true, d = cur()) {
  const item = normalizeAudio(a);
  d.audios.push(item);
  if (select || !d.currentAudioId) d.currentAudioId = item.id;
  if (d === cur()) updateAudioBar();
  refresh();
  return item;
}

function revokeDocAudios(d) {
  d.audios.forEach(a => a.objectUrl && URL.revokeObjectURL(a.objectUrl));
}

// El mismo audio (misma ruta y voz) una sola vez
function uniqueAudios(list) {
  const seen = new Set();
  return (list || []).filter(a => {
    const k = `${a.src}|${a.voice || 'todas'}`;
    return !seen.has(k) && seen.add(k);
  });
}

// Un archivo local que no aparece se escucha desde la página de donde salió (si se sabe)
const canUseOrigin = a => a.kind === 'local' && !a.objectUrl && /^https?:\/\//i.test(a.origin || '');

const audioPlayableSrc = a => a.objectUrl ||
  (a.viaOrigin && canUseOrigin(a) ? extractorAudioUrl(a.origin)
    : a.extractor ? extractorAudioUrl(a.src) : a.kind === 'url' ? a.src : encodePath(a.src));
const audioLabel = a => (a.extractor ? '📺 ' : isVideoSrc(a.src) ? '🎬 ' : '') + a.name +
  (a.voice !== 'todas' && VOICES[a.voice] ? ` · ${VOICES[a.voice].label}` : '');

// Sin el servidor del PC, estos audios se abren en su página (YouTube…) en vez de sonar aquí
const needsServer = a => !a.objectUrl && !!audioPage(a) &&
  (a.extractor || (a.viaOrigin && canUseOrigin(a)) || !!extractorPageOf(a.src));
const serverReady = () => extractorAllowed() && extractorOnline !== false;

function updateAudioBar() {
  const d = cur();
  const bar = $('#audioBar'), sel = $('#audioSelect'), player = $('#audioPlayer');
  if (!d || !d.audios.length) {
    ytSync(null);
    bar.hidden = true;
    document.body.classList.remove('has-audio');
    if (player.dataset.src) {
      player.dataset.src = '';
      player.removeAttribute('src');
      player.load();
    }
    return;
  }
  bar.hidden = false;
  document.body.classList.add('has-audio');
  if (!currentAudio(d)) d.currentAudioId = d.audios[0].id;
  sel.hidden = d.audios.length < 2;
  sel.innerHTML = d.audios.map(a =>
    `<option value="${a.id}"${a.id === d.currentAudioId ? ' selected' : ''}>${escapeHtml(audioLabel(a))}</option>`).join('');
  const a = currentAudio(d);
  $('#relinkBtn').hidden = !(a.kind === 'local' && !a.objectUrl && canPickFiles);
  const viaPage = needsServer(a);
  if (viaPage && extractorAllowed()) {
    const before = extractorOnline;
    refreshExtractorOnline().then(ok => ok !== before && updateAudioBar());
  }
  const pageMode = viaPage && !serverReady();
  // Sin servidor: en el celular YouTube suena en la mini ventana; en el PC se instala el servidor
  const embed = pageMode && youtubeEmbedOk(a);
  bar.classList.toggle('page-mode', pageMode && !embed);
  bar.classList.toggle('yt-mode', embed);
  $('#speedRange').step = embed ? 0.25 : 0.05;
  $('#pageBtn').hidden = !pageMode;
  $('#installBtn').hidden = true;
  ytSync(embed ? a : null);
  if (pageMode) {
    if (embed) {
      ytUpdateButton();
      applySpeed();
    } else {
      $('#pageBtn').textContent = isMobileDevice()
        ? `▶ Escuchar en ${normalizeMediaUrl(audioPage(a)).streaming || 'su página'}`
        : '▶ Reproducir aquí';
    }
    if (player.dataset.src) {
      player.dataset.src = '';
      player.removeAttribute('src');
      player.load();
    }
    return;
  }
  const src = audioPlayableSrc(a);
  if (player.dataset.src !== src) {
    player.dataset.src = src;
    player.src = src;
  }
  applySpeed();
}

$('#audioSelect').addEventListener('change', e => {
  cur().currentAudioId = e.target.value;
  updateAudioBar();
  scheduleSave();
});

// Cuando un audio suena, se olvidan los reintentos: la próxima falla vuelve a intentarse
$('#audioPlayer').addEventListener('playing', () => {
  const a = currentAudio();
  if (a) a.retries = 0;
});

const reloadAudio = () => { $('#audioPlayer').dataset.src = ''; updateAudioBar(); };

$('#pageBtn').addEventListener('click', () => {
  const a = currentAudio();
  if ($('#audioBar').classList.contains('yt-mode')) ytToggle(a);
  else if (isMobileDevice()) openAudioPage(a);
  else showLocalInstall();
});
$('#installBtn').addEventListener('click', () => showLocalInstall());

$('#audioPlayer').addEventListener('error', async () => {
  const a = currentAudio();
  if (!a || !$('#audioPlayer').dataset.src) return;
  const fromPage = a.extractor || (a.viaOrigin && canUseOrigin(a));
  if (fromPage && !a.objectUrl) {
    const page = a.extractor ? a.src : a.origin;
    if (!await refreshExtractorOnline(true)) {
      updateAudioBar();
      return;
    }
    try {
      await extractorPrepare(page);
    } catch (err) {
      toast(`"${a.name}": ${err.message}`, 7000);
      return;
    }
    // Un solo reintento: recargar el reproductor una y otra vez lo hace parpadear
    if ((a.retries = (a.retries || 0) + 1) <= 1) { reloadAudio(); return; }
    a.retries = 0;
    $('#audioPlayer').dataset.src = '';
    toast(`No se pudo reproducir "${a.name}". Vuelve a esta canción para intentarlo de nuevo.`, 6000);
  } else if (a.kind === 'url' && !a.objectUrl && /^https?:\/\//i.test(a.src) && !a.fallbackTried) {
    // El enlace no era un archivo reproducible: se intenta sacar el audio de la página
    a.fallbackTried = true;
    if (await extractorStatus()) {
      a.extractor = true;
      updateAudioBar();
      scheduleSave();
    } else {
      toast(`No se pudo reproducir "${a.name}".`, 5000);
    }
  } else if (a.kind === 'local' && !a.objectUrl) {
    if (!await relinkDocAudios(cur())) return;
    if (canUseOrigin(a) && !a.viaOrigin && await extractorStatus()) {
      a.viaOrigin = true;
      toast(`No encuentro el archivo de "${a.name}": lo escucho desde su página original.`, 5000);
      reloadAudio();
      return;
    }
    toast(canPickFiles
      ? `Para escuchar "${a.name}" pulsa "Activar audios de la carpeta".`
      : `No se encuentra el archivo de "${a.name}". Vuelve a elegirlo en Herramientas → Vincular con audio o video local.`, 6000);
  } else {
    toast(`No se pudo reproducir "${a.name}".`, 5000);
  }
});

const voiceOptionsHtml = selected =>
  `<option value="todas">Todas las voces</option>` +
  VOICE_ORDER.filter(v => v !== 'unica').map(v =>
    `<option value="${v}"${v === selected ? ' selected' : ''}>${VOICES[v].label}</option>`).join('');

// Vincula un archivo del equipo (audio o video) a la canción activa. Con `handle` se recuerda
// dónde está el archivo, para calcular su ruta real y volver a encontrarlo al abrir.
async function attachLocalFile(file, { handle = null, name = fileBase(file.name), voice = 'todas' } = {}) {
  const d = cur();
  const objectUrl = URL.createObjectURL(file);
  let item = d.audios.find(a => a.kind === 'local' && fileBase(a.src, true) === file.name);
  if (item) {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    Object.assign(item, { objectUrl, name, voice });
    d.currentAudioId = item.id;
    updateAudioBar();
    refresh();
  } else {
    item = addAudio({ kind: 'local', src: './' + file.name, name, voice, objectUrl });
  }
  let note = '';
  if (handle) {
    rememberLinkHandle('audio:' + item.id, handle);
    const dir = await savedSongsFolder();
    if (dir) item.src = await linkedPath('audio:' + item.id, item.src, dir, (await docDirParts(d, dir)) || []);
    if (await outsideSongsFolder(handle)) note = ' (está fuera de la carpeta de canciones: en otro equipo habrá que volver a vincularlo)';
  }
  scheduleSave();
  toast(`Listo: ${name}${note}`, note ? 6000 : 2600);
}

// Elegir archivo empezando en la carpeta de canciones (Chrome/Edge) o con el selector clásico
async function pickLocalMedia() {
  if (!canPickFiles) return null;
  try {
    const [handle] = await window.showOpenFilePicker({
      startIn: (await savedSongsFolder()) || 'music',
      types: [{ description: 'Audio o video', accept: { 'audio/*': AUDIO_EXT.map(e => '.' + e), 'video/*': VIDEO_EXT.map(e => '.' + e) } }]
    });
    return { handle, file: await handle.getFile() };
  } catch (e) {
    return e.name === 'AbortError' ? false : null;
  }
}

async function linkLocalAudio() {
  let chosen = null;
  const res = await showModal({
    title: 'Vincular con audio o video local',
    body: `
      <p class="hint">Canción: <b>${escapeHtml(cur().title)}</b></p>
      <div class="field"><span>Archivo de audio o video</span>
        <div class="pick-row"><button type="button" class="btn" id="mPick">Elegir archivo…</button>
        <span id="mChosen" class="hint">Ninguno</span></div>
        <input type="file" id="mFile" accept="${MEDIA_ACCEPT}" hidden></div>
      <p class="hint">No se copia: se recuerda dónde está. Si es un video, se escucha solo el audio.
        También puedes arrastrar el archivo sobre la canción.</p>
      <label class="field"><span>Nombre</span><input type="text" id="mName"></label>
      <label class="field"><span>Voz</span><select id="mVoice">${voiceOptionsHtml(state.highlight)}</select></label>`,
    onOpen: d => {
      const name = d.querySelector('#mName');
      name.oninput = () => { name.dataset.touched = '1'; };
      const choose = c => {
        chosen = c;
        d.querySelector('#mChosen').textContent = c.file.name;
        if (!name.dataset.touched) name.value = fileBase(c.file.name);
      };
      d.querySelector('#mPick').onclick = async () => {
        const c = await pickLocalMedia();
        if (c) choose(c); else if (c === null) d.querySelector('#mFile').click();
      };
      d.querySelector('#mFile').onchange = e => e.target.files[0] && choose({ file: e.target.files[0], handle: null });
    },
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Vincular', primary: true,
        onClick: d => {
          if (!chosen) return modalFail(d, 'Elige un archivo de audio o video.');
          return {
            name: d.querySelector('#mName').value.trim() || fileBase(chosen.file.name),
            voice: d.querySelector('#mVoice').value
          };
        }
      }
    ]
  });
  if (res) attachLocalFile(chosen.file, { ...res, handle: chosen.handle });
}

const DRM_SITES = ['Spotify', 'Apple Music', 'Deezer'];

// Añade a la canción el audio de un enlace: página de video (YouTube…) o archivo directo
async function addAudioFromUrl(url, { name = '', voice = 'todas' } = {}) {
  const normalized = isAbsoluteUrl(url) ? normalizeMediaUrl(url) : { url };
  const src = normalized.url;
  if (!needsExtractor(src)) {
    addAudio({ kind: isAbsoluteUrl(src) ? 'url' : 'local', src, name: name || fileBase(src) || 'Audio', voice, extractor: false });
    toast(`Listo: ${name || fileBase(src) || 'audio'}`);
    return;
  }
  const d = cur();
  toast('Preparando el audio…', 600000);
  try {
    const info = await extractorPrepare(src);
    const title = name || info.titulo || 'Audio';
    addAudio({ kind: 'url', src, name: title, voice, extractor: true }, true, d);
    scheduleSave();
    toast(`Listo: ${title}${info.duracion ? ` (${formatDuration(info.duracion)})` : ''}`, 4000);
  } catch (err) {
    toast('');
    if (!err.offline) { toast(err.message, 7000); return; }
    const site = normalized.streaming || 'su página';
    const title = name || (normalized.streaming ? `Video de ${normalized.streaming}` : 'Audio');
    extractorOnline = false;
    extractorCheckedAt = Date.now();
    addAudio({ kind: 'url', src, name: title, voice, extractor: true }, true, d);
    scheduleSave();
    toast(`Listo: ${title}. Sin el servidor del PC se escuchará en ${site}.`, 6000);
  }
}

async function linkUrlAudio() {
  const res = await showModal({
    title: 'Vincular con audio o video por URL',
    body: `
      <p class="hint">Canción: <b>${escapeHtml(cur().title)}</b></p>
      <label class="field"><span>Enlace</span>
        <input type="text" id="mUrl" placeholder="Pega aquí el enlace de YouTube, SoundCloud, un mp3…"></label>
      <p class="hint">Sirve cualquier enlace de video o de audio: se escucha solo el audio.</p>
      <label class="field"><span>Nombre <small>(si lo dejas vacío, se usa el título del video)</small></span><input type="text" id="mName"></label>
      <label class="field"><span>Voz</span><select id="mVoice">${voiceOptionsHtml(state.highlight)}</select></label>`,
    onOpen: d => d.querySelector('#mUrl').focus(),
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Vincular', primary: true,
        onClick: d => {
          const url = d.querySelector('#mUrl').value.trim();
          if (!url) return modalFail(d, 'Pega un enlace.');
          if (isAbsoluteUrl(url)) {
            try { new URL(url); } catch (_) { return modalFail(d, 'Ese enlace no es válido.'); }
          }
          const site = isAbsoluteUrl(url) && normalizeMediaUrl(url).streaming;
          if (DRM_SITES.includes(site)) {
            return modalFail(d, `${site} no deja escuchar su música fuera de su app. Busca la misma canción en YouTube.`);
          }
          return { url, name: d.querySelector('#mName').value.trim(), voice: d.querySelector('#mVoice').value };
        }
      }
    ]
  });
  if (res) addAudioFromUrl(res.url, res);
}

// Arrastrar archivos de audio o video, o un enlace (por ejemplo desde YouTube), sobre la página
// los vincula a la canción activa. Sobre el editor, un enlace se escribe como texto.
const draggedLink = e => e.target !== editor && [...(e.dataTransfer?.types || [])].includes('text/uri-list');
document.addEventListener('dragover', e => {
  if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file') || draggedLink(e)) e.preventDefault();
});
document.addEventListener('drop', async e => {
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) {
    if (!draggedLink(e)) return;
    const url = e.dataTransfer.getData('text/uri-list').split('\n').find(l => /^https?:\/\//i.test(l.trim()))?.trim();
    if (!url) return;
    e.preventDefault();
    if (isSheetUrl(url)) { addSheetFromUrl(url); return; }
    const site = normalizeMediaUrl(url).streaming;
    if (DRM_SITES.includes(site)) { toast(`${site} no deja escuchar su música fuera de su app.`, 5000); return; }
    addAudioFromUrl(url, { voice: state.highlight });
    return;
  }
  e.preventDefault();
  // Los handles hay que pedirlos antes del primer await: después el navegador los invalida
  const handles = [...e.dataTransfer.items].filter(i => i.kind === 'file')
    .map(i => i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null));
  const found = await Promise.all(handles);
  const handleFor = f => found.find(h => h?.kind === 'file' && h.name === f.name) || null;
  const media = files.filter(isMediaFile), sheets = files.filter(isSheetFile);
  const songs = files.filter(f => !media.includes(f) && !sheets.includes(f) && /\.(md|markdown|txt|cho|crd|chopro|chordpro|pro|m3u8?)$/i.test(f.name));
  if (!media.length && !sheets.length && !songs.length) {
    toast('Arrastra canciones (.md), audios, videos, partituras (imagen, PDF, MusicXML) o tablaturas (Guitar Pro)', 4000);
    return;
  }
  // Canciones: cada una en su pestaña, vinculada a su archivo para poder guardarla ahí mismo
  if (songs.length) await openFiles(songs.map(f => ({ file: f, handle: handleFor(f) })));
  for (const f of media) await attachLocalFile(f, { handle: handleFor(f), voice: state.highlight === 'todas' ? 'todas' : state.highlight });
  for (const f of sheets) await addSheetFromFile(f, handleFor(f));
});

function removeCurrentAudio() {
  const d = cur();
  const a = currentAudio(d);
  if (!a) { toast('Esta canción no tiene audio vinculado'); return; }
  if (!confirm(`¿Quitar el audio "${a.name}" de "${d.title}"?`)) return;
  forgetLinkHandle('audio:' + a.id);
  if (a.objectUrl) URL.revokeObjectURL(a.objectUrl);
  d.audios = d.audios.filter(x => x !== a);
  d.currentAudioId = d.audios[0]?.id ?? null;
  updateAudioBar();
  refresh();
}
