'use strict';
// Teléfonos y tablets: menú lateral, hoja de tono, ajuste al ancho, gestos entre canciones,
// pantalla siempre encendida en el atril e instalación como aplicación.

const WEB_APP_URL = 'https://carpinteromora.github.io/CancioneroUniversal/';
const phoneMQ = matchMedia('(max-width: 700px)');
const touchMQ = matchMedia('(pointer: coarse)');
const isPhone = () => phoneMQ.matches;
const isTouch = () => touchMQ.matches || isMobileDevice();
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
// Instalar y trabajar sin conexión necesita una página web segura (no file:// ni el servidor local)
const canInstallHere = () => window.isSecureContext && location.protocol !== 'file:' && location.port !== '8777';

// ============ MENÚ LATERAL ☰ ============
const drawerOpenSecs = new Set(['Archivo']);

function fillDrawer(box, items) {
  for (const it of items) {
    if (it.sep) { box.appendChild(el('div', 'drawer-sep')); continue; }
    if (it.group) { box.appendChild(el('div', 'drawer-group', it.group)); continue; }
    if (it.submenu) {
      const sub = el('details', 'drawer-sub');
      sub.appendChild(el('summary', null, it.label));
      fillDrawer(sub, it.submenu);
      box.appendChild(sub);
      continue;
    }
    const b = el('button', 'drawer-item');
    b.type = 'button';
    b.dataset.action = it.action;
    if (it.check?.()) b.classList.add('checked');
    if (it.disabled?.()) b.disabled = true;
    if (it.color) {
      const dot = el('span', 'menu-dot');
      dot.style.background = it.color;
      b.appendChild(dot);
    }
    b.appendChild(document.createTextNode(it.label));
    box.appendChild(b);
  }
}

function openDrawer() {
  const host = $('#drawerMenus');
  host.innerHTML = '';
  for (const menu of MENUS) {
    const sec = el('details', 'drawer-menu');
    sec.open = drawerOpenSecs.has(menu.label);
    sec.addEventListener('toggle', () => {
      if (sec.open) drawerOpenSecs.add(menu.label); else drawerOpenSecs.delete(menu.label);
    });
    sec.appendChild(el('summary', null, menu.label));
    const box = el('div', 'drawer-items');
    fillDrawer(box, menu.items);
    sec.appendChild(box);
    host.appendChild(sec);
  }
  $('#drawer').hidden = false;
}

const closeDrawer = () => { $('#drawer').hidden = true; };

$('#menuToggle').addEventListener('click', openDrawer);
$('#drawerClose').addEventListener('click', closeDrawer);
$('#drawer').addEventListener('click', e => {
  if (e.target.id === 'drawer' || e.target.closest('[data-action]:not(:disabled)')) closeDrawer();
});

// ============ HOJA DE TONO ============
const keySheet = $('#keySheet');

function placeKeySheet() {
  // Dentro de la cabecera (que va por encima con su propia capa) la hoja quedaría bajo el audio
  if (isPhone()) {
    if (keySheet.parentNode !== document.body) document.body.appendChild(keySheet);
  } else {
    closeKeySheet();
    if (keySheet.parentNode !== $('.transposer')) $('.transposer').insertBefore(keySheet, $('#notationBadge'));
  }
}

function openKeySheet() {
  document.body.classList.add('key-open');
  $('#sheetBackdrop').hidden = false;
}

function closeKeySheet() {
  document.body.classList.remove('key-open');
  $('#sheetBackdrop').hidden = true;
}

function updateKeyToggle() {
  const active = $('#notesContainer .note-btn.active');
  $('#keyToggle').textContent = active ? `🎼 ${active.textContent} ▾` : '🎼 Tono ▾';
}

$('#keyToggle').addEventListener('click', openKeySheet);
$('#keySheetClose').addEventListener('click', closeKeySheet);
$('#sheetBackdrop').addEventListener('click', closeKeySheet);
keySheet.addEventListener('click', e => {
  if (isPhone() && e.target.closest('.note-btn:not(:disabled)')) setTimeout(closeKeySheet, 200);
});
new MutationObserver(updateKeyToggle).observe($('#notesContainer'),
  { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

// ============ AJUSTE AL ANCHO (atril) ============
// La letra se achica lo justo para que la línea más larga quepa sin desplazarse hacia el costado
const FIT_KEY = 'canciotras-ajustar';
let fitOn = localStorage.getItem(FIT_KEY) !== '0';
let atrilFitPx = 0;
let charRatio = 0;
const fitWanted = () => fitOn && (isPhone() || isTouch());

function measureCharRatio() {
  const s = el('span', null, 'M'.repeat(50));
  s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-weight:bold';
  s.style.fontFamily = getComputedStyle($('#viewMode')).fontFamily;
  document.body.appendChild(s);
  const r = s.getBoundingClientRect().width / 5000;
  s.remove();
  return r || 0.6;
}

function fitAtril() {
  if (typeof state === 'undefined') return;
  const vm = $('#viewMode');
  atrilFitPx = 0;
  vm.style.removeProperty('--song-font');
  updateFitBtn();
  if (!fitWanted() || state.mode !== 'atril') return;
  charRatio ||= measureCharRatio();
  let best = Infinity;
  for (const line of vm.querySelectorAll('.line:not(.blank)')) {
    const len = line.textContent.replace(/\s+$/, '').length;
    if (len && line.clientWidth) best = Math.min(best, (line.clientWidth - 2) / (len * charRatio));
  }
  if (best < state.fontSize) {
    atrilFitPx = Math.max(10, Math.floor(best * 10) / 10);
    vm.style.setProperty('--song-font', atrilFitPx + 'px');
  }
  updateFitBtn();
}

let fitFrame = 0;
const scheduleFit = () => { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(fitAtril); };

function setFitOn(on) {
  fitOn = on;
  localStorage.setItem(FIT_KEY, on ? '1' : '0');
  scheduleFit();
}

const fitBtn = el('button', 'fit-btn', '↔');
fitBtn.type = 'button';
fitBtn.title = 'Ajustar la letra al ancho de la pantalla';
$('.atril-controls [data-action="fontUp"]').after(fitBtn);
function updateFitBtn() { fitBtn.classList.toggle('on', fitOn); }
fitBtn.addEventListener('click', () => {
  setFitOn(!fitOn);
  toast(fitOn ? 'La letra se ajusta al ancho de la pantalla' : 'Ajuste al ancho desactivado', 2000);
});

// A+ y A− parten del tamaño que se ve; agrandar más allá del ancho apaga el ajuste
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action="fontUp"], [data-action="fontDown"]');
  if (!b || !atrilFitPx || state.mode !== 'atril') return;
  if (b.dataset.action === 'fontUp') {
    state.fontSize = Math.floor(atrilFitPx);
    setFitOn(false);
    toast('Ajuste al ancho desactivado (↔ para volver a ajustar)', 2500);
  } else {
    state.fontSize = Math.ceil(atrilFitPx);
  }
}, true);
document.addEventListener('click', e => {
  if (e.target.closest('[data-action="fontUp"], [data-action="fontDown"]')) scheduleFit();
});

new MutationObserver(scheduleFit).observe($('#viewMode'), { childList: true });
window.addEventListener('resize', scheduleFit);

// ============ DESLIZAR ENTRE CANCIONES ============
let swipe = null;
$('#viewPane').addEventListener('touchstart', e => {
  swipe = null;
  if (e.touches.length !== 1 || state.mode !== 'atril') return;
  const t = e.touches[0];
  if (t.clientX < 24 || t.clientX > window.innerWidth - 24) return;
  const sc = e.target.closest('.song-render, .strum-preview, .panel-strum, .sheet-host');
  if (sc && sc.scrollWidth > sc.clientWidth + 2) return;
  swipe = { x: t.clientX, y: t.clientY, t: Date.now() };
}, { passive: true });
$('#viewPane').addEventListener('touchend', e => {
  if (!swipe) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  const ok = Math.abs(dx) > 80 && Math.abs(dy) < Math.abs(dx) * 0.5 && Date.now() - swipe.t < 700;
  swipe = null;
  if (!ok || docs.length < 2 || String(window.getSelection()).trim()) return;
  stopAutoscroll();
  cycleTab(dx < 0 ? 1 : -1);
  toast(`${docs.indexOf(cur()) + 1} de ${docs.length} · ${cur().title.trim() || 'Sin título'}`, 1500);
}, { passive: true });

function swipeTip() {
  if (!isPhone() || state.mode !== 'atril' || docs.length < 2 || localStorage.getItem('canciotras-pista-deslizar')) return;
  localStorage.setItem('canciotras-pista-deslizar', '1');
  toast('Desliza el dedo hacia los lados para pasar de canción', 4000);
}

// ============ DESPLAZAMIENTO AUTOMÁTICO: barra mínima ============
new MutationObserver(() => document.body.classList.toggle('autoscrolling', $('#btnScroll').classList.contains('on')))
  .observe($('#btnScroll'), { attributes: true, attributeFilter: ['class'] });

// ============ PANTALLA ENCENDIDA EN EL ATRIL ============
let wakeLock = null, wakeBusy = false;
async function syncWakeLock() {
  if (!('wakeLock' in navigator) || wakeBusy || typeof state === 'undefined') return;
  const want = state.mode === 'atril' && document.visibilityState === 'visible' && isTouch();
  wakeBusy = true;
  try {
    if (want && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (_) {}
  wakeBusy = false;
}
document.addEventListener('visibilitychange', syncWakeLock);

// ============ ALTURA DE LA BARRA DEL ATRIL ============
function updateAtrilHeight() {
  const bar = $('.atril-controls');
  if (isPhone()) document.body.style.setProperty('--atril-h', bar.offsetHeight + 'px');
  else document.body.style.removeProperty('--atril-h');
}
if (window.ResizeObserver) new ResizeObserver(updateAtrilHeight).observe($('.atril-controls'));

// ============ EDICIÓN ============
// Con el teclado abierto se esconde la cabecera para dejar lugar a la letra (quedan los botones de formato)
editor.addEventListener('focus', () => document.body.classList.toggle('editing-focus', isPhone()));
editor.addEventListener('blur', () => document.body.classList.remove('editing-focus'));
$('#bannerMore').addEventListener('click', () => document.body.classList.add('banner-full'));

// ============ CAMBIOS DE MODO Y DE TAMAÑO ============
let lastMode = null;
new MutationObserver(() => {
  if (typeof state === 'undefined' || state.mode === lastMode) return;
  lastMode = state.mode;
  scheduleFit();
  syncWakeLock();
  updateAtrilHeight();
  swipeTip();
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

phoneMQ.addEventListener('change', () => { placeKeySheet(); updateAtrilHeight(); scheduleFit(); closeDrawer(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#drawer').hidden) closeDrawer();
  if (document.body.classList.contains('key-open')) closeKeySheet();
});
placeKeySheet();

// ============ INSTALAR COMO APLICACIÓN ============
let installEvt = null;
const HINT_KEY = 'canciotras-pista-instalar';

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvt = e;
  maybeShowInstallHint();
});
window.addEventListener('appinstalled', () => {
  installEvt = null;
  $('#installHint').hidden = true;
  toast('¡Listo! Cancionero Universal quedó instalado en este dispositivo', 4000);
});

function maybeShowInstallHint() {
  if (isStandalone() || !isMobileDevice() || !canInstallHere() || localStorage.getItem(HINT_KEY)) return;
  if (!installEvt && !isIOS()) return;
  clearTimeout(maybeShowInstallHint.timer);
  maybeShowInstallHint.timer = setTimeout(() => { $('#installHint').hidden = false; }, 5000);
}

function dismissInstallHint() {
  localStorage.setItem(HINT_KEY, '1');
  $('#installHint').hidden = true;
}
$('#installHintClose').addEventListener('click', dismissInstallHint);
$('#installHintGo').addEventListener('click', () => { dismissInstallHint(); showInstallApp(); });

async function showInstallApp() {
  if (isStandalone()) {
    return showModal({ title: 'Ya está instalada', body: '<p>Estás usando Cancionero Universal como aplicación. 🙂</p>' });
  }
  if (installEvt) {
    const evt = installEvt;
    installEvt = null;
    evt.prompt();
    await evt.userChoice.catch(() => null);
    return;
  }
  const link = `<a href="${WEB_APP_URL}" target="_blank" rel="noopener">${WEB_APP_URL}</a>`;
  let body;
  if (!canInstallHere()) {
    body = `<p>Para tenerla como aplicación en el teléfono, la tablet o el computador, abre esta página
      en el navegador y desde ahí elige <b>Instalar</b>:</p><p class="share-file">${link}</p>
      <p class="hint">Una vez instalada se abre desde su ícono y funciona también sin internet.</p>`;
  } else if (isIOS()) {
    body = `<p>En el iPhone o iPad, desde <b>Safari</b>:</p>
      <ol class="install-steps">
        <li>Toca el botón <b>Compartir</b> <span aria-hidden="true">(□↑)</span>, abajo o arriba de la pantalla.</li>
        <li>Elige <b>«Agregar a inicio»</b> (o «Añadir a pantalla de inicio»).</li>
        <li>Toca <b>Agregar</b>.</li>
      </ol>
      <p class="hint">Aparecerá el ícono ♪ <b>Cancionero</b> en la pantalla de inicio y funciona también sin internet.</p>`;
  } else if (isMobileDevice()) {
    body = `<p>En Android, desde <b>Chrome</b>:</p>
      <ol class="install-steps">
        <li>Toca el menú <b>⋮</b> (arriba a la derecha).</li>
        <li>Elige <b>«Instalar aplicación»</b> o <b>«Agregar a la pantalla principal»</b>.</li>
        <li>Confirma con <b>Instalar</b>.</li>
      </ol>
      <p class="hint">Si no aparece la opción, es posible que ya esté instalada: búscala entre tus aplicaciones.</p>`;
  } else {
    body = `<p>En el computador, con <b>Chrome</b> o <b>Edge</b>:</p>
      <ol class="install-steps">
        <li>Haz clic en el ícono <b>Instalar</b> (⊕) al final de la barra de direcciones,</li>
        <li>o en el menú <b>⋮</b> → <b>Transmitir, guardar y compartir</b> → <b>Instalar página como aplicación</b>.</li>
      </ol>
      <p class="hint">Si no aparece la opción, es posible que ya esté instalada.</p>`;
  }
  showModal({ title: '📲 Instalar Cancionero Universal', body });
}

// Funcionar sin conexión: guarda la aplicación en el dispositivo (solo en la página web)
if ('serviceWorker' in navigator && canInstallHere()) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
maybeShowInstallHint();
