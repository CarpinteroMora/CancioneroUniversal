'use strict';
// Audio de YouTube, Vimeo, SoundCloud, TikTok… a través del servidor local de CancioTras
// (servidor/canciotras_servidor.py, que usa yt-dlp). El navegador por sí solo no puede
// sacar el audio de esas páginas; el servidor lo extrae, lo guarda en caché y lo entrega
// como un archivo de audio normal al reproductor. Una vez instalado, el sistema lo
// enciende solo cuando la app lo necesita: el usuario nunca tiene que iniciarlo.

const EXTRACTOR_PORT = 8777;

const extractorBase = () =>
  /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname) && location.port === String(EXTRACTOR_PORT)
    ? location.origin
    : `http://127.0.0.1:${EXTRACTOR_PORT}`;

// Opus/webm es el formato nativo de YouTube; Safari prefiere m4a
const extractorPref = () =>
  document.createElement('audio').canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'm4a';

const extractorQuery = src => `url=${encodeURIComponent(src)}&pref=${extractorPref()}`;
const extractorAudioUrl = src => `${extractorBase()}/api/audio?${extractorQuery(src)}`;

// Dirección fija para listas .m3u8: VLC y otros reproductores no saben sacar el audio de
// YouTube, pero sí escucharlo desde el servidor de CancioTras (el sistema lo enciende solo)
const EXTRACTOR_LIST_RE = /^https?:\/\/(127\.0\.0\.1|localhost):\d+\/api\/audio\?/i;
const extractorListUrl = src => `http://127.0.0.1:${EXTRACTOR_PORT}/api/audio?url=${encodeURIComponent(src)}&pref=webm`;
function extractorPageOf(uri) {
  if (!EXTRACTOR_LIST_RE.test(uri)) return null;
  try { return new URL(uri).searchParams.get('url'); } catch (_) { return null; }
}

// El primer uso puede tardar unos segundos mientras el sistema enciende el servidor
async function extractorStatus() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${extractorBase()}/api/estado`, { signal: ctrl.signal, cache: 'no-store' });
    const data = await r.json();
    return data?.app === 'CancioTras' ? data : null;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Obtiene el audio (o lo toma de la caché). Devuelve { titulo, duracion, plataforma, ext, tipo, tamano… }
async function extractorPrepare(src) {
  let r;
  try {
    r = await fetch(`${extractorBase()}/api/preparar?${extractorQuery(src)}`, { cache: 'no-store' });
  } catch (_) {
    const err = new Error('Cancionero Universal no pudo conectarse con su reproductor de videos.');
    err.offline = true;
    throw err;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new Error(data.error || 'No se pudo obtener el audio de esa página.');
  return data;
}

// Plataformas o páginas que no son un archivo de audio o video directo
function needsExtractor(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  const n = normalizeMediaUrl(url);
  if (n.streaming) return true;
  if (n.note) return false;
  return ![...AUDIO_EXT, ...VIDEO_EXT].includes(mediaExt(url));
}

const formatDuration = s => {
  if (!s && s !== 0) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

// Solo aparece si CancioTras nunca se abrió desde su icono (el primer arranque lo deja todo listo)
function showExtractorSetup(retry) {
  const win = /Windows/i.test(navigator.userAgent);
  return showModal({
    title: 'Un paso, solo la primera vez',
    body: `
      <p>Para escuchar videos de YouTube y otras páginas, abre Cancionero Universal una vez con
        <b>${win ? 'iniciar-canciotras.bat' : 'iniciar-canciotras.sh'}</b> (está en la carpeta de la app).</p>
      <p class="hint">Desde ese momento Cancionero Universal aparece en tu menú de aplicaciones y los videos suenan siempre, sin hacer nada más.</p>`,
    buttons: [{ label: 'Ahora no' }, ...(retry ? [{ label: 'Listo, reintentar', primary: true, value: 'retry' }] : [])]
  }).then(v => v === 'retry' && retry());
}

// Guarda en disco el audio y lo deja vinculado como archivo local
async function saveExtractedAudio() {
  const a = currentAudio();
  if (!a || !a.extractor) { toast('Este audio ya es un archivo de tu equipo'); return; }
  toast('Preparando el audio…', 60000);
  let info, blob;
  try {
    info = await extractorPrepare(a.src);
    blob = await (await fetch(extractorAudioUrl(a.src))).blob();
  } catch (err) {
    toast('');
    if (err.offline) showExtractorSetup(saveExtractedAudio); else toast(err.message, 6000);
    return;
  }
  toast('');
  const filename = safeFileName(a.name || info.titulo || 'audio') + '.' + info.ext;
  const saved = await saveFile(blob, filename, info.tipo, '.' + info.ext, 'Audio');
  if (!saved) return;
  if (a.objectUrl) URL.revokeObjectURL(a.objectUrl);
  Object.assign(a, { kind: 'local', src: './' + saved, objectUrl: URL.createObjectURL(blob), extractor: false, origin: a.src });
  updateAudioBar();
  refresh();
  scheduleSave();
  toast(`Audio guardado como "${saved}"`, 4000);
}
