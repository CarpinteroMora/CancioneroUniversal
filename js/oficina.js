'use strict';
// Exporta a PowerPoint (.pptx) para proyectar a la asamblea, y a Word (.docx) u OpenDocument (.odt).
// Se arman a mano (XML dentro de un ZIP, ver zip.js): sin librerías, también funciona en file://.

const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ============ LÁMINAS: SOLO LA LETRA, POR ESTROFAS ============
const SLIDE_MAX_LINES = 6;
const CHORUS_RE = /\b(coro|estribillo|chorus)\b/i;
// Una línea de letra que en realidad es el nombre de una sección ("Coro:", "Estrofa 2")
const SECTION_WORD_RE = /^\s*(coro|estribillo|estrofa|verso|puente|pre-?coro|final|intro|interludio)(\s*\d+)?\s*:?\s*$/i;

// Líneas de acordes que el editor no reconoce: en negrita (**MI  FA#m**), con menores como "mi-"
// o unidos con guiones (DO#m-SI, MI-LA-SI7). Para no confundir una letra como "La la la", sin
// sufijos ni guiones hace falta que haya espacios dobles.
const LOOSE_CHORD_RE = /^\(?(do|re|mi|fa|sol|la|si|[a-g])(#|b|♯|♭)?((m|-|\+|°|º|maj|min|dim|aug|sus|add|M|\d|\/|#|b)*)(\/(do|re|mi|fa|sol|la|si|[a-g])(#|b)?)?\)?[.,]?$/i;
// 0 = no es acorde, 1 = acorde sin sufijo (podría ser una palabra), 2 = seguro que es acorde
function looseChord(tok) {
  const m = tok.match(LOOSE_CHORD_RE);
  if (m) return m[3] ? 2 : 1;
  const parts = tok.split(/-+/).filter(Boolean);
  return parts.length > 1 && parts.every(p => LOOSE_CHORD_RE.test(p)) ? 2 : 0;
}
function isChordRow(line) {
  const plain = stripInlineMd(line);
  if (isChordLine(plain)) return true;
  const toks = plain.trim().split(/\s+/);
  if (!toks[0] || isSpecialLine(plain)) return false;
  const kinds = toks.map(looseChord);
  return kinds.every(Boolean) && (/\S {2,}\S/.test(plain.trim()) || kinds.includes(2));
}

function songStanzas(text) {
  const out = [];
  let stanza = null, heading = null, chorus = null;
  const flush = () => {
    if (stanza?.lines.length) {
      out.push(stanza);
      if (stanza.chorus && !chorus) chorus = stanza;
    }
    stanza = null;
  };
  // Un "Coro" sin letra debajo indica que ahí se canta el coro
  const setHeading = h => {
    flush();
    if (heading != null && CHORUS_RE.test(heading) && chorus) out.push({ ...chorus, repeat: true });
    heading = h;
  };
  for (const raw of text.split('\n')) {
    if (parseVoiceMarker(raw) || STRUM_MARKER_RE.test(raw) || COMMENT_RE.test(raw)) continue;
    const h = raw.match(HEADING_RE);
    if (h || SECTION_WORD_RE.test(raw)) { setHeading(stripInlineMd(h ? h[2] : raw)); continue; }
    if (!raw.trim()) { flush(); continue; }
    if (isChordRow(raw)) continue;
    const line = stripInlineMd(raw).trim().replace(/\s+/g, ' ');
    if (!line) continue;
    if (!stanza) {
      stanza = { lines: [], chorus: heading != null && CHORUS_RE.test(heading) };
      heading = null;
    }
    stanza.lines.push(line);
  }
  setHeading(null);
  return out;
}

const hasChorus = d => songStanzas(d.text).some(s => s.chorus);

// Estrofas → láminas: el coro opcionalmente después de cada estrofa, y las largas en partes parejas
function songSlides(d, repeatChorus) {
  let stanzas = songStanzas(d.text);
  if (repeatChorus) {
    const chorus = stanzas.find(s => s.chorus);
    if (chorus) {
      const out = [];
      stanzas.forEach((s, i) => {
        out.push(s);
        if (!s.chorus && !stanzas[i + 1]?.chorus) out.push(chorus);
      });
      stanzas = out;
    }
  }
  const slides = [];
  // Las líneas largas ocupan dos renglones en pantalla: también cuentan para partir la estrofa
  const boxW = SLIDE_W * (1 - 2 * SLIDE_MARGIN) / EMU_PT;
  const rows = lines => lines.reduce((n, l) => n + Math.max(1, Math.ceil(boldEm(l) * SLIDE_PT.min / boxW - 0.001)), 0);
  for (const s of stanzas) {
    const parts = Math.min(s.lines.length, Math.max(Math.ceil(s.lines.length / SLIDE_MAX_LINES), Math.ceil(rows(s.lines) / SLIDE_MAX_LINES)));
    let from = 0;
    for (let p = 0; p < parts; p++) {
      const n = Math.round((s.lines.length - from) / (parts - p));
      slides.push(s.lines.slice(from, from + n));
      from += n;
    }
  }
  return slides;
}

// ============ POWERPOINT ============
const SLIDE_W = 12192000, SLIDE_H = 6858000, EMU_PT = 12700;
const SLIDE_MARGIN = 0.035; // de cada lado, en fracción del ancho
const SLIDE_THEMES = {
  blanco: { label: 'Fondo blanco, letra negra (lo mejor con mucha luz)', bg: 'FFFFFF', fg: '000000' },
  negro: { label: 'Fondo negro, letra blanca', bg: '000000', fg: 'FFFFFF' },
  azul: { label: 'Fondo azul oscuro, letra amarilla', bg: '0B1F4D', fg: 'FFD600' }
};
const SLIDE_PT = { min: 40, max: 66, floor: 28, title: 72 };
const LINE_HEIGHT = 1.2;

// Ancho de un texto en Arial negrita, en "em" (1 = el tamaño de la letra). Se usan las medidas
// fijas de la letra (milésimas de em, de " " a "~") y no las del navegador, que puede no tener Arial.
const ARIAL_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584];
const ARIAL_BOLD_EXTRA = { '¡': 333, '¿': 611, '«': 556, '»': 556, '“': 500, '”': 500, '‘': 278, '’': 278, '…': 1000, '—': 1000, '–': 556 };
function boldEm(text) {
  let w = 0;
  for (const ch of text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')) {
    const c = ch.codePointAt(0);
    w += c >= 32 && c <= 126 ? ARIAL_BOLD[c - 32] : ARIAL_BOLD_EXTRA[ch] || 611;
  }
  return w / 1000 * 1.03;
}

// El tamaño más grande que cabe: sin cortar líneas si se puede, y nunca más chico de lo legible
function slideFontPt(lines, boxW, boxH, maxPt = SLIDE_PT.max) {
  const widths = lines.map(boldEm);
  const rows = pt => widths.reduce((s, w) => s + Math.max(1, Math.ceil(w * pt / boxW - 0.001)), 0);
  const fits = pt => rows(pt) * pt * LINE_HEIGHT <= boxH;
  for (let pt = maxPt; pt >= SLIDE_PT.min; pt--) {
    if (rows(pt) === lines.length && fits(pt)) return pt;
  }
  for (let pt = SLIDE_PT.min; pt >= SLIDE_PT.floor; pt--) if (fits(pt)) return pt;
  return SLIDE_PT.floor;
}

const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const rels = list => `${XML_HEAD}<Relationships xmlns="${PKG_REL}">${list.map(([id, type, target, ext]) =>
  `<Relationship Id="${id}" Type="${type}" Target="${xmlEsc(target)}"${ext ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

function docProps(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return {
    core: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>${xmlEsc(APP_INFO.nombre)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    app: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${xmlEsc(APP_INFO.nombre)}</Application></Properties>`
  };
}

const PPTX_THEME = `${XML_HEAD}<a:theme ${NS_A} name="Cancionero"><a:themeElements>
<a:clrScheme name="Cancionero"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
<a:accent1><a:srgbClr val="1A73E8"/></a:accent1><a:accent2><a:srgbClr val="D93025"/></a:accent2><a:accent3><a:srgbClr val="F9AB00"/></a:accent3><a:accent4><a:srgbClr val="1E8E3E"/></a:accent4><a:accent5><a:srgbClr val="9334E6"/></a:accent5><a:accent6><a:srgbClr val="E8710A"/></a:accent6>
<a:hlink><a:srgbClr val="1A73E8"/></a:hlink><a:folHlink><a:srgbClr val="9334E6"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Cancionero"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Cancionero"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

function pptxTextBox(id, name, lines, pt, color, y, h) {
  const x = Math.round(SLIDE_W * SLIDE_MARGIN), w = SLIDE_W - 2 * x;
  const run = t => `<a:r><a:rPr lang="es-ES" sz="${pt * 100}" b="1" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(t)}</a:t></a:r>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEsc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>${lines.map(l =>
    `<a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPct val="${LINE_HEIGHT * 100000}"/></a:lnSpc></a:pPr>${run(l)}</a:p>`).join('')}</p:txBody></p:sp>`;
}

function pptxSlide(theme, shapes) {
  return `${XML_HEAD}<p:sld ${NS_A} ${NS_R} ${NS_P}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${theme.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function buildPptx(list, { titulo = '', theme = 'blanco', repeatChorus = false } = {}) {
  const t = SLIDE_THEMES[theme] || SLIDE_THEMES.blanco;
  const marginY = Math.round(SLIDE_H * 0.06);
  const boxW = (SLIDE_W * (1 - 2 * SLIDE_MARGIN)) / EMU_PT, boxH = (SLIDE_H - 2 * marginY) / EMU_PT;
  const slides = [];
  if (titulo && list.length > 1) {
    slides.push(pptxSlide(t, pptxTextBox(2, 'Título', [titulo], slideFontPt([titulo], boxW, boxH, SLIDE_PT.title), t.fg, marginY, SLIDE_H - 2 * marginY)));
  }
  for (const d of list) {
    const title = d.title.trim() || 'Sin título';
    slides.push(pptxSlide(t, pptxTextBox(2, 'Título', [title], slideFontPt([title], boxW, boxH * 0.6, SLIDE_PT.title), t.fg, marginY, SLIDE_H - 2 * marginY)));
    for (const lines of songSlides(d, repeatChorus)) {
      slides.push(pptxSlide(t, pptxTextBox(2, 'Letra', lines, slideFontPt(lines, boxW, boxH), t.fg, marginY, SLIDE_H - 2 * marginY)));
    }
  }
  const props = docProps(titulo || list[0].title || 'Canciones');
  const files = [
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>
<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: rels([['rId1', REL + '/officeDocument', 'ppt/presentation.xml'],
      ['rId2', PKG_REL + '/metadata/core-properties', 'docProps/core.xml'], ['rId3', REL + '/extended-properties', 'docProps/app.xml']]) },
    { name: 'docProps/core.xml', data: props.core },
    { name: 'docProps/app.xml', data: props.app },
    { name: 'ppt/presentation.xml', data: `${XML_HEAD}<p:presentation ${NS_A} ${NS_R} ${NS_P} saveSubsetFonts="1">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels([
      ['rId1', REL + '/slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', REL + '/theme', 'theme/theme1.xml'],
      ['rId3', REL + '/presProps', 'presProps.xml'], ['rId4', REL + '/viewProps', 'viewProps.xml'], ['rId5', REL + '/tableStyles', 'tableStyles.xml'],
      ...slides.map((_, i) => [`rId${10 + i}`, REL + '/slide', `slides/slide${i + 1}.xml`])]) },
    { name: 'ppt/presProps.xml', data: `${XML_HEAD}<p:presentationPr ${NS_A} ${NS_R} ${NS_P}/>` },
    { name: 'ppt/viewProps.xml', data: `${XML_HEAD}<p:viewPr ${NS_A} ${NS_R} ${NS_P}><p:normalViewPr/><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>` },
    { name: 'ppt/tableStyles.xml', data: `${XML_HEAD}<a:tblStyleLst ${NS_A} def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` },
    { name: 'ppt/theme/theme1.xml', data: PPTX_THEME },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `${XML_HEAD}<p:sldMaster ${NS_A} ${NS_R} ${NS_P}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${t.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', REL + '/slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', REL + '/theme', '../theme/theme1.xml']]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `${XML_HEAD}<p:sldLayout ${NS_A} ${NS_R} ${NS_P} type="blank" preserve="1"><p:cSld name="En blanco"><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', REL + '/slideMaster', '../slideMasters/slideMaster1.xml']]) },
    ...slides.flatMap((s, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: s },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: rels([['rId1', REL + '/slideLayout', '../slideLayouts/slideLayout1.xml']]) }
    ])
  ];
  return { blob: makeZip(files, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), count: slides.length };
}

// ============ DOCUMENTOS: LETRA Y ACORDES, CON ENLACES A LOS AUDIOS ============
// Audios con dirección web (página de YouTube, archivo en internet…); los del equipo no tienen enlace
function audioLinks(d) {
  return d.audios.map(a => {
    const url = audioPage(a) || (/^https?:\/\//i.test(a.src || '') ? a.src : null);
    return url && { name: a.name || 'Audio', url };
  }).filter(Boolean);
}

// Cada línea de la canción con su tipo, ya sin marcas de formato
function docLines(d) {
  const latin = isLatin();
  return d.text.split('\n').map(line => {
    let m;
    if (!line.trim()) return { kind: 'blank', text: '' };
    if ((m = line.match(COMMENT_RE))) return { kind: 'comment', text: stripInlineMd(m[1]) };
    if ((m = line.match(HEADING_RE))) return { kind: 'heading', text: stripInlineMd(m[2]) };
    const vm = parseVoiceMarker(line);
    if (vm) return vm.key === 'unica' ? null : { kind: 'voice', text: vm.label };
    if ((m = line.match(STRUM_MARKER_RE))) return { kind: 'comment', text: `Rasgueo: ${m[1]}` };
    if (isChordLine(line)) return { kind: 'chord', text: lineText(layoutChordLine(line, tok => convertTokenNotation(tok, latin))) };
    if (isChordRow(line)) return { kind: 'chord', text: stripInlineMd(line) };
    return { kind: 'lyric', text: stripInlineMd(line) };
  }).filter(Boolean);
}

function docSongs(list) {
  return list.map(d => {
    const key = detectKey(d.text);
    return { title: d.title.trim() || 'Sin título', key: key ? keyLabel(key) : '', links: audioLinks(d), lines: docLines(d) };
  });
}

// ---- Word (.docx) ----
function buildDocx(list, { titulo = '' } = {}) {
  const songs = docSongs(list);
  const book = !!titulo && list.length > 1;
  const links = [];
  const linkId = url => { links.push(url); return `rId${100 + links.length - 1}`; };
  const r = (text, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
  const link = (text, url, rpr = '') => `<w:hyperlink r:id="${linkId(url)}" w:history="1">${r(text, `<w:rStyle w:val="Hyperlink"/>${rpr}`)}</w:hyperlink>`;
  const p = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
  const MONO = '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>';
  const TIGHT = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';
  let body = '';
  if (book) {
    body += p(r(titulo), '<w:pStyle w:val="Title"/><w:jc w:val="center"/>');
    body += p(r(`${songs.length} canciones`, '<w:color w:val="5F6368"/>'), '<w:jc w:val="center"/>');
    body += songs.map((s, i) => p(r(`${i + 1}. ${s.title}`) + (s.key ? r(`  ${s.key}`, '<w:color w:val="80868B"/><w:sz w:val="20"/>') : ''))).join('');
  }
  songs.forEach((s, i) => {
    const brk = book || i > 0 ? '<w:pageBreakBefore/>' : '';
    body += p(s.links.length ? link(s.title, s.links[0].url) : r(s.title), `<w:pStyle w:val="Heading1"/>${brk}`);
    if (s.key) body += p(r(`Tono: ${s.key}`, '<w:color w:val="5F6368"/>'));
    if (s.links.length) {
      body += p(r('Audios: ', '<w:b/><w:color w:val="5F6368"/>') + s.links.map((l, k) =>
        (k ? r(' · ', '<w:color w:val="5F6368"/>') : '') + link('▶ ' + l.name, l.url)).join(''));
    }
    body += p('', TIGHT);
    for (const l of s.lines) {
      if (l.kind === 'blank') body += p('', TIGHT);
      else if (l.kind === 'chord') body += p(r(l.text, `${MONO}<w:b/><w:color w:val="C5221F"/>`), TIGHT);
      else if (l.kind === 'lyric') body += p(r(l.text, MONO), TIGHT);
      else if (l.kind === 'comment') body += p(r(l.text, '<w:i/><w:color w:val="5F6368"/>'), TIGHT);
      else if (l.kind === 'voice') body += p(r(l.text, '<w:b/><w:color w:val="1967D2"/><w:sz w:val="20"/>'), '<w:spacing w:before="120" w:after="0"/>');
      else body += p(r(l.text, '<w:b/><w:color w:val="1A73E8"/>'), '<w:keepNext/><w:spacing w:before="160" w:after="40"/>');
    }
  });
  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `${XML_HEAD}<w:document ${W_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `${XML_HEAD}<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="2400" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="60"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1155CC"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;
  const props = docProps(titulo || songs[0].title);
  return makeZip([
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: rels([['rId1', REL + '/officeDocument', 'word/document.xml'],
      ['rId2', PKG_REL + '/metadata/core-properties', 'docProps/core.xml'], ['rId3', REL + '/extended-properties', 'docProps/app.xml']]) },
    { name: 'docProps/core.xml', data: props.core },
    { name: 'docProps/app.xml', data: props.app },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: rels([['rId1', REL + '/styles', 'styles.xml'],
      ...links.map((url, i) => [`rId${100 + i}`, REL + '/hyperlink', url, true])]) }
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// ---- OpenDocument (.odt) ----
// En ODF los espacios seguidos se juntan: cada tramo de espacios va como <text:s text:c="n"/>
const odtText = s => xmlEsc(s).replace(/ +/g, m => `<text:s text:c="${m.length}"/>`).replace(/\t/g, '<text:tab/>');

function buildOdt(list, { titulo = '' } = {}) {
  const songs = docSongs(list);
  const book = !!titulo && list.length > 1;
  const a = (text, url) => `<text:a xlink:type="simple" xlink:href="${xmlEsc(url)}">${odtText(text)}</text:a>`;
  const span = (style, text) => `<text:span text:style-name="${style}">${odtText(text)}</text:span>`;
  const p = (style, inner) => `<text:p text:style-name="${style}">${inner}</text:p>`;
  let body = '';
  if (book) {
    body += p('Portada', odtText(titulo));
    body += p('Centro', span('Gris', `${songs.length} canciones`));
    body += songs.map((s, i) => p('Standard', odtText(`${i + 1}. ${s.title}`) + (s.key ? span('Gris', `  ${s.key}`) : ''))).join('');
  }
  songs.forEach((s, i) => {
    const style = book || i > 0 ? 'TituloSalto' : 'Titulo';
    body += `<text:h text:style-name="${style}" text:outline-level="1">${s.links.length ? a(s.title, s.links[0].url) : odtText(s.title)}</text:h>`;
    if (s.key) body += p('Standard', span('Gris', `Tono: ${s.key}`));
    if (s.links.length) body += p('Standard', span('GrisNegrita', 'Audios: ') + s.links.map((l, k) => (k ? span('Gris', ' · ') : '') + a('▶ ' + l.name, l.url)).join(''));
    body += p('Mono', '');
    for (const l of s.lines) {
      if (l.kind === 'blank') body += p('Mono', '');
      else if (l.kind === 'chord') body += p('Acordes', odtText(l.text));
      else if (l.kind === 'lyric') body += p('Mono', odtText(l.text));
      else if (l.kind === 'comment') body += p('Comentario', odtText(l.text));
      else if (l.kind === 'voice') body += p('Voz', odtText(l.text));
      else body += p('Seccion', odtText(l.text));
    }
  });
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
  const fonts = '<office:font-face-decls><style:font-face style:name="Arial" svg:font-family="Arial" style:font-family-generic="swiss"/><style:font-face style:name="Courier New" svg:font-family="\'Courier New\'" style:font-family-generic="modern" style:font-pitch="fixed"/></office:font-face-decls>';
  const ps = (name, para, textProps, extra = '') => `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="Standard"${extra}><style:paragraph-properties ${para}/><style:text-properties ${textProps}/></style:style>`;
  const mono = 'style:font-name="Courier New" fo:font-size="11pt"';
  const tight = 'fo:margin-top="0cm" fo:margin-bottom="0cm"';
  const autoStyles = `<office:automatic-styles>
${ps('Titulo', 'fo:margin-top="0cm" fo:margin-bottom="0.1cm" fo:keep-with-next="always"', 'fo:font-size="18pt" fo:font-weight="bold"', ' style:default-outline-level="1"')}
${ps('TituloSalto', 'fo:margin-top="0cm" fo:margin-bottom="0.1cm" fo:keep-with-next="always" fo:break-before="page"', 'fo:font-size="18pt" fo:font-weight="bold"', ' style:default-outline-level="1"')}
${ps('Portada', 'fo:margin-top="4cm" fo:margin-bottom="0.4cm" fo:text-align="center"', 'fo:font-size="28pt" fo:font-weight="bold"')}
${ps('Centro', 'fo:text-align="center" fo:margin-bottom="0.6cm"', '')}
${ps('Mono', tight, mono)}
${ps('Acordes', tight, `${mono} fo:font-weight="bold" fo:color="#c5221f"`)}
${ps('Comentario', tight, 'fo:font-style="italic" fo:color="#5f6368"')}
${ps('Voz', 'fo:margin-top="0.2cm" fo:margin-bottom="0cm"', 'fo:font-weight="bold" fo:color="#1967d2" fo:font-size="10pt"')}
${ps('Seccion', 'fo:margin-top="0.28cm" fo:margin-bottom="0.07cm" fo:keep-with-next="always"', 'fo:font-weight="bold" fo:color="#1a73e8"')}
<style:style style:name="Gris" style:family="text"><style:text-properties fo:color="#5f6368"/></style:style>
<style:style style:name="GrisNegrita" style:family="text"><style:text-properties fo:color="#5f6368" fo:font-weight="bold"/></style:style>
</office:automatic-styles>`;
  const content = `${XML_HEAD}<office:document-content ${NS} office:version="1.2">${fonts}${autoStyles}<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const styles = `${XML_HEAD}<office:document-styles ${NS} office:version="1.2">${fonts}<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.14cm"/><style:text-properties style:font-name="Arial" fo:font-size="11pt" fo:language="es" fo:country="ES"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="#1155cc" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>
</office:styles><office:automatic-styles><style:page-layout style:name="Pagina"><style:page-layout-properties fo:page-width="21.59cm" fo:page-height="27.94cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="Pagina"/></office:master-styles></office:document-styles>`;
  const meta = `${XML_HEAD}<office:document-meta ${NS} office:version="1.2"><office:meta><dc:title>${xmlEsc(titulo || songs[0].title)}</dc:title><meta:generator>${xmlEsc(APP_INFO.nombre)} ${xmlEsc(APP_INFO.version)}</meta:generator></office:meta></office:document-meta>`;
  const MIME = 'application/vnd.oasis.opendocument.text';
  return makeZip([
    { name: 'mimetype', data: MIME },
    { name: 'META-INF/manifest.xml', data: `${XML_HEAD}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>` },
    { name: 'content.xml', data: content },
    { name: 'styles.xml', data: styles },
    { name: 'meta.xml', data: meta }
  ], MIME);
}

// ============ EXPORTAR ============
const DOC_FORMATS = {
  docx: { build: buildDocx, ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', desc: 'Documento de Word', label: 'Word' },
  odt: { build: buildOdt, ext: '.odt', mime: 'application/vnd.oasis.opendocument.text', desc: 'Documento OpenDocument', label: 'OpenDocument' }
};
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const fileSize = blob => blob.size >= 1024 * 1024
  ? `${(blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(blob.size / 1024))} KB`;

async function saveDoc(list, name, titulo, fmt) {
  const f = DOC_FORMATS[fmt];
  const save = await pickSaveTarget(safeFileName(name) + f.ext, f.mime, f.ext, f.desc);
  if (!save) return;
  const blob = f.build(list, { titulo });
  const saved = await save(blob);
  if (!saved) return;
  const linked = list.filter(d => audioLinks(d).length).length;
  toast(`Documento guardado: ${saved} (${fileSize(blob)}).${linked ? ` ${linked === 1 ? 'El título lleva' : `Los títulos de ${linked} canciones llevan`} el enlace a su audio.` : ''}`, 6000);
}

function exportSongDoc(fmt) {
  syncFromEditor();
  const d = cur();
  if (isBlank(d)) { toast('La canción está vacía'); return; }
  return saveDoc([d], d.title.trim() || 'Sin título', '', fmt);
}

async function exportBookDoc(fmt) {
  syncFromEditor();
  const songs = docs.filter(d => !isBlank(d));
  if (!songs.length) { toast('No hay canciones abiertas para exportar'); return; }
  const f = DOC_FORMATS[fmt];
  const res = await showModal({
    title: `Exportar cancionero como documento ${f.label} (${f.ext})`,
    body: `${bookPickerHtml(songs)}
      <p class="hint">Lleva una portada con el índice y cada canción en una página nueva, con letra y acordes.
        El título de cada canción es un enlace a su audio (YouTube u otra página).</p>`,
    onOpen: bookPickerOpen,
    buttons: [{ label: 'Cancelar' }, { label: 'Exportar', primary: true, onClick: dlg => bookPickerRead(dlg, songs) }]
  });
  if (res) return saveDoc(res.chosen, res.titulo, res.titulo, fmt);
}

function slideThemeHtml() {
  const saved = localStorage.getItem('canciotras-laminas') || 'blanco';
  return `<div class="field"><span>Colores de las láminas</span><div class="slide-themes">${Object.entries(SLIDE_THEMES).map(([k, t]) =>
    `<label><input type="radio" name="xTheme" value="${k}"${k === saved ? ' checked' : ''}>
      <span class="slide-swatch" style="background:#${t.bg};color:#${t.fg}">Aa</span> ${escapeHtml(t.label)}</label>`).join('')}</div></div>`;
}

function slideOptionsHtml(list) {
  return `${slideThemeHtml()}
    ${list.some(hasChorus) ? '<label class="export-embed"><input type="checkbox" id="xChorus"> Repetir el coro después de cada estrofa</label>' : ''}
    <p class="hint">Solo va la letra (sin acordes ni comentarios), una estrofa por lámina, con letra grande y gruesa
      para que se lea bien en el proyector aunque haya mucha luz. Se abre con PowerPoint, LibreOffice o Google Slides.</p>`;
}

function readSlideOptions(dlg) {
  const theme = dlg.querySelector('input[name="xTheme"]:checked')?.value || 'blanco';
  localStorage.setItem('canciotras-laminas', theme);
  return { theme, repeatChorus: !!dlg.querySelector('#xChorus')?.checked };
}

async function savePptx(list, name, titulo, opts) {
  const save = await pickSaveTarget(safeFileName(name) + '.pptx', PPTX_MIME, '.pptx', 'Presentación');
  if (!save) return;
  const { blob, count } = buildPptx(list, { titulo, ...opts });
  const saved = await save(blob);
  if (saved) toast(`Presentación guardada: ${saved} (${count} láminas, ${fileSize(blob)}).`, 6000);
}

async function exportSongPptx() {
  syncFromEditor();
  const d = cur();
  if (isBlank(d)) { toast('La canción está vacía'); return; }
  if (!songStanzas(d.text).length) { toast('Esta canción no tiene letra para proyectar'); return; }
  const res = await showModal({
    title: 'Exportar para proyectar (.pptx)',
    body: slideOptionsHtml([d]),
    buttons: [{ label: 'Cancelar' }, { label: 'Exportar', primary: true, onClick: readSlideOptions }]
  });
  if (res) return savePptx([d], d.title.trim() || 'Sin título', '', res);
}

async function exportBookPptx() {
  syncFromEditor();
  const songs = docs.filter(d => !isBlank(d) && songStanzas(d.text).length);
  if (!songs.length) { toast('No hay canciones con letra para proyectar'); return; }
  const res = await showModal({
    title: 'Exportar cancionero para proyectar (.pptx)',
    body: `${bookPickerHtml(songs)}${slideOptionsHtml(songs)}`,
    onOpen: bookPickerOpen,
    buttons: [{
      label: 'Cancelar' }, {
      label: 'Exportar', primary: true,
      onClick: dlg => { const r = bookPickerRead(dlg, songs); return r && { ...r, ...readSlideOptions(dlg) }; }
    }]
  });
  if (res) return savePptx(res.chosen, res.titulo, res.titulo, res);
}
