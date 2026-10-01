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

// Página de origen de un audio que solo suena con el servidor (YouTube…), o null
const audioPage = a => extractorPageOf(a.src) || (a.extractor ? a.src : null) ||
  (a.kind === 'local' && !a.objectUrl && /^https?:\/\//i.test(a.origin || '') ? a.origin : null);

// En la página web pública, preguntar por 127.0.0.1 hace que Chrome pida permiso de «red local»
// a cada visitante: solo se consulta si el usuario lo pidió alguna vez y el servidor respondió.
const ON_PUBLIC_WEB = location.protocol !== 'file:' && !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
const WEB_SERVER_KEY = 'canciotras-servidor-web';
const extractorAllowed = () => !ON_PUBLIC_WEB || localStorage.getItem(WEB_SERVER_KEY) === '1';

// Último resultado conocido (null = sin comprobar); se vuelve a mirar como máximo cada 30 s
let extractorOnline = null, extractorCheckedAt = 0, extractorChecking = null;
function refreshExtractorOnline(force = false) {
  if (!force && extractorOnline !== null && Date.now() - extractorCheckedAt < 30000) return Promise.resolve(extractorOnline);
  if (!extractorChecking) {
    extractorChecking = extractorStatus().then(s => {
      extractorOnline = !!s;
      extractorCheckedAt = Date.now();
      extractorChecking = null;
      return extractorOnline;
    });
  }
  return extractorChecking;
}

function openAudioPage(a) {
  const url = a && audioPage(a);
  if (url) window.open(url, '_blank', 'noopener');
}

// El primer uso puede tardar unos segundos mientras el sistema enciende el servidor
async function extractorStatus() {
  if (!extractorAllowed()) return null;
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
    if (!extractorAllowed()) throw new Error('web');
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

const INSTALLER_URLS = {
  windows: 'https://github.com/CarpinteroMora/CancioneroUniversal/releases/latest/download/CancioneroUniversal-Windows.exe',
  script: 'https://carpinteromora.github.io/CancioneroUniversal/instalar.sh'
};
const INSTALL_CMD = `curl -fsSL ${INSTALLER_URLS.script} | bash`;
const OS_NAMES = { windows: 'Windows', linux: 'Linux', mac: 'Mac' };

function detectOS() {
  const p = navigator.userAgentData?.platform || navigator.userAgent || '';
  return /Win/i.test(p) ? 'windows' : /Mac/i.test(p) ? 'mac' : 'linux';
}

function installStepHtml(os) {
  if (os === 'windows') return `
    <a class="btn primary install-get" href="${INSTALLER_URLS.windows}" download>Descargar el instalador para Windows</a>
    <p class="hint">Ábrelo con doble clic cuando termine de descargarse. Si Windows muestra «Windows protegió su PC»,
      pulsa <b>Más información</b> y luego <b>Ejecutar de todas formas</b> (el programa es libre y no está firmado).</p>`;
  return `
    <p>${os === 'mac' ? 'Abre la <b>Terminal</b> (Cmd+Espacio, escribe «Terminal» y pulsa Enter)'
      : 'Abre la <b>Terminal</b> (Ctrl+Alt+T)'}, pega este comando y pulsa Enter:</p>
    <div class="install-cmd"><code>${escapeHtml(INSTALL_CMD)}</code>
      <button type="button" class="btn primary install-copy">Copiar</button></div>
    <p class="hint">Descarga Cancionero Universal, lo deja funcionando en segundo plano y lo agrega a tu menú de aplicaciones.
      Necesita Python 3 (casi siempre ya está instalado).</p>`;
}

// «Instalar reproducción en local»: entrega el instalador de este sistema, espera a que el servidor
// responda y entonces habilita «Reproducir». Solo se abre a pedido, nunca solo.
async function showLocalInstall(retry) {
  if (!ON_PUBLIC_WEB) return showLocalLauncher(retry);
  let os = detectOS(), waiting = false, ready = false, closed = false;
  const page = currentAudio() && audioPage(currentAudio());
  const site = page && (normalizeMediaUrl(page).streaming || 'su página');
  await showModal({
    title: 'Instalar reproducción en local',
    body: `
      <p>Para que los videos de YouTube suenen aquí mismo (con su velocidad), este PC necesita el
        reproductor local de Cancionero Universal. Se instala una sola vez.</p>
      <h3 class="install-title">1. Instalar en <span class="install-os"></span></h3>
      <div class="install-step"></div>
      <p class="install-other"></p>
      <h3 class="install-title">2. Reproducir</h3>
      <p class="install-status">Cuando termine la instalación se activa el botón <b>Reproducir</b>.</p>
      <p class="hint">Si el navegador pide permiso para acceder a dispositivos de tu red local, pulsa <b>Permitir</b>:
        así esta página puede usar el reproductor que acabas de instalar.</p>
      ${page ? `<p class="install-skip"><a href="#" data-skip>Ahora no: abrir en ${escapeHtml(site)}</a></p>` : ''}`,
    buttons: [{ label: 'Cerrar' }, { label: 'Reproducir', primary: true, onClick: () => ready ? 'play' : false }],
    onOpen: dlg => {
      const playBtn = dlg.querySelector('.modal-actions .primary');
      const status = dlg.querySelector('.install-status');
      playBtn.disabled = true;
      const render = () => {
        dlg.querySelector('.install-os').textContent = OS_NAMES[os];
        dlg.querySelector('.install-step').innerHTML = installStepHtml(os);
        dlg.querySelector('.install-other').innerHTML = '¿Otro sistema? ' + Object.keys(OS_NAMES).filter(k => k !== os)
          .map(k => `<a href="#" data-os="${k}">${OS_NAMES[k]}</a>`).join(' · ');
      };
      const wait = async () => {
        if (waiting) return;
        waiting = true;
        localStorage.setItem(WEB_SERVER_KEY, '1');
        status.innerHTML = '<span class="install-spin"></span> Esperando la instalación…';
        const until = Date.now() + 15 * 60000;
        while (!closed && Date.now() < until) {
          if (await extractorStatus()) {
            ready = true;
            extractorOnline = true;
            extractorCheckedAt = Date.now();
            status.innerHTML = '✅ Listo: el reproductor local está funcionando. Pulsa <b>Reproducir</b>.';
            playBtn.disabled = false;
            playBtn.focus();
            return;
          }
          await new Promise(r => setTimeout(r, 3000));
        }
        waiting = false;
        if (!closed) status.textContent = 'No encuentro el reproductor local todavía. Vuelve a pulsar Descargar o Copiar para seguir esperando.';
      };
      dlg.querySelector('.modal-body').addEventListener('click', async e => {
        const other = e.target.closest('[data-os]');
        if (other) { e.preventDefault(); os = other.dataset.os; render(); return; }
        if (e.target.closest('[data-skip]')) {
          e.preventDefault();
          window.open(page, '_blank', 'noopener');
          dlg.close();
          return;
        }
        if (e.target.closest('.install-get')) wait();
        if (e.target.closest('.install-copy')) {
          wait();
          try { await navigator.clipboard.writeText(INSTALL_CMD); e.target.textContent = 'Copiado ✓'; } catch (_) {
            const range = document.createRange();
            range.selectNodeContents(dlg.querySelector('.install-cmd code'));
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            e.target.textContent = 'Cópialo (Ctrl+C)';
          }
        }
      });
      render();
    }
  });
  closed = true;
  if (!ready) {
    localStorage.removeItem(WEB_SERVER_KEY);
    return;
  }
  updateAudioBar();
  $('#audioPlayer').play().catch(() => {});
  retry?.();
}

// App abierta desde su carpeta (file:// o el propio servidor): basta con abrirla una vez con su lanzador
async function showLocalLauncher(retry) {
  const launcher = /Windows/i.test(navigator.userAgent) ? 'iniciar-canciotras.bat' : 'iniciar-canciotras.sh';
  const v = await showModal({
    title: 'Escuchar los videos dentro de la app',
    body: `
      <p>Para escuchar videos de YouTube y otras páginas, abre Cancionero Universal una vez con
        <b>${launcher}</b> (está en la carpeta de la app).</p>
      <p class="hint">Desde ese momento Cancionero Universal aparece en tu menú de aplicaciones y los videos suenan siempre, sin hacer nada más.</p>`,
    buttons: [{ label: 'Ahora no' }, { label: 'Listo, reintentar', primary: true, value: 'retry' }]
  });
  if (v !== 'retry') return;
  if (await refreshExtractorOnline(true)) {
    updateAudioBar();
    retry?.();
    return;
  }
  toast(`Todavía no encuentro Cancionero Universal en este equipo. Ábrelo con ${launcher} y vuelve a probar.`, 7000);
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
    if (err.offline) showLocalInstall(saveExtractedAudio); else toast(err.message, 6000);
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
