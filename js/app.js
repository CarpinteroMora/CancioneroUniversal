'use strict';
// Cancionero Universal: estado general, modos de vista, archivos, menús, teclado e inicio.

const APP_INFO = {
  nombre: 'Cancionero Universal',
  descripcion: 'Editor de canciones con acordes, transpositor y cancioneros',
  version: '4.2.0',
  autor: 'Marcos Mora Vitta',
  anio: 2026
};

// Carpeta (local) o dirección web desde donde se está usando la app
function appLocation() {
  const folder = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  let decoded = folder;
  try { decoded = decodeURI(folder); } catch (_) {}
  return location.protocol === 'file:' ? decoded.replace(/^file:\/\//, '') : decoded;
}

const state = {
  mode: 'atril',
  notation: 'latin',
  showComments: true,
  showPreview: false,
  fontSize: 15,
  highlight: 'todas',
  bannerHidden: false,
  cancioneroName: '',
  cancioneroPath: '',
  cancioneroClean: null,
  scrollSpeed: 5,
  showPanel: false
};
let detectedKey = null;

const isLatin = () => state.notation === 'latin';

// ============ REFRESCO DE PANTALLA ============
let refreshTimer = null;
function refresh() {
  clearTimeout(refreshTimer);
  syncFromEditor();
  const d = cur();
  detectedKey = detectKey(d.text);
  buildTransposer();
  $('#editHeader').innerHTML = renderHeader(d.title, detectedKey);
  renderAtril(d, detectedKey);
  renderPanel();
  renderTabs();
  showScrollSpeed();
  renderBookName();
  document.title = `${d.title.trim() || 'Sin título'}${state.cancioneroName ? ' · ' + state.cancioneroName : ''} – ${APP_INFO.nombre}`;
  autosize();
  scheduleSave();
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 150);
}

function autosize() {
  if (state.mode !== 'edit') return;
  const y = window.scrollY;
  editor.style.height = 'auto';
  editor.style.height = Math.max(editor.scrollHeight + 4, 500) + 'px';
  window.scrollTo(0, y);
}

// ============ MODOS Y VISTA ============
function setMode(m) {
  state.mode = m;
  document.body.classList.toggle('mode-edit', m === 'edit');
  document.body.classList.toggle('mode-atril', m === 'atril');
  $('#btnEdit').classList.toggle('active', m === 'edit');
  $('#btnAtril').classList.toggle('active', m === 'atril');
  if (m !== 'atril') stopAutoscroll();
  // En pantallas táctiles el foco abriría el teclado sin que se pida
  if (m === 'edit') { autosize(); if (!isTouch()) editor.focus({ preventScroll: true }); }
  scheduleSave();
}

function setFont(px) {
  state.fontSize = Math.max(10, Math.min(36, px));
  document.documentElement.style.setProperty('--song-font', state.fontSize + 'px');
  autosize();
  scheduleSave();
}

function applyState() {
  const b = document.body.classList;
  b.toggle('hide-comments', !state.showComments);
  b.toggle('show-preview', state.showPreview);
  $('#infoBanner').hidden = state.bannerHidden;
  $('#btnNotation').textContent = isLatin() ? '🔤 Anglosajona' : '🔤 Latina';
  $('#notationBadge').textContent = isLatin() ? 'LATINA' : 'ANGLOSAJONA';
  setFont(state.fontSize);
  setMode(state.mode);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => toast('No se pudo activar la pantalla completa'));
}
document.addEventListener('fullscreenchange', () =>
  document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement));

// Desplazamiento automático en el atril. Velocidad por canción, en 20 niveles (píxeles por segundo)
const SCROLL_SPEEDS = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 19, 22, 26, 31, 38, 48, 60];
const clampLevel = v => Math.min(SCROLL_SPEEDS.length, Math.max(1, Math.round(+v) || 5));
const scrollLevel = () => cur()?.scrollSpeed || state.scrollSpeed;

function showScrollSpeed() {
  const lv = scrollLevel();
  $('#scrollSpeed').value = lv;
  $('#scrollLevel').textContent = lv;
}

function setScrollSpeed(lv) {
  lv = clampLevel(lv);
  cur().scrollSpeed = lv;
  state.scrollSpeed = lv;
  showScrollSpeed();
  scheduleSave();
}
$('#scrollSpeed').addEventListener('input', e => setScrollSpeed(e.target.value));

let scrollOn = false, scrollAcc = 0, scrollLast = 0;
function scrollStep(ts) {
  if (!scrollOn) return;
  if (scrollLast) {
    scrollAcc += (ts - scrollLast) / 1000 * SCROLL_SPEEDS[scrollLevel() - 1];
    const px = Math.floor(scrollAcc);
    if (px) { window.scrollBy(0, px); scrollAcc -= px; }
  }
  scrollLast = ts;
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) { stopAutoscroll(); return; }
  requestAnimationFrame(scrollStep);
}
function toggleAutoscroll() {
  if (scrollOn) { stopAutoscroll(); return; }
  scrollOn = true; scrollLast = 0; scrollAcc = 0;
  $('#btnScroll').classList.add('on');
  $('#btnScroll').textContent = '⏸ Pausa';
  requestAnimationFrame(scrollStep);
}
function stopAutoscroll() {
  scrollOn = false;
  $('#btnScroll').classList.remove('on');
  $('#btnScroll').textContent = '▶ Desplazar';
}

// ============ ARCHIVO ============
$('#fileOpen').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  await openFiles(files.map(file => ({ file })));
});

// items: [{ file, handle? }]. Con "handle", Guardar escribe después en ese mismo archivo
async function openFiles(items) {
  const files = items.map(i => i.file);
  let opened = 0, localAudios = 0;
  for (const { file: f, handle } of items) {
    if (/\.m3u8?$/i.test(f.name)) { await openM3u8(f, handle); continue; }
    const raw = await f.text();
    if (/\.json$/i.test(f.name)) {
      let data = null;
      try { data = JSON.parse(raw); } catch (_) {}
      if (isCancionero(data)) await loadCancionero(data, handle);
      else toast(`"${f.name}" no es un cancionero válido`);
      continue;
    }
    const doc = parseDocument(raw, f.name);
    const d = openInTab(doc);
    if (handle && /\.(md|markdown)$/i.test(f.name)) rememberFileHandle(d, handle);
    localAudios += await relinkDocAudios(d);
    if (typeof relinkDocSheets === 'function') await relinkDocSheets(d);
    opened++;
  }
  refresh();
  if (opened) {
    toast(localAudios
      ? `${opened === 1 ? 'Canción abierta' : opened + ' canciones abiertas'}. ${canPickFiles ? 'Para escuchar sus audios pulsa "Activar audios de la carpeta".' : 'Si el audio no suena, vincúlalo en Herramientas → Vincular con audio o video local.'}`
      : opened === 1 ? `Abierto "${files.find(f => !/\.(json|m3u8?)$/i.test(f.name)).name}"` : `${opened} canciones abiertas en pestañas`,
      localAudios ? 5000 : 2000);
  }
}

$('#fileImport').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const doc = parseDocument(await f.text(), f.name);
  const wasEmpty = !editor.value.trim();
  if (wasEmpty) titleEl.value = doc.title;
  const current = editor.value.replace(/\s+$/, '');
  setText(current ? current + '\n\n' + doc.text : doc.text, { selStart: current.length });
  doc.audios.forEach(a => addAudio(a, false));
  toast(wasEmpty ? `Importado "${f.name}"` : `"${f.name}" importado al final de la canción`);
});

async function exportMarkdown() {
  syncFromEditor();
  const d = cur();
  const ok = await saveFile(buildMarkdown(d), safeFileName(d.title) + '.md', 'text/markdown', '.md', 'Markdown');
  if (!ok) return;
  markClean(d);
  refresh();
  const locals = d.audios.filter(a => a.kind === 'local');
  toast(locals.length
    ? `Markdown exportado. Coloca el audio en: ${locals.map(a => a.src).join(', ')} (relativo al .md)`
    : 'Markdown exportado', locals.length ? 6000 : 2000);
}

async function exportText() {
  syncFromEditor();
  const d = cur();
  const content = `${d.title}\n\n${stripInlineMd(d.text)}\n`;
  if (await saveFile(content, safeFileName(d.title) + '.txt', 'text/plain', '.txt', 'Texto')) toast('Texto exportado');
}

async function loadExample() {
  await loadM3u8(parseM3u8(EXAMPLE_BOOK.m3u8), null, [], EXAMPLE_BOOK.canciones);
  setMode('atril');
}

// ============ DIÁLOGOS ============
async function fromMarkdownDialog() {
  let md = '';
  const readMd = (d, value) => (md = d.querySelector('#mdInput').value).trim() ? value : modalFail(d, 'Pega algún texto primero.');
  const choice = await showModal({
    title: 'Pegar desde Markdown',
    wide: true,
    body: `<p class="hint">Pega aquí texto en Markdown (por ejemplo, un .md exportado por esta app).
      Se conservan negrita, cursiva, subrayado, comentarios, voces y audios.</p>
      <textarea id="mdInput" class="modal-textarea" spellcheck="false"></textarea>`,
    onOpen: d => d.querySelector('#mdInput').focus(),
    buttons: [
      { label: 'Cancelar' },
      { label: 'Abrir en pestaña nueva', onClick: d => readMd(d, 'tab') },
      { label: 'Insertar en el cursor', primary: true, onClick: d => readMd(d, 'insert') }
    ]
  });
  if (!choice) return;
  const doc = parseMarkdown(md);
  if (choice === 'tab') {
    openInTab(doc);
    setMode('edit');
  } else {
    insertAtCursor(doc.text);
    doc.audios.forEach(a => addAudio(a, false));
  }
}

function showAbout() {
  showModal({
    title: 'Acerca de',
    body: `<div class="about">
      <div class="logo">♪</div>
      <div class="about-name">${escapeHtml(APP_INFO.nombre)}</div>
      <div class="hint">${escapeHtml(APP_INFO.descripcion)}</div>
      <table>
        <tr><th>Versión</th><td>${escapeHtml(APP_INFO.version)}</td></tr>
        <tr><th>Autor</th><td>${escapeHtml(APP_INFO.autor)}</td></tr>
        <tr><th>Año</th><td>${escapeHtml(APP_INFO.anio)}</td></tr>
        <tr><th>Ubicación</th><td class="about-path">${escapeHtml(appLocation())}</td></tr>
        <tr><th>Videos (YouTube…)</th><td id="aboutVideos">…</td></tr>
      </table>
      <div class="about-credits">
        <b>Bibliotecas libres incluidas</b><br>
        Posturas de guitarra y ukelele: chords-db, de David Rubert (MIT) ·
        Charango y mandolina: proyecto ChordPro (Artistic License 2.0) ·
        Partituras y tablaturas: alphaTab (MPL-2.0) · PDF: pdf.js de Mozilla (Apache-2.0)<br>
        <b>Referencias</b><br>
        Guitarra traspuesta: Helga Larravide y la tesis "Entonada" (U. de Chile) ·
        Guitarrón: José Pérez de Arce, "El guitarrón chileno y su armonía tímbrica" (Resonancias UC) ·
        Charango: Héctor Soto, "Charango para todos", y Horacio Durán e Italo Pedrotti, "Método de charango" (U. de Chile, 2001)
      </div></div>`,
    onOpen: d => extractorStatus().then(s => {
      const cell = d.querySelector('#aboutVideos');
      if (cell) cell.textContent = s ? `Activo (yt-dlp ${s.ytdlp || '?'})`
        : extractorAllowed() ? 'Sin activar: abre una vez iniciar-canciotras' : 'Se abren en YouTube (instala la app en el PC para escucharlos aquí)';
    })
  });
}

// ============ AYÚDANOS A SEGUIR TRABAJANDO ============
// El formulario llega al correo por FormSubmit (sin cuenta: la primera vez envía un correo de activación).
const CONTACT_FORM_URL = `https://formsubmit.co/ajax/${CONTACT_EMAIL}`;
const CONTACT_REASONS = ['Quiero colaborar económicamente', 'Sugerencia o idea', 'Encontré un error', 'Otro'];

function showSupport() {
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Quiero colaborar con ' + APP_INFO.nombre)}`;
  const thanks = COLABORADORES.length
    ? `<ul class="support-names">${COLABORADORES.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
    : '<p class="hint">Aquí aparecerán los nombres de quienes nos ayudan.</p>';
  let sent = false;
  showModal({
    title: 'Ayúdanos a seguir trabajando',
    wide: true,
    body: `
      <p>${escapeHtml(APP_INFO.nombre)} es gratuito y lo desarrollamos con mucho cariño para servir a las
        comunidades, coros y músicos que animan la liturgia. Si te es útil, puedes
        <b>colaborar económicamente</b> para que sigamos desarrollándolo: nuevas funciones, mejoras y mantenimiento.</p>
      <p><b>¿Cómo colaborar?</b> Escríbenos con este formulario o al correo
        <a href="${mailto}">${CONTACT_EMAIL}</a>
        <button type="button" class="btn support-copy">Copiar correo</button>
        y te enviaremos nuestros datos para transferencias.</p>
      <div class="support-form">
        <label class="field"><span>Nombre</span><input type="text" id="sName" autocomplete="name"></label>
        <label class="field"><span>Correo <small>(para poder responderte)</small></span><input type="email" id="sEmail" autocomplete="email"></label>
        <label class="field"><span>Motivo</span><select id="sReason">${CONTACT_REASONS.map(r => `<option>${r}</option>`).join('')}</select></label>
        <label class="field"><span>Mensaje</span><textarea id="sMessage" rows="4" placeholder="Cuéntanos de dónde nos escribes y en qué te podemos ayudar"></textarea></label>
        <label class="support-check"><input type="checkbox" id="sPublish"> Pueden publicar mi nombre en la lista de agradecimientos</label>
        <input type="text" id="sHoney" class="support-honey" tabindex="-1" autocomplete="off" aria-hidden="true">
      </div>
      <div class="support-thanks">
        <h3>Gracias a quienes nos ayudan</h3>
        ${thanks}
        <p>¡Muchas gracias por su generosidad! Pedimos que Dios les bendiga abundantemente por su ayuda. 🙏</p>
      </div>`,
    buttons: [
      { label: 'Cerrar' },
      {
        label: 'Enviar', primary: true,
        onClick: d => {
          if (sent) return true;
          const val = id => d.querySelector(id).value.trim();
          const data = { nombre: val('#sName'), correo: val('#sEmail'), motivo: val('#sReason'), mensaje: val('#sMessage') };
          if (!data.nombre) return modalFail(d, 'Escribe tu nombre.');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.correo)) return modalFail(d, 'Escribe un correo válido para poder responderte.');
          if (!data.mensaje && data.motivo !== CONTACT_REASONS[0]) return modalFail(d, 'Escribe tu mensaje.');
          sendSupportForm(d, data, d.querySelector('#sPublish').checked, val('#sHoney')).then(ok => { sent = ok; });
          return false;
        }
      }
    ],
    onOpen: d => {
      d.querySelector('#sName').focus();
      d.querySelector('.support-copy').onclick = async e => {
        try { await navigator.clipboard.writeText(CONTACT_EMAIL); e.target.textContent = 'Copiado ✓'; } catch (_) {
          e.target.textContent = CONTACT_EMAIL;
        }
      };
    }
  });
}

async function sendSupportForm(d, data, publish, honey) {
  const btn = d.querySelector('.modal-actions .primary');
  modalFail(d, '');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  let ok = false;
  try {
    const r = await fetch(CONTACT_FORM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: `${APP_INFO.nombre}: ${data.motivo} (${data.nombre})`,
        _replyto: data.correo,
        _template: 'table',
        _honey: honey,
        Nombre: data.nombre,
        Correo: data.correo,
        Motivo: data.motivo,
        Mensaje: data.mensaje || '(sin mensaje)',
        'Publicar su nombre en agradecimientos': publish ? 'Sí' : 'No',
        'Versión de la app': APP_INFO.version
      })
    });
    const res = await r.json().catch(() => ({}));
    ok = r.ok && String(res.success) === 'true';
  } catch (_) {}
  btn.disabled = false;
  if (ok) {
    d.querySelector('.support-form').innerHTML = `<p class="support-sent">✅ ¡Gracias, ${escapeHtml(data.nombre)}! Recibimos tu mensaje
      y te responderemos a <b>${escapeHtml(data.correo)}</b>${data.motivo === CONTACT_REASONS[0] ? ' con nuestros datos para transferencias' : ''}.</p>`;
    btn.textContent = 'Cerrar';
    return true;
  }
  btn.textContent = 'Enviar';
  const body = `Nombre: ${data.nombre}\nCorreo: ${data.correo}\nMotivo: ${data.motivo}\n\n${data.mensaje}`;
  d.querySelector('.modal-error').innerHTML = `No se pudo enviar desde aquí (¿sin internet?).
    <a href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(data.motivo)}&body=${encodeURIComponent(body)}">Envíalo con tu correo</a>.`;
  return false;
}

function showSyntax() {
  const rows = [
    ['Acordes (encima de la letra)', 'Sol      Re7     Sol\nNoche de paz...'],
    ['Acorde menor en minúscula', 'la = Lam · re7 = Rem7 · e = Em'],
    ['Números y símbolos', 'Sol7  Re7/9  La6/9  Do7(9,11)  Fa#m7(b5)  Mi°  Sol+  DoΔ'],
    ['Tono', 'Se detecta con el primer acorde de la canción'],
    ['Título de sección', '## Coro'],
    ['Comentario', '> Repetir dos veces'],
    ['Voz', '[Voz: Tenor]   …   [Voz: Única]'],
    ['Negrita', '**texto**'],
    ['Cursiva', '_texto_'],
    ['Subrayado', '<u>texto</u>'],
    ['Rasgueo (antes de la sección)', '[Rasgueo: Vals 3/4 | >B - B A B A]\n[Rasgueo: Cueca]   (de la biblioteca)'],
    ['Golpes del rasgueo', 'B abajo · A arriba · b a suaves · X apagado · - silencio\n> acento · | compás'],
    ['Partitura (imagen)', '![Partitura: Coro](coro.png)'],
    ['Partitura o tablatura (archivo o web)', '[Partitura: Abre tu jardín](abre-tu-jardin.musicxml "en Mi")\n[Tablatura: Guitarra](https://ejemplo.com/abre-tu-jardin.gp)'],
    ['Instrumentos (cabecera del .md)', 'instrumentos: guitarra (tercera-alta), charango\ncejilla: guitarra=2\ninstrumento-propio: Tres cubano = Sol3 Sol4, Do4 Do4, Mi4 Mi4; trastes=17\nvista: partitura'],
    ['Tags (cabecera del .md)', 'etiquetas: Católico, Entrada, Tiempo ordinario\n(Editar → Tags las propone según la tradición)']
  ];
  showModal({
    title: 'Guía de sintaxis',
    wide: true,
    body: `<table class="syntax-table">${rows.map(([a, b]) =>
      `<tr><td>${a}</td><td><code>${escapeHtml(b)}</code></td></tr>`).join('')}</table>
      <p class="hint" style="margin-top:10px">Al importar se acepta también formato ChordPro (<code>[G]Noche de [D]paz</code>).
      Cada pestaña es una canción; con <b>Archivo → Guardar cancionero</b> se guardan todas juntas.</p>`
  });
}

// ============ MENÚ ============
const MENUS = [
  { label: 'Archivo', items: [
    { label: 'Nuevo cancionero…', action: 'newBook' },
    { label: 'Nueva pestaña', action: 'new', key: 'Ctrl+Alt+N' },
    { label: 'Abrir colección…', action: 'openCollection', key: 'Ctrl+Alt+O' },
    { sep: true },
    { label: 'Abrir…', action: 'open', key: 'Ctrl+O' },
    { label: 'Guardar', action: 'save', key: 'Ctrl+S' },
    { label: 'Guardar como…', action: 'saveAs', key: 'Ctrl+Shift+S' },
    { sep: true },
    { label: 'Importar en esta canción…', action: 'import' },
    { label: 'Cerrar pestaña', action: 'closeTab', key: 'Ctrl+Alt+W' },
    { sep: true },
    { group: 'Cancionero (todas las pestañas)' },
    { label: 'Guardar cancionero (.m3u8)', action: 'saveBook', key: 'Ctrl+Alt+S' },
    { label: 'Guardar cancionero como…', action: 'saveBookAs' },
    { label: 'Abrir cancionero…', action: 'openBook' },
    { label: 'Imprimir cancionero…', action: 'printBook' },
    { label: 'Tríptico para la asamblea (solo letra)…', action: 'printTriptych' },
    { label: 'Exportar cancionero', submenu: [
      { label: 'Para proyectar (.pptx)…', action: 'exportBookPptx' },
      { label: 'Word (.docx)…', action: 'exportBookDocx' },
      { label: 'OpenDocument (.odt)…', action: 'exportBookOdt' },
      { label: 'Página web (.html)…', action: 'exportBookHtml' }
    ]},
    { sep: true },
    { group: 'Canción actual' },
    { label: 'Exportar', submenu: [
      { label: 'Para proyectar (.pptx)…', action: 'exportPptx' },
      { label: 'Word (.docx)…', action: 'exportDocx' },
      { label: 'OpenDocument (.odt)…', action: 'exportOdt' },
      { label: 'Página web (.html)…', action: 'exportHtml' },
      { label: 'Texto (.txt)…', action: 'exportTxt' },
      { label: 'Markdown (.md)…', action: 'exportMd' }
    ]},
    { label: 'Imprimir canción…', action: 'print', key: 'Ctrl+P' },
    { sep: true },
    { label: 'Abrir ejemplo', action: 'example' }
  ]},
  { label: 'Editar', items: [
    { label: 'Deshacer', action: 'undo', key: 'Ctrl+Z' },
    { label: 'Rehacer', action: 'redo', key: 'Ctrl+Y' },
    { sep: true },
    { label: 'Cortar', action: 'cut', key: 'Ctrl+X' },
    { label: 'Copiar', action: 'copy', key: 'Ctrl+C' },
    { label: 'Pegar', action: 'paste', key: 'Ctrl+V' },
    { label: 'Pegar sin formato', action: 'pastePlain', key: 'Ctrl+Shift+V' },
    { label: 'Pegar desde Markdown…', action: 'fromMarkdown' },
    { sep: true },
    { label: 'Seleccionar todo', action: 'selectAll', key: 'Ctrl+A' },
    { sep: true },
    { label: 'Tags', submenu: [
      { label: 'Editar tags de esta canción…', action: 'tagDialog', key: 'Ctrl+Alt+E' },
      { label: 'Buscar canciones por tags…', action: 'tagSearch' }
    ]}
  ]},
  { label: 'Ver', items: [
    { group: 'Modo' },
    { label: 'Edición', action: 'modeEdit', check: () => state.mode === 'edit', key: 'Ctrl+E' },
    { label: 'Atril', action: 'modeAtril', check: () => state.mode === 'atril', key: 'Ctrl+E' },
    { sep: true },
    { label: 'Pantalla completa', action: 'fullscreen', check: () => !!document.fullscreenElement, key: 'Ctrl+Shift+F' },
    { label: 'Comentarios', action: 'toggleComments', check: () => state.showComments },
    { label: 'Vista previa al editar', action: 'togglePreview', check: () => state.showPreview },
    { label: 'Notación anglosajona (C, D, E…)', action: 'toggleNotation', check: () => state.notation === 'eng' },
    { label: 'Panel de acordes', action: 'togglePanel', check: () => state.showPanel, key: 'Ctrl+Alt+P' },
    { sep: true },
    { group: 'En el atril' },
    { label: 'Letra y acordes', action: 'view:letra', check: () => atrilView(cur()) === 'letra' },
    { label: 'Partitura', action: 'view:partitura', check: () => atrilView(cur()) === 'partitura', disabled: () => !cur().sheets.some(h => h.tipo === 'partitura') },
    { label: 'Tablatura', action: 'view:tablatura', check: () => atrilView(cur()) === 'tablatura', disabled: () => !cur().sheets.some(h => h.tipo === 'tablatura') },
    { sep: true },
    { label: 'Pestaña siguiente', action: 'nextTab', key: 'Ctrl+Alt+→' },
    { label: 'Pestaña anterior', action: 'prevTab', key: 'Ctrl+Alt+←' },
    { sep: true },
    { label: 'Aumentar letra', action: 'fontUp' },
    { label: 'Reducir letra', action: 'fontDown' }
  ]},
  { label: 'Formato', items: [
    { group: 'Texto' },
    { label: 'Negrita', action: 'bold', key: 'Ctrl+B' },
    { label: 'Cursiva', action: 'italic', key: 'Ctrl+I' },
    { label: 'Subrayado', action: 'underline', key: 'Ctrl+U' },
    { label: 'Texto normal (quitar formato)', action: 'clearFormat', key: 'Ctrl+\\' },
    { sep: true },
    { label: 'Título de sección', action: 'heading' },
    { label: 'Comentario', action: 'comment', key: 'Ctrl+Alt+M' }
  ]},
  { label: 'Insertar', items: [
    { group: 'Hojas (se vinculan, no se copian)' },
    { label: 'Partitura…', action: 'insertScore' },
    { label: 'Tablatura…', action: 'insertTab' },
    { sep: true },
    { label: 'Mostrar acordes', action: 'togglePanel', check: () => state.showPanel, key: 'Ctrl+Alt+P' },
    { label: 'Instrumento…', action: 'instrumentDialog' },
    { label: 'Rasgueo…', action: 'strumDialog' }
  ]},
  { label: 'Voces', items: [
    { group: 'Asignar a las líneas seleccionadas' },
    ...VOICE_ORDER.map(v => ({ label: VOICES[v].label, action: 'voice:' + v, color: VOICES[v].color })),
    { sep: true },
    { group: 'Resaltar en el atril' },
    { label: 'Todas', action: 'hl:todas', check: () => state.highlight === 'todas' },
    ...VOICE_ORDER.filter(v => v !== 'unica').map(v => ({
      label: VOICES[v].label, action: 'hl:' + v, color: VOICES[v].color, check: () => state.highlight === v
    }))
  ]},
  { label: 'Herramientas', items: [
    { label: 'Grabar…', action: 'record' },
    { sep: true },
    { label: 'Vincular con audio o video local…', action: 'audioLocal' },
    { label: 'Vincular con audio o video por URL…', action: 'audioUrl' },
    { label: 'Guardar el audio en mi equipo…', action: 'audioSaveExtracted', disabled: () => !currentAudio()?.extractor },
    { sep: true },
    { label: 'Quitar audio actual', action: 'audioRemove', disabled: () => !cur().audios.length }
  ]},
  { label: 'Acerca de', items: [
    { label: `Acerca de ${APP_INFO.nombre}…`, action: 'about' },
    { label: 'Ayúdanos a seguir trabajando…', action: 'support' },
    { label: 'Guía de sintaxis', action: 'syntax' },
    { sep: true },
    { label: 'Instalar app en este dispositivo…', action: 'installApp' }
  ]}
];

// ============ ACCIONES ============
const ACTIONS = {
  new: newTab,
  open: openSongs,
  save: () => saveSong(false),
  saveAs: () => saveSong(true),
  import: () => $('#fileImport').click(),
  closeTab: () => closeTab(),
  saveBook: () => saveCancioneroDialog(),
  saveBookAs: () => saveCancioneroDialog(true),
  openBook: openSongs,
  newBook: newBookDialog,
  openCollection,
  relinkAudios: activateFolderAudios,
  printBook: () => openPrintPreview('cancionero'),
  printTriptych: () => openPrintPreview('triptico'),
  exportMd: exportMarkdown,
  exportTxt: exportText,
  exportHtml: exportSongHtml,
  exportBookHtml,
  exportPptx: exportSongPptx,
  exportBookPptx,
  exportDocx: () => exportSongDoc('docx'),
  exportOdt: () => exportSongDoc('odt'),
  exportBookDocx: () => exportBookDoc('docx'),
  exportBookOdt: () => exportBookDoc('odt'),
  print: () => openPrintPreview('cancion'),
  example: loadExample,

  undo, redo,
  cut: () => copySelection(true),
  copy: () => copySelection(false),
  paste: () => pasteFromMenu(false),
  pastePlain: () => pasteFromMenu(true),
  fromMarkdown: fromMarkdownDialog,
  selectAll,
  tagDialog,
  tagSearch: tagSearchDialog,

  modeEdit: () => setMode('edit'),
  modeAtril: () => setMode('atril'),
  toggleMode: () => setMode(state.mode === 'edit' ? 'atril' : 'edit'),
  fullscreen: toggleFullscreen,
  toggleComments: () => { state.showComments = !state.showComments; applyState(); toast(state.showComments ? 'Comentarios visibles' : 'Comentarios ocultos', 1500); },
  togglePreview: () => { state.showPreview = !state.showPreview; applyState(); },
  toggleNotation: () => { state.notation = isLatin() ? 'eng' : 'latin'; applyState(); refresh(); },
  nextTab: () => cycleTab(1),
  prevTab: () => cycleTab(-1),
  fontUp: () => setFont(state.fontSize + 1),
  fontDown: () => setFont(state.fontSize - 1),
  hideBanner: () => { state.bannerHidden = true; applyState(); },
  autoscroll: toggleAutoscroll,
  scrollSlower: () => setScrollSpeed(scrollLevel() - 1),
  scrollFaster: () => setScrollSpeed(scrollLevel() + 1),

  bold: () => toggleWrap('**', '**'),
  italic: () => toggleWrap('_', '_'),
  underline: () => toggleWrap('<u>', '</u>'),
  clearFormat,
  heading: () => toggleLinePrefix('## ', /^\s*#{1,6}\s+/),
  comment: () => toggleLinePrefix('> ', /^\s*>\s?/),

  record: openRecorder,
  audioLocal: linkLocalAudio,
  audioUrl: () => linkUrlAudio(),
  audioSaveExtracted: saveExtractedAudio,
  audioRemove: removeCurrentAudio,

  insertScore: () => sheetInsertDialog('partitura'),
  insertTab: () => sheetInsertDialog('tablatura'),
  removeSheet,
  togglePanel,
  instrumentDialog,
  strumDialog,

  about: showAbout,
  support: showSupport,
  syntax: showSyntax,
  installApp: showInstallApp
};

function runAction(name) {
  if (name.startsWith('voice:')) return assignVoice(name.slice(6));
  if (name.startsWith('hl:')) return setHighlight(name.slice(3));
  if (name.startsWith('key:')) return transposeTo(+name.slice(4));
  if (name.startsWith('view:')) return setAtrilView(name.slice(5));
  ACTIONS[name]?.();
}

// ============ TECLADO ============
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && openMenu) { closeMenus(); return; }
  const t = e.target;
  if (t.closest?.('dialog')) return;
  const inEditor = t === editor;
  const inOtherField = !inEditor && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
  const mod = e.ctrlKey || e.metaKey;

  if (!mod) {
    const atrilKeys = state.mode === 'atril' && !inEditor && !inOtherField && !e.altKey;
    if (e.key === ' ' && atrilKeys && !t.closest?.('button')) {
      e.preventDefault();
      toggleAutoscroll();
    } else if (atrilKeys && ['-', '+', '='].includes(e.key)) {
      e.preventDefault();
      runAction(e.key === '-' ? 'scrollSlower' : 'scrollFaster');
    }
    return;
  }

  const k = e.key.toLowerCase();
  let act = null;
  if (e.altKey) {
    act = { KeyN: 'new', KeyO: 'openCollection', KeyW: 'closeTab', KeyM: 'comment', KeyS: 'saveBook', KeyP: 'togglePanel', KeyE: 'tagDialog', ArrowRight: 'nextTab', ArrowLeft: 'prevTab' }[e.code] || null;
  } else if (e.shiftKey) {
    act = { z: 'redo', f: 'fullscreen', s: 'saveAs' }[k] || null;
  } else {
    act = { z: 'undo', y: 'redo', o: 'open', s: 'save', p: 'print', e: 'toggleMode',
            b: 'bold', i: 'italic', u: 'underline', '\\': 'clearFormat' }[k] || null;
    if (k === 'a' && state.mode === 'atril' && !inOtherField) act = 'selectAll';
  }
  if (!act) return;
  const formatting = ['bold', 'italic', 'underline', 'clearFormat', 'comment'];
  if (inOtherField && (formatting.includes(act) || act === 'undo' || act === 'redo')) return;
  e.preventDefault();
  if (!inEditor && formatting.includes(act)) return;
  runAction(act);
});

titleEl.addEventListener('input', scheduleRefresh);
window.addEventListener('beforeprint', refresh);
// La sesión queda en el navegador, pero los archivos no: si hay algo sin guardar, el navegador avisa
window.addEventListener('beforeunload', e => {
  syncFromEditor();
  if (docs.some(d => !isBlank(d) && isDirty(d)) || bookDirty() || recorderBusy()) { e.preventDefault(); e.returnValue = ''; }
});

// ============ INICIO ============
function init() {
  buildMenubar(MENUS);
  bindTabs();
  const restored = loadSession();
  if (!restored) {
    docs = [makeDoc({ title: '', text: '' })];
    activeId = docs[0].id;
  }
  applyState();
  activate(activeId);
  // Sesiones de versiones anteriores: lo abierto cuenta como el cancionero tal como está
  if (state.cancioneroClean == null) state.cancioneroClean = bookSignature();
  // Primer inicio: se abre el cancionero de ejemplo
  if (!restored) loadExample();
  relinkAll().then(() => refresh());
}

init();
