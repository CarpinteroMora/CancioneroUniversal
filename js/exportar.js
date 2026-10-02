'use strict';
// Exporta la canción o un cancionero como una página web (.html) de un solo archivo, con el
// aspecto del atril: se abre en cualquier navegador o celular (también enviada por WhatsApp).
// Sin JavaScript se lee completa en el tono original; con JavaScript aparecen los controles.

// ============ DATOS DE CADA CANCIÓN ============
const lineText = parts => parts.map(p => ' '.repeat(p.pad) + p.text).join('');

// Una línea de acordes en los 12 tonos y en las dos notaciones (texto; la página pone los colores)
function chordVariants(line, key) {
  const x = layoutChordLine(line, t => t).map((p, i) => p.isChord ? -1 : i).filter(i => i >= 0);
  const v = { latin: [], eng: [] };
  for (let t = 0; t < 12; t++) {
    const semis = mod12(t - key.idx);
    const moved = semis ? transposeText(line, semis, keyPrefersFlats(t, key.minor)) : line;
    v.latin.push(lineText(layoutChordLine(moved, tok => convertTokenNotation(tok, true))));
    v.eng.push(lineText(layoutChordLine(moved, tok => convertTokenNotation(tok, false))));
  }
  return { x, v };
}

// ============ AUDIOS INCRUSTADOS ============
// Los audios van dentro del .html en "calidad liviana" (AAC mono, ~1,4 MB cada 4 minutos): suenan sin
// internet en cualquier celular. El servidor local los comprime; si no puede, se usa el original.
const EMBED_MAX_BYTES = 25 * 1024 * 1024;
const isDirectMedia = a => a.kind === 'url' && /^https?:\/\//i.test(a.src) && [...AUDIO_EXT, ...VIDEO_EXT].includes(mediaExt(a.src));
const canEmbed = a => !!(a.objectUrl || audioPage(a) || isDirectMedia(a));

async function okBlob(promise) {
  try {
    const r = await promise;
    return r.ok ? await r.blob() : null;
  } catch (_) {
    return null;
  }
}

async function liteAudio(a) {
  const base = extractorBase();
  if (a.objectUrl) {
    const original = await okBlob(fetch(a.objectUrl));
    if (!original) return null;
    return await okBlob(fetch(`${base}/api/liviano`, { method: 'POST', body: original })) || original;
  }
  const page = audioPage(a);
  const src = page || (isDirectMedia(a) ? a.src : null);
  if (!src) return null;
  return await okBlob(fetch(`${base}/api/liviano?url=${encodeURIComponent(src)}`)) ||
    (page ? await okBlob(fetch(`${base}/api/audio?url=${encodeURIComponent(page)}&pref=m4a`)) : null) ||
    (!page ? await okBlob(fetch(src)) : null);
}

const blobDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// Mapa id del audio → dirección data: con el audio dentro
async function collectEmbedded(list) {
  const todo = list.flatMap(d => d.audios.filter(canEmbed));
  const out = new Map();
  let failed = 0;
  for (const [i, a] of todo.entries()) {
    toast(`Preparando audios ${i + 1} de ${todo.length}: ${a.name}…`, 600000);
    const blob = await liteAudio(a);
    if (blob && blob.size <= EMBED_MAX_BYTES) out.set(a.id, await blobDataUrl(blob.type ? blob : new Blob([blob], { type: 'audio/mp4' })));
    else failed++;
  }
  toast('');
  return { embedded: out, failed };
}

// Qué audios pueden sonar en otro equipo: incrustados o de internet (reproductor) o páginas (enlace)
function exportAudios(d, embedded = new Map()) {
  const players = [], links = [], missing = [];
  for (const a of d.audios) {
    const name = a.name + (a.voice !== 'todas' && VOICES[a.voice] ? ` · ${VOICES[a.voice].label}` : '');
    const page = extractorPageOf(a.src) || (a.extractor ? a.src : null) ||
      (a.kind === 'local' && /^https?:\/\//i.test(a.origin || '') ? a.origin : null);
    if (embedded.has(a.id)) {
      players.push({ name, src: embedded.get(a.id), speed: a.speed || 1, page });
    } else if (!page && isDirectMedia(a)) {
      players.push({ name, src: a.src, speed: a.speed || 1 });
    } else if (page || (a.kind === 'url' && /^https?:\/\//i.test(a.src))) {
      const url = page || a.src;
      links.push({ name, url, site: normalizeMediaUrl(url).streaming || '' });
    } else {
      missing.push(name);
    }
  }
  return { players, links, missing };
}

function songExportData(d, n, latin, embedded) {
  const key = detectKey(d.text);
  const lines = [], seen = new Map();
  let body = '', open = false;
  for (const line of d.text.split('\n')) {
    const vm = parseVoiceMarker(line);
    if (vm) {
      if (open) body += '</section>';
      open = false;
      if (vm.key !== 'unica') {
        body += `<section class="voice-section" data-voice="${escapeHtml(vm.key)}" data-label="${escapeHtml(vm.label)}" style="--vc:${VOICES[vm.key]?.color || '#607d8b'}"><div class="voice-label">🎤 ${escapeHtml(vm.label)}</div>`;
        open = true;
      }
      continue;
    }
    if (key && isChordLine(line)) {
      if (!seen.has(line)) { seen.set(line, lines.length); lines.push(chordVariants(line, key)); }
      body += `<div class="line chord-line" data-c="${seen.get(line)}">${chordLineHtml(line, latin)}</div>`;
    } else {
      body += renderLine(line);
    }
  }
  if (open) body += '</section>';

  const title = d.title.trim() || 'Sin título';
  const au = exportAudios(d, embedded);
  const audios = [
    ...au.players.map(p => `<div class="audio"><span class="au-name">🎵 ${escapeHtml(p.name)}</span><audio controls preload="none" src="${escapeHtml(p.src)}" data-speed="${p.speed}" data-name="${escapeHtml(p.name)}"></audio>${p.page ? `<a class="orig" href="${escapeHtml(p.page)}" target="_blank" rel="noopener" title="Abrir la página original">↗</a>` : ''}</div>`),
    ...au.links.map(l => `<div class="audio"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">▶ Escuchar ${l.site ? 'en ' + escapeHtml(l.site) : 'en su página'}</a><span>${escapeHtml(l.name)}</span></div>`),
    ...au.missing.map(m => `<div class="note">El audio «${escapeHtml(m)}» es un archivo de este equipo y no va incluido.</div>`)
  ].join('');
  const html = `<article class="song" id="c${n}">
<header class="song-header"><div class="song-title">${escapeHtml(title)}</div>
<div class="song-meta">${key ? `Tono: <strong class="key-label">${escapeHtml(keyLabel(key, latin))}</strong>` : '&nbsp;'}</div></header>
${audios ? `<div class="audios">${audios}</div>` : ''}
<div class="song-body">${body || '<div class="line blank">&nbsp;</div>'}</div>
</article>`;
  const range = [...Array(12).keys()];
  return {
    html, title, keyText: key ? keyLabel(key, latin) : '',
    data: {
      key: key ? { idx: key.idx, minor: key.minor } : null,
      names: key ? { latin: range.map(i => keyName(i, key.minor, true)), eng: range.map(i => keyName(i, key.minor, false)) } : null,
      labels: key ? { latin: range.map(i => keyLabel({ idx: i, minor: key.minor }, true)), eng: range.map(i => keyLabel({ idx: i, minor: key.minor }, false)) } : null,
      lines
    }
  };
}

// ============ PÁGINA ============
// share: { pkg, link } (compartir.js): la página lleva el cancionero para abrirlo y editarlo en la app
function buildAtrilHtml(list, { titulo = '', embedded = new Map(), share = null } = {}) {
  const latin = isLatin();
  const book = list.length > 1 || !!titulo;
  const songs = list.map((d, i) => songExportData(d, i + 1, latin, embedded));
  const pageTitle = book ? (titulo || state.cancioneroName || 'Cancionero') : songs[0].title;
  const data = {
    book, notation: latin ? 'latin' : 'eng', font: Math.max(state.fontSize, 16),
    comments: state.showComments, night: state.night, speeds: SCROLL_SPEEDS,
    scroll: clampLevel(list[0].scrollSpeed || state.scrollSpeed), songs: songs.map(s => s.data)
  };
  const index = book ? `<header class="cover"><h1>${escapeHtml(pageTitle)}</h1><p>${songs.length} canciones</p></header>
<nav class="index"><h2>Índice</h2><ol>${songs.map((s, i) =>
    `<li><a href="#c${i + 1}">${escapeHtml(s.title)}</a>${s.keyText ? ` <small>${escapeHtml(s.keyText)}</small>` : ''}</li>`).join('')}</ol></nav>` : '';
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${escapeHtml(APP_INFO.nombre)} ${escapeHtml(APP_INFO.version)}">
<title>${escapeHtml(pageTitle)}</title>
<style>${ATRIL_CSS}</style>
</head>
<body class="${state.showComments ? '' : 'no-comments'}">
<main>
${index}
${songs.map(s => s.html).join('\n')}
<p class="foot">${share ? `<a class="edit-app" href="${escapeHtml(share.link)}">✏️ Editar en ${escapeHtml(APP_INFO.nombre)}</a><br>` : ''}Hecho con ${escapeHtml(APP_INFO.nombre)}.<span class="nojs"> Si no ves los botones para cambiar el tono, abre este archivo con Chrome o Safari.</span></p>
</main>
${share ? `<script type="application/json" id="${SHARE_DATA_ID}">${JSON.stringify(share.pkg).replace(/</g, '\\u003c')}</script>\n` : ''}<script>(${atrilRuntime.toString()})(${json});</script>
</body>
</html>
`;
}

const ATRIL_CSS = `
:root { --song-font: 17px; }
* { box-sizing: border-box; }
body { margin: 0; background: #eef1f5; color: #202124; font-family: Arial, sans-serif; -webkit-text-size-adjust: 100%; }
.bar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: center;
  padding: 6px 8px; background: #fff; border-bottom: 1px solid #dadce0; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.bar .grp { display: flex; align-items: center; gap: 4px; }
.bar button, .bar select, .keys button { font: inherit; font-size: 14px; min-height: 34px; padding: 4px 10px;
  border: 1px solid #dadce0; border-radius: 17px; background: #fff; color: #202124; cursor: pointer; }
.bar button.on { background: #1a73e8; border-color: #1a73e8; color: #fff; }
.bar button:disabled { opacity: .45; cursor: default; }
.bar button.round { width: 34px; padding: 0; font-size: 18px; line-height: 1; }
.bar input[type=range] { width: 90px; accent-color: #1a73e8; }
.bar .lv { min-width: 1.4em; text-align: center; font-weight: bold; color: #1a73e8; }
.bar select { max-width: 200px; }
main { max-width: 860px; margin: 0 auto; padding: 14px 10px 50vh; }
.cover { text-align: center; padding: 22px 10px 4px; }
.cover h1 { margin: 0; font-size: 30px; }
.cover p { margin: 6px 0 0; color: #5f6368; }
.index { background: #fff; border-radius: 10px; padding: 14px 20px; margin: 12px 0 18px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.index h2 { margin: 0 0 6px; font-size: 14px; color: #5f6368; text-transform: uppercase; letter-spacing: .05em; }
.index ol { margin: 0; padding-left: 26px; columns: 2 240px; column-gap: 28px; }
.index li { padding: 4px 0; break-inside: avoid; }
.index a { color: #1a73e8; text-decoration: none; font-weight: bold; }
.index small { color: #80868b; }
.song { background: #fff; border-radius: 10px; padding: 26px 30px; margin: 0 0 18px; box-shadow: 0 1px 3px rgba(0,0,0,.12); scroll-margin-top: 64px; }
.song-header { margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
.song-title { font-size: 1.6em; font-weight: bold; }
.song-meta { font-size: .9em; color: #5f6368; margin-top: 4px; }
.keys { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: -4px 0 12px; }
.keys .lbl { font-size: 13px; color: #5f6368; margin-right: 2px; }
.keys button { min-width: 38px; padding: 2px 6px; font-size: 13px; }
.keys button.sharp { border-color: #f9ab00; background: #fef7e0; }
.keys button.on { background: #1a73e8; border-color: #1a73e8; color: #fff; font-weight: bold; }
.audios { display: flex; flex-direction: column; gap: 6px; margin: 0 0 14px; }
.audio { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 13px; color: #5f6368; }
.audio audio { height: 36px; max-width: 100%; flex: 1 1 240px; }
.audio a { color: #1a73e8; font-weight: bold; text-decoration: none; padding: 6px 12px; border: 1px solid #aecbfa; border-radius: 17px; background: #e8f0fe; }
.audio a.orig { padding: 2px 9px; font-weight: normal; }
.pchip { font: inherit; font-size: 13px; min-height: 32px; padding: 4px 14px; border: 1px solid #aecbfa; border-radius: 17px;
  background: #e8f0fe; color: #1967d2; font-weight: bold; cursor: pointer; display: none; }
.pchip.on { background: #1a73e8; border-color: #1a73e8; color: #fff; }
body.has-player .audio audio, body.has-player .au-name { display: none; }
body.has-player .pchip { display: inline-block; }
body.has-player main { padding-bottom: calc(50vh + 70px); }
.player { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: flex; align-items: center; gap: 10px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); background: #fff; border-top: 1px solid #dadce0; box-shadow: 0 -1px 6px rgba(0,0,0,.1); }
.player .pp { flex-shrink: 0; width: 44px; height: 44px; border: 0; border-radius: 50%; background: #1a73e8; color: #fff; font-size: 20px; cursor: pointer; }
.pmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.psel { font: inherit; font-size: 13px; font-weight: bold; color: #202124; border: 0; background: transparent; max-width: 100%; padding: 2px 0; cursor: pointer; }
.prow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #5f6368; font-variant-numeric: tabular-nums; }
.pseek { flex: 1; min-width: 60px; accent-color: #1a73e8; }
.speed { display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; }
.speed button { font: inherit; min-height: 34px; padding: 0 8px; border: 1px solid #dadce0; border-radius: 17px; background: #fff; cursor: pointer; }
.speed span { min-width: 3.2em; text-align: center; font-weight: bold; cursor: pointer; }
.speed span.slow { color: #1e8e3e; }
.speed span.fast { color: #d93025; }
.note { font-size: 12px; color: #80868b; }
.song-body { font-family: 'Courier New', monospace; font-size: var(--song-font); line-height: 1.5; overflow-x: auto; }
.line { white-space: pre; min-height: 1.5em; }
.chord-line, .chord { color: #d93025; font-weight: bold; }
.chord-extra { color: #80868b; font-weight: normal; }
.section-heading { font-family: Arial, sans-serif; font-weight: bold; color: #1a73e8; margin: 10px 0 2px; white-space: pre-wrap; }
.section-heading.h1 { font-size: 1.3em; }
.section-heading.h2 { font-size: 1.1em; }
.comment-line { font-family: Arial, sans-serif; font-style: italic; font-size: .9em; color: #5f6368; background: #fef7e0;
  border-left: 3px solid #f9ab00; padding: 3px 10px; margin: 4px 0; border-radius: 0 4px 4px 0; white-space: pre-wrap; }
.voice-section { border-left: 4px solid var(--vc); background: color-mix(in srgb, var(--vc) 6%, transparent);
  padding: 4px 0 6px 12px; margin: 10px 0; border-radius: 0 6px 6px 0; transition: opacity .2s; }
.voice-section .lyric-line { color: color-mix(in srgb, var(--vc) 45%, #202124); }
.voice-section.dim { opacity: .3; }
.voice-section.focus { box-shadow: 0 0 0 2px color-mix(in srgb, var(--vc) 35%, transparent); }
.voice-label { display: inline-block; font-family: Arial, sans-serif; font-size: 11px; font-weight: bold; color: #fff;
  background: var(--vc); padding: 2px 9px; border-radius: 10px; margin: 2px 0 4px; }
.strum-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; white-space: normal; margin: 6px 0; font-family: Arial, sans-serif; }
.strum-name { font-size: .85em; font-weight: bold; color: #5f6368; }
.strum-svg { display: block; flex-shrink: 0; }
body.no-chords .chord-line, body.no-chords .keys, body.no-keys .keys { display: none; }
body.no-comments .comment-line { display: none; }
.foot { text-align: center; font-size: 12px; color: #80868b; margin: 24px 0; line-height: 2.4; }
.edit-app { display: inline-block; font-size: 14px; font-weight: bold; text-decoration: none; padding: 6px 14px;
  border: 1px solid #81c995; border-radius: 17px; background: #e6f4ea; color: #137333; line-height: 1.5; }
.bar .edit-app { padding: 6px 12px; min-height: 34px; white-space: nowrap; }
@media screen {
  body.night { background: #000; color: #fff; }
  body.night .bar { background: #111; border-color: #333; box-shadow: none; }
  body.night .bar button, body.night .bar select, body.night .keys button, body.night .speed button { background: #000; border-color: #555; color: #fff; }
  body.night .bar button.on, body.night .keys button.on { background: #fff; border-color: #fff; color: #000; }
  body.night .keys button.sharp { background: #1a1400; border-color: #b38f00; }
  body.night .keys .lbl, body.night .song-meta, body.night .strum-name, body.night .audio, body.night .cover p, body.night .index small { color: #bbb; }
  body.night .bar .lv { color: #fff; }
  body.night .cover h1 { color: #fff; }
  body.night .index, body.night .song { background: #000; box-shadow: 0 0 0 1px #262626; }
  body.night .index h2 { color: #9e9e9e; }
  body.night .index a, body.night .section-heading { color: #8ab4f8; }
  body.night .song-header { border-color: #333; }
  body.night .line { color: #fff; }
  body.night .chord-line, body.night .chord { color: #ffd400; }
  body.night .chord-extra { color: #9e9e9e; }
  body.night .comment-line { background: #1a1a1a; color: #e0e0e0; border-color: #b38f00; }
  body.night .voice-section { background: color-mix(in srgb, var(--vc) 14%, #000); }
  body.night .voice-section .lyric-line { color: color-mix(in srgb, var(--vc) 30%, #fff); }
  body.night .strum-svg { filter: invert(1) hue-rotate(180deg); }
  body.night .audio a, body.night .pchip { background: #10213a; border-color: #2d4a73; color: #aecbfa; }
  body.night .pchip.on { background: #fff; border-color: #fff; color: #000; }
  body.night .player { background: #111; border-color: #333; box-shadow: none; }
  body.night .psel { color: #fff; background: #111; }
  body.night .prow { color: #bbb; }
  body.night .foot, body.night .note { color: #777; }
  body.night .edit-app { background: #0d2616; border-color: #2e7d46; color: #81c995; }
}
@media (max-width: 600px) {
  main { padding: 8px 0 50vh; }
  .song { padding: 16px 12px; border-radius: 0; margin: 0 0 10px; }
  .index { border-radius: 0; }
  .cover h1 { font-size: 24px; }
  .bar { gap: 4px; padding: 5px 6px; flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .bar .grp { flex-shrink: 0; }
  .song { scroll-margin-top: 52px; }
  .bar button, .bar select { padding: 4px 8px; font-size: 13px; }
  .bar input[type=range] { width: 70px; }
  .player { gap: 6px; padding-left: 8px; padding-right: 8px; }
  .player .pp { width: 40px; height: 40px; }
  .speed button { padding: 0 5px; }
  .speed span { min-width: 2.6em; }
}
@media print {
  .bar, .keys, .audios, .foot, .player { display: none !important; }
  body { background: #fff; }
  main { padding: 0; max-width: none; }
  .song { box-shadow: none; padding: 0; margin: 0; break-before: page; }
  .index + .song, main > .song:first-child { break-before: auto; }
  .index { box-shadow: none; }
  .song-body { overflow: visible; }
}
`;

// ============ CÓDIGO DE LA PÁGINA EXPORTADA ============
// Se copia tal cual dentro del .html: no puede usar nada de la app.
function atrilRuntime(D) {
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('canciotras-html') || '{}'); } catch (_) {}
  const st = {
    n: saved.n || D.notation, f: saved.f || D.font, fit: window.innerWidth < 700,
    chords: true, keys: !!saved.keys, night: saved.night ?? !!D.night,
    comments: D.comments, voice: 'todas', lv: D.scroll, on: false
  };
  const remember = () => { try { localStorage.setItem('canciotras-html', JSON.stringify({ n: st.n, f: st.f, keys: st.keys, night: st.night })); } catch (_) {} };
  $$('.nojs').forEach(n => n.remove());

  const songs = $$('.song').map((node, i) => ({ node, d: D.songs[i], key: D.songs[i].key ? D.songs[i].key.idx : null }));
  const SHARP = [1, 3, 6, 8, 10];

  function chordHtml(line, extra) {
    let i = -1;
    return esc(line).replace(/\S+/g, tok => (++i, extra.includes(i) ? `<span class="chord-extra">${tok}</span>` : `<span class="chord">${tok}</span>`));
  }
  function paint(s) {
    const d = s.d;
    if (!d.key) return;
    $$('.chord-line[data-c]', s.node).forEach(n => { const l = d.lines[+n.dataset.c]; n.innerHTML = chordHtml(l.v[st.n][s.key], l.x); });
    const lbl = s.node.querySelector('.key-label');
    if (lbl) lbl.textContent = d.labels[st.n][s.key];
    $$('.keys [data-k]', s.node).forEach(b => { b.textContent = d.names[st.n][+b.dataset.k]; b.classList.toggle('on', +b.dataset.k === s.key); });
  }

  // Tono de cada canción
  songs.forEach(s => {
    if (!s.d.key) return;
    const row = el('div', 'keys', '<span class="lbl">Tono</span>' +
      Array.from({ length: 12 }, (_, i) => `<button data-k="${i}"${SHARP.includes(i) ? ' class="sharp"' : ''}></button>`).join('') +
      '<button data-reset title="Volver al tono original">↺</button>');
    s.node.querySelector('.song-header').after(row);
    row.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.k != null) s.key = +b.dataset.k;
      else if (b.hasAttribute('data-reset')) s.key = s.d.key.idx;
      paint(s);
      fit();
    });
  });

  // Reproductor abajo, como la barra de audio de la app. Sin JavaScript quedan los reproductores
  // normales de cada canción.
  const audios = $$('audio');
  let player = null;
  if (audios.length) {
    document.body.classList.add('has-player');
    const pbar = el('div', 'player', '<button class="pp" title="Reproducir o pausar">▶</button>' +
      '<div class="pmain"><div class="ptop"><select class="psel" title="Elegir audio"></select></div>' +
      '<div class="prow"><span class="ptime">0:00</span><input type="range" class="pseek" min="0" max="1000" value="0" title="Avanzar o retroceder"><span class="pdur">0:00</span></div></div>' +
      '<span class="speed"><button data-sp="-1" title="Más lento">🐢</button><span class="psp" title="Velocidad normal">1×</span><button data-sp="1" title="Más rápido">🐇</button></span>');
    document.body.append(pbar);
    const pp = pbar.querySelector('.pp'), sel = pbar.querySelector('.psel'), seek = pbar.querySelector('.pseek');
    const time = pbar.querySelector('.ptime'), dur = pbar.querySelector('.pdur'), sp = pbar.querySelector('.psp');
    const fmt = s => !isFinite(s) ? '0:00' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const songOf = a => a.closest('.song');
    const label = a => {
      const t = songOf(a).querySelector('.song-title').textContent;
      return D.book ? `${t} · ${a.dataset.name}` : a.dataset.name;
    };
    let cur = null, dragging = false;
    const chips = new Map();
    audios.forEach(a => {
      a.preservesPitch = true;
      a.defaultPlaybackRate = a.playbackRate = +a.dataset.speed || 1;
      const chip = el('button', 'pchip', '▶ ' + esc(a.dataset.name));
      chip.title = 'Escuchar abajo';
      chip.onclick = () => (cur === a && !a.paused ? a.pause() : player.use(a, true));
      a.after(chip);
      chips.set(a, chip);
      a.addEventListener('ratechange', () => a === cur && ui());
      ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange'].forEach(ev => a.addEventListener(ev, () => {
        if (ev === 'loadedmetadata') a.playbackRate = a.defaultPlaybackRate;
        if (a === cur) ui();
      }));
    });
    function ui() {
      if (!cur) return;
      pp.textContent = cur.paused ? '▶' : '⏸';
      if (!dragging) seek.value = cur.duration ? Math.round(cur.currentTime / cur.duration * 1000) : 0;
      time.textContent = fmt(cur.currentTime);
      dur.textContent = fmt(cur.duration);
      const v = cur.playbackRate;
      sp.textContent = String(Math.round(v * 100) / 100).replace('.', ',') + '×';
      sp.className = 'psp' + (v < 1 ? ' slow' : v > 1 ? ' fast' : '');
      chips.forEach((c, a) => {
        c.classList.toggle('on', a === cur);
        c.textContent = (a === cur && !a.paused ? '⏸ ' : '▶ ') + a.dataset.name;
      });
    }
    player = {
      use(a, play) {
        if (cur && cur !== a) cur.pause();
        cur = a;
        sel.innerHTML = audios.map((x, i) => `<option value="${i}"${x === a ? ' selected' : ''}>${esc(label(x))}</option>`).join('');
        if (a.readyState === 0) { a.preload = 'metadata'; a.load(); }
        ui();
        if (play) a.play().catch(() => {});
      },
      get current() { return cur; }
    };
    pp.onclick = () => { if (cur) cur.paused ? cur.play().catch(() => {}) : cur.pause(); };
    sel.onchange = () => player.use(audios[+sel.value], cur && !cur.paused);
    seek.addEventListener('input', () => {
      dragging = true;
      if (cur && cur.duration) time.textContent = fmt(seek.value / 1000 * cur.duration);
    });
    seek.addEventListener('change', () => {
      dragging = false;
      if (cur && cur.duration) cur.currentTime = seek.value / 1000 * cur.duration;
    });
    pbar.querySelector('.speed').addEventListener('click', e => {
      if (!cur) return;
      const b = e.target.closest('[data-sp]');
      const v = b ? cur.playbackRate + 0.05 * +b.dataset.sp : e.target === sp ? 1 : null;
      if (v == null) return;
      cur.defaultPlaybackRate = cur.playbackRate = Math.min(1.5, Math.max(0.25, Math.round(v * 20) / 20));
      ui();
    });
    player.use(audios[0], false);
    // Al llegar a otra canción, el reproductor ofrece su audio (si no está sonando otro)
    if ('IntersectionObserver' in window && D.book) {
      const io = new IntersectionObserver(entries => {
        const seen = entries.filter(e => e.isIntersecting).map(e => e.target.querySelector('audio')).filter(Boolean);
        if (seen.length && (!cur || cur.paused) && seen[0] !== cur) player.use(seen[0], false);
      }, { rootMargin: '-35% 0px -55% 0px' });
      songs.forEach(s => io.observe(s.node));
    }
  }

  // Letra: tamaño y ajuste al ancho de la pantalla
  function fit() {
    document.documentElement.style.setProperty('--song-font', st.f + 'px');
    songs.forEach(s => {
      const b = s.node.querySelector('.song-body');
      b.style.fontSize = '';
      if (!st.fit) return;
      const cw = b.clientWidth, sw = b.scrollWidth;
      // Por debajo de 11 px no se lee bien: una línea muy larga se desliza de lado
      if (sw > cw + 1) b.style.fontSize = Math.max(11, Math.floor(st.f * cw / sw * 10) / 10 - 0.3) + 'px';
    });
  }

  // Desplazamiento automático
  let acc = 0, last = 0;
  function step(ts) {
    if (!st.on) return;
    if (last) {
      acc += (ts - last) / 1000 * D.speeds[st.lv - 1];
      const px = Math.floor(acc);
      if (px) { window.scrollBy(0, px); acc -= px; }
    }
    last = ts;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) { scroll(false); return; }
    requestAnimationFrame(step);
  }
  function scroll(on) {
    st.on = on;
    last = 0; acc = 0;
    playBtn.textContent = on ? '⏸ Pausa' : '▶ Desplazar';
    playBtn.classList.toggle('on', on);
    if (on) requestAnimationFrame(step);
  }

  // Barra de controles
  const voices = new Map();
  $$('.voice-section').forEach(v => voices.set(v.dataset.voice, v.dataset.label));
  const hasComments = !!document.querySelector('.comment-line');
  const hasChords = songs.some(s => s.d.key);
  const bar = el('div', 'bar', [
    D.book ? `<div class="grp"><select data-go title="Ir a una canción"><option value="">☰ Canciones…</option>${songs.map((s, i) =>
      `<option value="c${i + 1}">${i + 1}. ${esc(s.node.querySelector('.song-title').textContent)}</option>`).join('')}</select></div>` : '',
    hasChords ? '<div class="grp"><button data-a="notation" title="Cambiar la notación de los acordes"></button><button data-a="chords" class="on" title="Mostrar u ocultar los acordes">Acordes</button>' +
      '<button data-a="keys" title="Mostrar u ocultar los botones para cambiar el tono">🎼 Tono</button></div>' : '',
    '<div class="grp"><button data-a="smaller" title="Letra más chica">A−</button><button data-a="bigger" title="Letra más grande">A+</button>' +
      '<button data-a="fit" title="Ajustar la letra al ancho de la pantalla">↔ Ajustar</button>' +
      '<button data-a="night"></button></div>',
    hasComments ? '<div class="grp"><button data-a="comments" title="Mostrar u ocultar los comentarios">💬</button></div>' : '',
    voices.size ? `<div class="grp"><select data-voice title="Resaltar una voz"><option value="todas">🎤 Todas las voces</option>${Array.from(voices).map(([k, l]) =>
      `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></div>` : '',
    '<div class="grp"><button data-a="play" title="Desplazamiento automático (barra espaciadora)">▶ Desplazar</button>' +
      '<button data-a="slower" class="round" title="Más lento">−</button><input type="range" min="1" max="20" step="1" title="Velocidad del desplazamiento">' +
      '<button data-a="faster" class="round" title="Más rápido">+</button><span class="lv"></span></div>'
  ].join(''));
  const editLink = document.querySelector('.foot .edit-app');
  if (editLink) {
    const a = el('a', 'edit-app', '✏️ Editar');
    a.href = editLink.href;
    a.title = editLink.textContent.replace(/^\S+\s/, '') + ' (abre el cancionero en la app para modificarlo y guardarlo)';
    const g = el('div', 'grp');
    g.append(a);
    bar.prepend(g);
  }
  document.body.prepend(bar);
  const playBtn = bar.querySelector('[data-a="play"]');
  const range = bar.querySelector('input[type=range]');
  const setLevel = v => { st.lv = Math.min(20, Math.max(1, Math.round(v) || 5)); range.value = st.lv; bar.querySelector('.lv').textContent = st.lv; };
  range.addEventListener('input', () => setLevel(+range.value));

  function sync() {
    const nb = bar.querySelector('[data-a="notation"]');
    if (nb) nb.textContent = st.n === 'latin' ? 'Do → C' : 'C → Do';
    bar.querySelector('[data-a="fit"]').classList.toggle('on', st.fit);
    const cb = bar.querySelector('[data-a="comments"]');
    if (cb) cb.classList.toggle('on', st.comments);
    document.body.classList.toggle('no-comments', !st.comments);
    document.body.classList.toggle('no-chords', !st.chords);
    const chb = bar.querySelector('[data-a="chords"]');
    if (chb) chb.classList.toggle('on', st.chords);
    document.body.classList.toggle('no-keys', !st.keys);
    document.body.classList.toggle('night', st.night);
    document.documentElement.style.colorScheme = st.night ? 'dark' : '';
    const nb2 = bar.querySelector('[data-a="night"]');
    nb2.textContent = st.night ? '☀️' : '🌙';
    nb2.title = st.night ? 'Modo día' : 'Modo noche: fondo negro y letra blanca, para el escenario';
    const kb = bar.querySelector('[data-a="keys"]');
    if (kb) { kb.classList.toggle('on', st.keys && st.chords); kb.disabled = !st.chords; }
  }

  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'notation') { st.n = st.n === 'latin' ? 'eng' : 'latin'; songs.forEach(paint); }
    else if (a === 'chords') st.chords = !st.chords;
    else if (a === 'keys') st.keys = !st.keys;
    else if (a === 'night') st.night = !st.night;
    else if (a === 'smaller') st.f = Math.max(10, st.f - 1);
    else if (a === 'bigger') st.f = Math.min(40, st.f + 1);
    else if (a === 'fit') st.fit = !st.fit;
    else if (a === 'comments') st.comments = !st.comments;
    else if (a === 'play') { scroll(!st.on); return; }
    else if (a === 'slower') { setLevel(st.lv - 1); return; }
    else if (a === 'faster') { setLevel(st.lv + 1); return; }
    remember();
    sync();
    fit();
  });
  bar.addEventListener('change', e => {
    if (e.target.matches('[data-go]') && e.target.value) {
      document.getElementById(e.target.value).scrollIntoView({ behavior: 'smooth' });
      e.target.value = '';
    } else if (e.target.matches('[data-voice]')) {
      const v = e.target.value;
      $$('.voice-section').forEach(s => {
        s.classList.toggle('focus', v !== 'todas' && s.dataset.voice === v);
        s.classList.toggle('dim', v !== 'todas' && s.dataset.voice !== v);
      });
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, select, textarea, button, audio, a')) return;
    e.preventDefault();
    scroll(!st.on);
  });
  window.addEventListener('resize', fit);

  setLevel(D.scroll);
  songs.forEach(paint);
  sync();
  fit();
}

// ============ EXPORTAR ============
// Título y canciones del cancionero (también lo usan las exportaciones a .pptx, .docx y .odt)
function bookPickerHtml(songs) {
  return `<label class="field"><span>Título del cancionero</span>
      <input type="text" id="xTitle" value="${escapeHtml(state.cancioneroName || 'Mi cancionero')}"></label>
    <div class="export-head"><span>Canciones (en el orden de las pestañas)</span>
      <button type="button" class="linkish" id="xAll">Marcar todas</button> · <button type="button" class="linkish" id="xNone">Ninguna</button></div>
    <div class="export-list">${songs.map((d, i) =>
      `<label><input type="checkbox" data-i="${i}" checked> ${escapeHtml(d.title.trim() || 'Sin título')}</label>`).join('')}</div>`;
}

function bookPickerOpen(dlg) {
  dlg.querySelector('#xTitle').select();
  const all = on => dlg.querySelectorAll('.export-list input').forEach(c => { c.checked = on; });
  dlg.querySelector('#xAll').onclick = () => all(true);
  dlg.querySelector('#xNone').onclick = () => all(false);
}

function bookPickerRead(dlg, songs) {
  const titulo = dlg.querySelector('#xTitle').value.trim();
  if (!titulo) return modalFail(dlg, 'Escribe un título para el cancionero.');
  const chosen = [...dlg.querySelectorAll('.export-list input:checked')].map(c => songs[+c.dataset.i]);
  if (!chosen.length) return modalFail(dlg, 'Marca al menos una canción.');
  return { titulo, chosen };
}

// Opción de incluir los audios: solo aparece si alguna canción tiene audios que se puedan incluir
function embedOptionHtml(list, server) {
  const n = list.reduce((s, d) => s + d.audios.filter(canEmbed).length, 0);
  if (!n) return '';
  return `<label class="export-embed"><input type="checkbox" id="xEmbed" checked>
      Incluir los audios dentro del archivo (${n === 1 ? '1 audio' : n + ' audios'}, calidad liviana: suenan sin internet)</label>
    <p class="hint">${server
      ? 'Cada audio ocupa alrededor de 1,5 MB por cada 4 minutos. Si no los incluyes, quedan como enlaces que necesitan internet.'
      : 'El reproductor de Cancionero Universal no está funcionando: solo se incluirán los archivos de este equipo, sin comprimir. Los de YouTube y otras páginas quedarán como enlaces.'}</p>`;
}

async function saveAtrilHtml(list, name, titulo, withAudio) {
  const save = await pickSaveTarget(safeFileName(name) + '.html', 'text/html', '.html', 'Página web');
  if (!save) return;
  let embedded = new Map(), failed = 0;
  if (withAudio) ({ embedded, failed } = await collectEmbedded(list));
  const { pkg } = buildSharePackage(list, titulo || name);
  const share = { pkg, link: await packToLink(pkg) };
  const html = new Blob([buildAtrilHtml(list, { titulo, embedded, share })], { type: 'text/html;charset=utf-8' });
  const saved = await save(html);
  if (!saved) return;
  const size = html.size >= 1024 * 1024 ? `${(html.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(html.size / 1024))} KB`;
  const notes = [
    embedded.size ? `Lleva ${embedded.size === 1 ? '1 audio' : embedded.size + ' audios'} adentro.` : '',
    failed ? `${failed === 1 ? '1 audio no se pudo incluir' : failed + ' audios no se pudieron incluir'} y quedó como enlace.` : ''
  ].filter(Boolean).join(' ');
  toast(`Página guardada: ${saved} (${size}). ${notes} Para WhatsApp envíala como Documento; si en el celular no aparecen los botones, que la abran con Chrome o Safari.`, failed ? 12000 : 9000);
}

async function exportSongHtml() {
  syncFromEditor();
  const d = cur();
  if (isBlank(d)) { toast('La canción está vacía'); return; }
  const name = d.title.trim() || 'Sin título';
  if (!d.audios.some(canEmbed)) return saveAtrilHtml([d], name, '', false);
  const server = !!(await extractorStatus())?.liviano;
  const res = await showModal({
    title: 'Exportar como página web',
    body: `<p>Queda un solo archivo <b>.html</b> con el aspecto del atril: se abre en cualquier navegador o celular
        y se puede enviar por WhatsApp como Documento.</p>${embedOptionHtml([d], server)}`,
    buttons: [
      { label: 'Cancelar' },
      { label: 'Exportar', primary: true, onClick: dlg => ({ withAudio: !!dlg.querySelector('#xEmbed')?.checked }) }
    ]
  });
  if (res) return saveAtrilHtml([d], name, '', res.withAudio);
}

async function exportBookHtml() {
  syncFromEditor();
  const songs = docs.filter(d => !isBlank(d));
  if (!songs.length) { toast('No hay canciones abiertas para exportar'); return; }
  const server = songs.some(d => d.audios.some(canEmbed)) && !!(await extractorStatus())?.liviano;
  const res = await showModal({
    title: 'Exportar cancionero como página web',
    body: `${bookPickerHtml(songs)}
      <p class="hint">Queda un solo archivo <b>.html</b> con el aspecto del atril: se abre en cualquier navegador o celular,
        con botones para cambiar el tono, la letra y el desplazamiento. Se puede enviar por WhatsApp como Documento.</p>
      ${embedOptionHtml(songs, server)}`,
    onOpen: bookPickerOpen,
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Exportar', primary: true,
        onClick: dlg => {
          const r = bookPickerRead(dlg, songs);
          return r && { ...r, withAudio: !!dlg.querySelector('#xEmbed')?.checked };
        }
      }
    ]
  });
  if (res) return saveAtrilHtml(res.chosen, res.titulo, res.titulo, res.withAudio);
}
