'use strict';
// Utilidades de interfaz: DOM, avisos, diálogos, guardado de archivos y barra de menús.

const $ = s => document.querySelector(s);
const editor = $('#editor');
const titleEl = $('#docTitle');

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

// Librerías de vendor/ que solo se cargan cuando hacen falta (funciona también en file://)
const loadedScripts = new Map();
function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { loadedScripts.delete(src); s.remove(); reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return loadedScripts.get(src);
}

// ============ AVISOS ============
function toast(msg, ms = 2600) {
  const t = $('#toast');
  clearTimeout(toast.timer);
  if (!msg) { t.classList.remove('show'); return; }
  t.textContent = msg;
  t.classList.add('show');
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

// ============ DIÁLOGOS ============
// Cada botón: { label, primary, value, onClick(dlg) }. Si onClick devuelve false, el diálogo sigue abierto.
function showModal({ title, body, buttons = [{ label: 'Cerrar', primary: true }], onOpen, wide = false }) {
  return new Promise(resolve => {
    const dlg = $('#modal');
    dlg.className = wide ? 'wide' : '';
    dlg.innerHTML = `<form method="dialog"><h2>${title}</h2><div class="modal-body">${body}</div>
      <div class="modal-error"></div><div class="modal-actions"></div></form>`;
    const actions = dlg.querySelector('.modal-actions');
    let primaryBtn = null;
    for (const b of buttons) {
      const btn = el('button', b.primary ? 'btn primary' : 'btn', b.label);
      btn.type = 'button';
      btn.onclick = () => {
        const r = b.onClick ? b.onClick(dlg) : (b.value ?? null);
        if (r === false) return;
        resolve(r);
        dlg.close();
      };
      if (b.primary) primaryBtn = btn;
      actions.appendChild(btn);
    }
    dlg.querySelector('form').onsubmit = e => { e.preventDefault(); primaryBtn?.click(); };
    // El aviso de cierre del diálogo anterior puede llegar cuando este ya se abrió: se ignora
    dlg.onclose = () => { if (!dlg.open) resolve(null); };
    dlg.showModal();
    onOpen?.(dlg);
  });
}

function modalFail(dlg, msg) {
  dlg.querySelector('.modal-error').textContent = msg;
  return false;
}

// ============ GUARDAR ARCHIVOS ============
async function saveFile(content, filename, mime, ext, description) {
  const target = await pickSaveTarget(filename, mime, ext, description);
  return target ? target(content) : false;
}

// Carpeta del Escritorio para las exportaciones (la crea el servidor local)
const EXPORT_FOLDER = 'Cancionero Universal';
const isMobileDevice = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

// Elige dónde guardar (el navegador solo lo permite justo después de un clic) y devuelve una función
// que escribe el contenido más tarde; null si se canceló.
// En el PC siempre pregunta, empezando en la carpeta de exportar. Donde no se puede preguntar
// (Android, iPhone, Firefox) el archivo va a Descargas y en el celular se ofrece Compartir.
async function pickSaveTarget(filename, mime, ext, description) {
  if (window.showSaveFilePicker) {
    const folder = await handleGet('exportar');
    if (!folder && !localStorage.getItem('canciotras-exportado')) {
      toast(`Te recomendamos guardar en la carpeta «${EXPORT_FOLDER}» de tu Escritorio`, 8000);
    }
    const ask = startIn => window.showSaveFilePicker({
      id: 'cancionero-universal', startIn, suggestedName: filename,
      types: [{ description, accept: { [mime]: [ext] } }]
    });
    try {
      let handle;
      try {
        handle = await ask(folder || 'desktop');
      } catch (err) {
        // La carpeta guardada pudo haberse borrado o movido
        if (err.name === 'AbortError' || !folder) throw err;
        handle = await ask('desktop');
      }
      localStorage.setItem('canciotras-exportado', '1');
      return async content => {
        const w = await handle.createWritable();
        await w.write(content);
        await w.close();
        return handle.name;
      };
    } catch (err) {
      if (err.name === 'AbortError') return null;
    }
  }
  return async content => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (isMobileDevice()) offerShare(blob, filename, mime);
    else if (!localStorage.getItem('canciotras-aviso-descargas')) {
      localStorage.setItem('canciotras-aviso-descargas', '1');
      showModal({
        title: 'El archivo quedó en Descargas',
        body: `<p class="share-file">«${escapeHtml(filename)}» quedó en tu carpeta <b>Descargas</b>.</p>
          <p class="hint">Este navegador no deja elegir la carpeta desde la página. En Firefox puedes activar
          <b>Ajustes → General → Descargas → «Preguntar siempre dónde guardar los archivos»</b>.
          Con Chrome o Edge se pregunta siempre, empezando en la carpeta «${EXPORT_FOLDER}» del Escritorio.</p>`
      });
    }
    return filename;
  };
}

// En el celular: el archivo ya está en Descargas; Compartir lo manda a WhatsApp, Drive, Archivos…
// (compartir necesita un toque del usuario, por eso va en un botón)
function offerShare(blob, filename, mime) {
  const file = new File([blob], filename, { type: mime });
  let canShare = false;
  try { canShare = !!navigator.canShare?.({ files: [file] }); } catch (_) {}
  showModal({
    title: 'Archivo listo',
    body: `<p class="share-file">«${escapeHtml(filename)}» quedó en la carpeta <b>Descargas</b>.</p>
      ${canShare ? '<p class="hint">Con <b>Compartir</b> lo envías por WhatsApp, lo guardas en Drive o lo abres con otra aplicación.</p>' : ''}`,
    buttons: [
      { label: 'Cerrar', primary: !canShare },
      ...(canShare ? [{
        label: 'Compartir…', primary: true,
        onClick: () => { navigator.share({ files: [file], title: filename }).catch(() => {}); }
      }] : [])
    ]
  });
}

// ============ BARRA DE MENÚS ============
let openMenu = null;

function closeMenus() {
  openMenu?.classList.remove('open');
  openMenu = null;
}

function fillDropdown(dd, items) {
  dd.innerHTML = '';
  for (const it of items) {
    if (it.sep) { dd.appendChild(el('div', 'menu-sep')); continue; }
    if (it.group) { dd.appendChild(el('div', 'menu-group', it.group)); continue; }
    const row = el('div', 'menu-item');
    row.setAttribute('role', 'menuitem');
    if (it.check?.()) row.classList.add('checked');
    if (it.disabled?.()) row.classList.add('disabled');
    const label = el('span', 'menu-label');
    if (it.color) {
      const dot = el('span', 'menu-dot');
      dot.style.background = it.color;
      label.appendChild(dot);
    }
    label.appendChild(document.createTextNode(it.label));
    row.appendChild(label);
    if (it.key) row.appendChild(el('span', 'shortcut', it.key));
    row.addEventListener('mousedown', e => e.preventDefault());
    if (it.submenu) {
      row.classList.add('has-sub');
      row.setAttribute('aria-haspopup', 'true');
      row.appendChild(el('span', 'sub-arrow', '▸'));
      const sub = el('div', 'menu-dropdown menu-sub');
      fillDropdown(sub, it.submenu);
      row.appendChild(sub);
      const openSub = () => {
        dd.querySelectorAll(':scope > .sub-open').forEach(r => r !== row && r.classList.remove('sub-open'));
        row.classList.add('sub-open');
        sub.classList.remove('flip');
        if (sub.getBoundingClientRect().right > window.innerWidth - 4) sub.classList.add('flip');
      };
      // En pantallas táctiles el toque también simula el paso del ratón: solo el ratón abre al pasar
      row.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') openSub(); });
      row.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') row.classList.remove('sub-open'); });
      row.addEventListener('click', e => {
        if (e.target.closest('.menu-sub')) return;
        if (row.classList.contains('sub-open')) row.classList.remove('sub-open'); else openSub();
      });
    } else {
      row.addEventListener('click', e => { e.stopPropagation(); closeMenus(); runAction(it.action); });
    }
    dd.appendChild(row);
  }
}

function openMenuFor(wrap, menu) {
  closeMenus();
  const dd = wrap.querySelector('.menu-dropdown');
  fillDropdown(dd, menu.items);
  dd.style.left = '';
  wrap.classList.add('open');
  openMenu = wrap;
  const over = dd.getBoundingClientRect().right - (window.innerWidth - 4);
  if (over > 0) dd.style.left = -over + 'px';
}

function buildMenubar(menus) {
  const bar = $('#menubar');
  for (const menu of menus) {
    const wrap = el('div', 'menu');
    const title = el('button', 'menu-title', menu.label);
    title.type = 'button';
    wrap.append(title, el('div', 'menu-dropdown'));
    title.addEventListener('mousedown', e => {
      e.preventDefault();
      if (openMenu === wrap) closeMenus(); else openMenuFor(wrap, menu);
    });
    title.addEventListener('pointerenter', e => {
      if (e.pointerType === 'mouse' && openMenu && openMenu !== wrap) openMenuFor(wrap, menu);
    });
    bar.appendChild(wrap);
  }
}

document.addEventListener('mousedown', e => {
  if (openMenu && !e.target.closest('.menu')) closeMenus();
  if (e.target.closest('.toolbar button, .transposer button, .atril-controls button')) e.preventDefault();
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (b && !b.disabled) runAction(b.dataset.action);
});
