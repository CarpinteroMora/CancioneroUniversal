'use strict';
// Dibuja la canción (atril / impresión) y los botones del transpositor.

function chordLineHtml(line, latin = isLatin()) {
  return layoutChordLine(line, t => convertTokenNotation(t, latin))
    .map(p => ' '.repeat(p.pad) + (p.isChord
      ? `<span class="chord" data-chord="${escapeHtml(splitPunct(p.text)[1])}">${escapeHtml(p.text)}</span>`
      : `<span class="chord-extra">${escapeHtml(p.text)}</span>`))
    .join('');
}

function renderLine(line) {
  if (!line.trim()) return '<div class="line blank">&nbsp;</div>';
  let m;
  if ((m = line.match(COMMENT_RE))) return `<div class="line comment-line">💬 ${inlineMd(m[1])}</div>`;
  if ((m = line.match(HEADING_RE))) return `<div class="line section-heading h${Math.min(m[1].length, 3)}">${inlineMd(m[2])}</div>`;
  const strum = parseStrumMarker(line);
  if (strum) return strumLineHtml(strum);
  if (isChordLine(line)) return `<div class="line chord-line">${chordLineHtml(line)}</div>`;
  return `<div class="line lyric-line">${inlineMd(line)}</div>`;
}

function renderHeader(title, key, tags = cur()?.tags) {
  let html = `<header class="song-header"><div class="song-title">${escapeHtml(title.trim() || 'Sin título')}</div>`;
  const meta = [];
  if (key) meta.push(`Tono: <strong>${escapeHtml(keyLabel(key))}</strong>`);
  if (state.highlight !== 'todas') meta.push(`Resaltando: <strong>${escapeHtml(VOICES[state.highlight]?.label || state.highlight)}</strong>`);
  html += `<div class="song-meta">${meta.join(' · ') || '&nbsp;'}</div>`;
  if (tags?.length) html += `<div class="song-tags" data-action="tagDialog" title="Editar tags (Ctrl+Alt+E)">${tags.map(t => tagChip(t)).join('')}</div>`;
  return html + '</header>';
}

function renderSong(title, text, key) {
  let html = renderHeader(title, key);
  let open = false;
  for (const line of text.split('\n')) {
    const vm = parseVoiceMarker(line);
    if (vm) {
      if (open) html += '</section>';
      open = false;
      if (vm.key !== 'unica') {
        const color = VOICES[vm.key]?.color || '#607d8b';
        const hl = state.highlight;
        const cls = hl === 'todas' ? '' : (hl === vm.key ? ' focus' : ' dim');
        html += `<section class="voice-section${cls}" style="--vc:${color}"><div class="voice-label">🎤 ${escapeHtml(vm.label)}</div>`;
        open = true;
      }
      continue;
    }
    html += renderLine(line);
  }
  if (open) html += '</section>';
  if (!text.trim()) html += '<div class="empty-hint">La canción está vacía. Pasa a <b>Edición</b> para escribirla.</div>';
  return html;
}

function buildTransposer() {
  const box = $('#notesContainer');
  box.innerHTML = '';
  const minor = !!detectedKey?.minor;
  for (let i = 0; i < 12; i++) {
    const btn = el('button', 'note-btn' + (ACCIDENTAL_KEYS.has(i) ? ' sharp' : ''), keyName(i, minor));
    btn.dataset.action = 'key:' + i;
    if (ACCIDENTAL_KEYS.has(i)) {
      btn.title = `También: ${spell(i, !keyPrefersFlats(i, minor), isLatin())}${minor ? 'm' : ''}`;
    }
    if (detectedKey && detectedKey.idx === i) btn.classList.add('active');
    if (!detectedKey) btn.disabled = true;
    box.appendChild(btn);
  }
  $('#keyInfo').innerHTML = detectedKey
    ? `Primer acorde: <b>${escapeHtml(convertTokenNotation(detectedKey.chord, isLatin()))}</b> → ${escapeHtml(keyLabel(detectedKey))}`
    : 'No se detectaron acordes';
}
