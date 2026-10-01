'use strict';
// Formato en línea, Markdown (exportar / abrir), ChordPro y HTML pegado.

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============ FORMATO EN LÍNEA ============
function inlineMd(s) {
  let h = escapeHtml(s);
  h = h.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^\w*])\*(?=\S)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>');
  h = h.replace(/(^|[^\w])_(?=\S)(.+?)_(?!\w)/g, '$1<em>$2</em>');
  h = h.replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, '<u>$1</u>');
  return h || '&nbsp;';
}

function stripInlineMd(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*([^*\n]+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(.+?)_(?!\w)/g, '$1$2')
    .replace(/<\/?u>/g, '');
}

// ============ HTML PEGADO (Docs, Word, web) ============
function hasRichFormatting(html) {
  return /<(b|strong|i|em|u)\b|font-weight|font-style|text-decoration/i.test(html);
}

function htmlToMd(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const BLOCK = /^(P|DIV|H[1-6]|LI|TR|UL|OL|TABLE|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER)$/;
  const SKIP = /^(STYLE|SCRIPT|HEAD|META|TITLE|LINK)$/;
  const SEP = '\u0001';

  function wrap(inner, mark, close = mark) {
    return inner.split('\n').map(l => {
      const m = l.match(/^(\s*)([\s\S]*?)(\s*)$/);
      return m[2] ? m[1] + mark + m[2] + close + m[3] : l;
    }).join('\n');
  }

  function walk(node, ctx) {
    if (node.nodeType === 3) {
      let t = node.nodeValue;
      if (!ctx.pre) t = t.replace(/[ \t\n\r]+/g, ' ');
      return t.replace(/\u00a0/g, ' ');
    }
    if (node.nodeType !== 1 || SKIP.test(node.tagName)) return '';
    const tag = node.tagName;
    if (tag === 'BR') return '\n';
    const st = node.style || {};
    const fw = st.fontWeight || '';
    const pre = ctx.pre || tag === 'PRE' || /^pre/.test(st.whiteSpace || '');
    const bold = !ctx.bold && ((/^(B|STRONG)$/.test(tag) && !/normal|[1-5]00/.test(fw)) || /bold|[6-9]00/.test(fw));
    const italic = !ctx.italic && (/^(I|EM)$/.test(tag) || st.fontStyle === 'italic');
    const underline = !ctx.underline && (tag === 'U' || /underline/.test(st.textDecoration || st.textDecorationLine || ''));
    const sub = { pre, bold: ctx.bold || bold, italic: ctx.italic || italic, underline: ctx.underline || underline };
    let inner = '';
    node.childNodes.forEach(c => { inner += walk(c, sub); });
    if (underline) inner = wrap(inner, '<u>', '</u>');
    if (italic) inner = wrap(inner, '_');
    if (bold) inner = wrap(inner, '**');
    return BLOCK.test(tag) ? SEP + inner + SEP : inner;
  }

  return walk(doc.body, { pre: false }).replace(/\u0001+/g, '\n').replace(/^\n+|\n+$/g, '');
}

function clipboardToText(html, text, plain) {
  return (!plain && html && hasRichFormatting(html)) ? htmlToMd(html) : (text || '');
}

// ============ CHORDPRO ============
const CHORDPRO_INLINE = /\[(?:Do|Re|Mi|Fa|Sol|La|Si|DO|RE|MI|FA|SOL|LA|SI|[A-G])(?:#|b)?[^\]\s]{0,10}\]/g;
const looksLikeChordPro = t =>
  /^\s*\{\s*(title|t|soc|start_of_chorus|c|comment)\s*[:}]/im.test(t) || (t.match(CHORDPRO_INLINE) || []).length >= 2;

function splitChordProLine(line) {
  const re = /\[([^\]]+)\]/g;
  let chords = '', lyric = '', last = 0, m;
  while ((m = re.exec(line))) {
    lyric += line.slice(last, m.index);
    last = re.lastIndex;
    if (chords.length > lyric.length) lyric += ' '.repeat(chords.length - lyric.length);
    chords = chords.padEnd(lyric.length, ' ') + m[1] + ' ';
  }
  lyric += line.slice(last);
  return [chords.trimEnd(), lyric.trimEnd()];
}

function chordProToText(raw) {
  let title = '';
  const out = [];
  for (const line of raw.split('\n')) {
    const d = line.match(/^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i);
    if (d) {
      const k = d[1].toLowerCase(), val = d[2] || '';
      if (k === 'title' || k === 't') title = val;
      else if (['subtitle', 'st', 'artist', 'comment', 'c', 'ci', 'comment_italic', 'cb', 'comment_box'].includes(k)) out.push('> ' + val);
      else if (k === 'soc' || k === 'start_of_chorus') out.push('## ' + (val || 'Coro'));
      else if (k === 'sov' || k === 'start_of_verse') out.push('## ' + (val || 'Estrofa'));
      else if (k === 'sob' || k === 'start_of_bridge') out.push('## ' + (val || 'Puente'));
      continue;
    }
    if (/\[[^\]]+\]/.test(line) && !parseVoiceMarker(line) && !STRUM_MARKER_RE.test(line)) {
      const [c, l] = splitChordProLine(line);
      out.push(c);
      if (l.trim()) out.push(l);
    } else {
      out.push(line);
    }
  }
  return { title, text: out.join('\n') };
}

// ============ RUTAS Y NOMBRES ============
const isAbsoluteUrl = s => /^[a-z][a-z0-9+.-]*:/i.test(s);
const encodePath = p => p.split('/').map(encodeURIComponent).join('/');
const decodePath = p => isAbsoluteUrl(p) ? p : p.split('/').map(seg => { try { return decodeURIComponent(seg); } catch (_) { return seg; } }).join('/');
const fileBase = (name, keepExt = false) => {
  const b = decodePath(String(name)).split(/[\\/]/).pop() || '';
  return keepExt ? b : b.replace(/\.[^.]+$/, '');
};
const safeFileName = s => s.replace(/[\\/:*?"<>|]+/g, '').trim() || 'cancion';
const slugify = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cancion';

function getAttr(attrs, name) {
  const m = attrs.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  if (!m) return '';
  return (m[1] ?? m[2] ?? m[3] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function unquote(v) {
  if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch (_) { return v.slice(1, -1); } }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

const audioExportSrc = a => a.kind === 'url' ? a.src : encodePath(a.src);

// ============ MARKDOWN ============
// audioList: [{ name, src (ya codificada, relativa al .md), voice, extractor, speed, origin }]
function buildMarkdown(doc, audioList = doc.audios.map(a => ({ name: a.name, src: audioExportSrc(a), voice: a.voice, extractor: a.extractor, speed: a.speed, origin: a.origin }))) {
  const title = doc.title.trim() || 'Sin título';
  const text = doc.text.replace(/\s+$/, '');
  const key = detectKey(text);
  const out = ['---', `titulo: ${JSON.stringify(title)}`];
  if (key) out.push(`tono: ${JSON.stringify(keyLabel(key, true))}`);
  if (doc.scrollSpeed) out.push(`desplazamiento: ${doc.scrollSpeed}`);
  if (doc.tags?.length) out.push(`etiquetas: ${tagsToMeta(doc.tags)}`);
  if (doc.instruments?.length) out.push(`instrumentos: ${instrumentsToMeta(doc.instruments)}`);
  const capos = caposToMeta(doc.capos);
  if (capos) out.push(`cejilla: ${capos}`);
  for (const s of doc.instruments || []) {
    const inst = findInstrument(s.id);
    if (inst.propio) out.push(`instrumento-propio: ${serializeCustomInstrument(inst.def)}`);
  }
  if (doc.view && doc.view !== 'letra') out.push(`vista: ${doc.view}`);
  out.push(
    `exportado: ${new Date().toISOString().slice(0, 10)}`,
    `generador: ${JSON.stringify(`${APP_INFO.nombre} ${APP_INFO.version}`)}`,
    '---', '', `# ${title}`, ''
  );
  if (key) out.push(`**Tono:** ${keyLabel(key, true)}`, '');
  const longestTicks = Math.max(2, ...(text.match(/`+/g) || []).map(s => s.length));
  const fence = '`'.repeat(Math.max(3, longestTicks + 1));
  out.push(fence + 'cancion', text, fence);
  if (doc.sheets?.length) {
    out.push('');
    for (const h of doc.sheets) {
      const src = h.kind === 'url' ? h.src : encodePath(h.src);
      const tono = h.tono != null ? ` "en ${spell(h.tono, keyPrefersFlats(h.tono, false), true)}"` : '';
      out.push(`${h.formato === 'imagen' ? '!' : ''}[${sheetLabel(h.tipo)}: ${h.name.replace(/[[\]]/g, '')}](${src}${tono})`, '');
    }
  }
  if (audioList.length) {
    out.push('');
    for (const a of audioList) {
      const voz = a.voice && a.voice !== 'todas' ? ` data-voz="${escapeHtml(a.voice)}"` : '';
      const extraer = a.extractor ? ' data-extraer="yt-dlp"' : '';
      const velocidad = a.speed && a.speed !== 1 ? ` data-velocidad="${a.speed}"` : '';
      const origen = a.origin && !a.extractor ? ` data-origen="${escapeHtml(a.origin)}"` : '';
      out.push(`<audio controls src="${escapeHtml(a.src)}" title="${escapeHtml(a.name)}"${voz}${extraer}${velocidad}${origen}></audio>`, '');
    }
  }
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

function parseMarkdown(md, filename = '') {
  md = md.replace(/\r\n?/g, '\n');
  const meta = {};
  const fm = md.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (fm) {
    for (const l of fm[1].split('\n')) {
      const m = l.match(/^([\wáéíóúñ-]+)\s*:\s*(.*)$/i);
      if (!m) continue;
      const k = m[1].toLowerCase(), v = unquote(m[2].trim());
      if (k === 'instrumento-propio') (meta[k] ||= []).push(v);
      else meta[k] = v;
    }
    md = md.slice(fm[0].length);
  }
  for (const line of meta['instrumento-propio'] || []) {
    const def = parseCustomInstrument(line);
    if (def) registerCustomInstrument(def);
  }

  // Partituras y tablaturas: ![Partitura: Coro](coro.png "en Sol") o [Tablatura: Guitarra](x.gp)
  const sheets = [];
  md = md.replace(/!?\[(Partitura|Tablatura)\s*:\s*([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/gi, (all, tipo, name, src, title) => {
    const t = title?.match(/^en\s+(\S+)/i);
    const c = t && parseChord(t[1]);
    sheets.push({ tipo: tipo.toLowerCase(), name: name.trim(), src: isAbsoluteUrl(src) ? src : decodePath(src), tono: c ? noteIndex(c.root, c.acc) : null });
    return '';
  });

  const found = [];
  const addFound = (src, name, voice, extractor, speed, origin) => {
    if (!src) return;
    found.push({ src: decodePath(src), name: name || fileBase(src), voice: voice || 'todas', kind: isAbsoluteUrl(src) ? 'url' : 'local', extractor, speed: +speed || undefined, origin: origin || undefined });
  };
  md = md.replace(/<(?:audio|video)\b([^>]*)>([\s\S]*?)<\/(?:audio|video)>|<(?:audio|video)\b([^>]*?)\/?>/gi, (all, attrs, inner, attrs2) => {
    const at = attrs ?? attrs2 ?? '';
    const src = getAttr(at, 'src') || getAttr((inner || '').match(/<source\b([^>]*)>/i)?.[1] || '', 'src');
    addFound(src, getAttr(at, 'title'), getAttr(at, 'data-voz'), getAttr(at, 'data-extraer') ? true : undefined, getAttr(at, 'data-velocidad'), getAttr(at, 'data-origen'));
    return '';
  });
  md = md.replace(/!?\[([^\]]*)\]\(([^)\s]+\.(?:mp3|ogg|oga|opus|wav|m4a|aac|flac|weba|mp4|m4v|webm|mov|mkv|ogv))\)/gi, (all, label, src) => {
    addFound(src, label);
    return '';
  });

  let title = meta.titulo || meta.title || '';
  let body;
  const fence = md.match(/(?:^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1[ \t]*(?=\n|$)/);
  if (fence) {
    body = fence[2];
    if (!title) title = md.match(/^#\s+(.+)$/m)?.[1].trim() || '';
  } else {
    let rest = md.replace(/^\s+/, '');
    const h = rest.match(/^#\s+(.+)\n?/);
    if (h) { title ||= h[1].trim(); rest = rest.slice(h[0].length); }
    rest = rest
      .replace(/^\*\*Tono:\*\*.*\n?/m, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/__(.+?)__/g, '**$1**')
      .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1')
      .replace(/^\n+|\s+$/g, '');
    if (looksLikeChordPro(rest)) {
      const cp = chordProToText(rest);
      rest = cp.text;
      title ||= cp.title;
    }
    body = rest;
  }
  return {
    title: title || fileBase(filename), text: body, audios: found, scrollSpeed: +meta.desplazamiento || null,
    sheets, instruments: metaToInstruments(meta.instrumentos), capos: metaToCapos(meta.cejilla),
    view: ['partitura', 'tablatura'].includes(meta.vista) ? meta.vista : null,
    tags: metaToTags(meta.etiquetas || meta.tags)
  };
}

function parseDocument(raw, filename) {
  raw = raw.replace(/\r\n?/g, '\n');
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'md' || ext === 'markdown') return parseMarkdown(raw, filename);
  if (looksLikeChordPro(raw)) {
    const cp = chordProToText(raw);
    return { title: cp.title || fileBase(filename), text: cp.text, audios: [] };
  }
  return { title: fileBase(filename), text: raw, audios: [] };
}
