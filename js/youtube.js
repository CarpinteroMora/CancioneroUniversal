'use strict';
// YouTube dentro de la app en teléfonos y tablets (sin servidor local): el reproductor oficial
// va en una mini ventana flotante, así la app sigue a la vista mientras suena.
// Las reglas de YouTube piden que el video se vea, con al menos 200x200 px.

function youtubeId(url) {
  let u;
  try { u = new URL(url); } catch (_) { return null; }
  const host = u.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    id = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1];
  }
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}

// YouTube rechaza el reproductor insertado en páginas abiertas como archivo (file://)
const youtubeEmbedOk = a => isMobileDevice() && location.protocol !== 'file:' && !a.noEmbed &&
  !!youtubeId(audioPage(a) || '');

const yt = { player: null, id: null, audioId: null, state: -1, big: false };
let ytApiPromise = null;

function ytApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      loadScript('https://www.youtube.com/iframe_api').catch(err => { ytApiPromise = null; reject(err); });
    });
  }
  return ytApiPromise;
}

// ============ MINI VENTANA ============
const ytMini = el('div', 'yt-mini');
ytMini.id = 'ytMini';
ytMini.hidden = true;
ytMini.innerHTML = `<div class="yt-mini-bar" title="Arrastra para moverla">
    <span class="yt-mini-grip">⠿ YouTube</span>
    <button type="button" data-yt="size" title="Agrandar o achicar">⤢</button>
    <button type="button" data-yt="open" title="Abrir en la app de YouTube">↗</button>
    <button type="button" data-yt="close" title="Detener y cerrar">×</button>
  </div>
  <div class="yt-mini-video"><div id="ytPlayer"></div></div>`;
document.body.appendChild(ytMini);

const YT_POS_KEY = 'canciotras-yt-posicion';

function ytPlace(pos) {
  const r = ytMini.getBoundingClientRect();
  const maxX = Math.max(0, window.innerWidth - r.width), maxY = Math.max(0, window.innerHeight - r.height);
  if (!pos) {
    try { pos = JSON.parse(localStorage.getItem(YT_POS_KEY)); } catch (_) { pos = null; }
  }
  // Sin posición guardada: abajo a la derecha, sobre las barras
  if (!pos) {
    const bottom = (parseFloat(getComputedStyle(document.body).getPropertyValue('--atril-h')) || 0) +
      ($('#audioBar').hidden ? 0 : $('#audioBar').offsetHeight) + 8;
    pos = { x: maxX - 8, y: window.innerHeight - r.height - bottom };
  }
  ytMini.style.left = Math.min(maxX, Math.max(0, pos.x)) + 'px';
  ytMini.style.top = Math.min(maxY, Math.max(0, pos.y)) + 'px';
}

function ytSetBig(big) {
  yt.big = big;
  ytMini.classList.toggle('big', big);
  const r = ytMini.getBoundingClientRect();
  ytPlace({ x: r.left, y: r.top });
}

let ytDrag = null;
ytMini.querySelector('.yt-mini-bar').addEventListener('pointerdown', e => {
  if (e.target.closest('button')) return;
  const r = ytMini.getBoundingClientRect();
  ytDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  e.currentTarget.setPointerCapture(e.pointerId);
  ytMini.classList.add('dragging');
});
ytMini.querySelector('.yt-mini-bar').addEventListener('pointermove', e => {
  if (ytDrag) ytPlace({ x: e.clientX - ytDrag.dx, y: e.clientY - ytDrag.dy });
});
const ytDragEnd = () => {
  if (!ytDrag) return;
  ytDrag = null;
  ytMini.classList.remove('dragging');
  const r = ytMini.getBoundingClientRect();
  localStorage.setItem(YT_POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
};
ytMini.querySelector('.yt-mini-bar').addEventListener('pointerup', ytDragEnd);
ytMini.querySelector('.yt-mini-bar').addEventListener('pointercancel', ytDragEnd);
window.addEventListener('resize', () => { if (!ytMini.hidden) ytPlace(); });

ytMini.addEventListener('click', e => {
  const b = e.target.closest('[data-yt]');
  if (!b) return;
  if (b.dataset.yt === 'size') ytSetBig(!yt.big);
  if (b.dataset.yt === 'close') { ytClose(); updateAudioBar(); }
  if (b.dataset.yt === 'open') {
    const a = currentAudio();
    yt.player?.pauseVideo?.();
    openAudioPage(a);
  }
});

// ============ REPRODUCTOR ============
const ytPlaying = () => yt.state === 1 || yt.state === 3;

function ytUpdateButton() {
  if (!$('#audioBar').classList.contains('yt-mode')) return;
  $('#pageBtn').textContent = ytPlaying() ? '⏸ Pausa' : '▶ Reproducir aquí';
}

function ytApplySpeed() {
  const p = yt.player;
  if (!p?.setPlaybackRate) return;
  const v = currentAudio()?.speed || 1;
  const rates = p.getAvailablePlaybackRates?.() || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const best = rates.reduce((m, r) => Math.abs(r - v) < Math.abs(m - v) ? r : m, 1);
  p.setPlaybackRate(best);
}

async function ytToggle(a) {
  const id = youtubeId(audioPage(a) || '');
  if (!id) return;
  if (yt.player && yt.id === id) {
    if (ytPlaying()) yt.player.pauseVideo(); else yt.player.playVideo();
    return;
  }
  ytClose();
  yt.id = id;
  yt.audioId = a.id;
  ytMini.hidden = false;
  ytMini.classList.toggle('big', yt.big);
  ytPlace();
  $('#pageBtn').textContent = '⏳ Cargando…';
  try {
    await ytApi();
  } catch (_) {
    ytClose();
    updateAudioBar();
    toast('No se pudo cargar YouTube. ¿Hay internet?', 5000);
    return;
  }
  if (yt.id !== id) return;
  const host = el('div');
  host.id = 'ytPlayer';
  ytMini.querySelector('.yt-mini-video').replaceChildren(host);
  yt.player = new YT.Player(host, {
    videoId: id,
    width: '100%',
    height: '100%',
    playerVars: { playsinline: 1, rel: 0, autoplay: 1, origin: location.origin },
    events: {
      onReady: e => { ytApplySpeed(); e.target.playVideo(); ytUpdateButton(); },
      onStateChange: e => { yt.state = e.data; if (e.data === 1) ytApplySpeed(); ytUpdateButton(); },
      onError: e => {
        // 101/150: el dueño no permite verlo fuera de YouTube; 2/5/100/153: video o configuración inválidos
        const failed = currentAudio();
        if (failed && failed.id === yt.audioId) failed.noEmbed = true;
        ytClose();
        updateAudioBar();
        toast(e.data === 101 || e.data === 150
          ? 'Este video no se puede ver dentro de la app. Pulsa «Escuchar en YouTube».'
          : 'YouTube no pudo reproducir este video aquí. Pulsa «Escuchar en YouTube».', 6000);
      }
    }
  });
}

function ytClose() {
  try { yt.player?.destroy?.(); } catch (_) {}
  yt.player = null;
  yt.id = null;
  yt.audioId = null;
  yt.state = -1;
  ytMini.hidden = true;
  ytMini.querySelector('.yt-mini-video').replaceChildren(Object.assign(el('div'), { id: 'ytPlayer' }));
}

// Llamado desde updateAudioBar: cerrar si cambió la canción o el audio
function ytSync(a) {
  if (yt.audioId && (!a || a.id !== yt.audioId)) ytClose();
  ytUpdateButton();
}
