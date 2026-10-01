'use strict';
// Etiquetas (tags) de cada canción, para clasificarlas y buscarlas después.
// Se guardan en la cabecera del .md:  etiquetas: Católico, Entrada, Tiempo ordinario
// La primera etiqueta que se reconoce indica la tradición (católica, evangélica, folklore o
// música latinoamericana) y el diálogo ofrece las alternativas propias de esa tradición.

const TAG_FAMILIES = {
  catolico: {
    label: 'Católico', icon: '✝️',
    aliases: ['catolico', 'catolica', 'misa', 'liturgia', 'liturgico', 'liturgica', 'parroquia', 'eucaristia',
      'kyrie', 'perdon', 'piedad', 'agnus', 'sanctus', 'ofertorio', 'comunion', 'virgen', 'maria'],
    groups: [
      { name: 'Momentos de la misa', tags: ['Entrada', 'Acto penitencial', 'Señor ten piedad (Kyrie)', 'Gloria', 'Salmo responsorial',
        'Aclamación al Evangelio', 'Aleluya', 'Credo', 'Oración de los fieles', 'Ofertorio', 'Presentación de los dones',
        'Santo', 'Aclamación memorial', 'Amén', 'Padre Nuestro', 'Paz', 'Cordero de Dios', 'Comunión',
        'Acción de gracias', 'Salida', 'Envío', 'Canto a María'] },
      { name: 'Tiempos litúrgicos', tags: ['Adviento', 'Navidad', 'Epifanía', 'Tiempo ordinario', 'Cuaresma',
        'Miércoles de Ceniza', 'Semana Santa', 'Domingo de Ramos', 'Jueves Santo', 'Viernes Santo', 'Vigilia Pascual',
        'Pascua', 'Ascensión', 'Pentecostés'] },
      { name: 'Solemnidades y fiestas', tags: ['Santísima Trinidad', 'Corpus Christi', 'Sagrado Corazón', 'Cristo Rey',
        'Todos los Santos', 'Fieles difuntos', 'Inmaculada Concepción', 'Asunción', 'Virgen del Carmen',
        'Virgen de Guadalupe', 'San José', 'San Pedro y San Pablo', 'Presentación del Señor', 'Bautismo del Señor',
        'Transfiguración', 'Exaltación de la Cruz', 'Santos patronos'] },
      { name: 'Sacramentos y celebraciones', tags: ['Bautismo', 'Primera comunión', 'Confirmación', 'Matrimonio',
        'Reconciliación', 'Unción de los enfermos', 'Ordenación', 'Exequias', 'Adoración eucarística', 'Hora santa',
        'Liturgia de las horas', 'Laudes', 'Vísperas', 'Completas', 'Rosario', 'Vía Crucis', 'Procesión', 'Peregrinación'] },
      { name: 'Temas y estilo', tags: ['Alabanza', 'Adoración', 'Espíritu Santo', 'Mariano', 'Eucarístico', 'Misionero',
        'Vocacional', 'Juvenil', 'Infantil', 'Taizé', 'Gregoriano', 'Canto popular', 'Mes de María', 'Retiro',
        'Renovación carismática'] }
    ]
  },
  evangelico: {
    label: 'Evangélico', icon: '📖',
    aliases: ['evangelico', 'evangelica', 'cristiano', 'cristiana', 'culto', 'pentecostal', 'bautista', 'metodista',
      'adventista', 'presbiteriano', 'corito', 'coritos', 'himnario', 'worship', 'santa cena'],
    groups: [
      { name: 'Momento del culto', tags: ['Apertura', 'Bienvenida', 'Alabanza', 'Adoración', 'Oración',
        'Lectura de la Palabra', 'Predicación', 'Ofrenda', 'Diezmos', 'Santa Cena', 'Llamado', 'Consagración',
        'Bautismo', 'Presentación de niños', 'Despedida', 'Bendición final'] },
      { name: 'Tipo de canto', tags: ['Himno', 'Himnario', 'Corito', 'Coro', 'Adoración contemporánea', 'Gospel',
        'Espiritual negro', 'Salmo cantado', 'Canto congregacional', 'Especial (solista)'] },
      { name: 'Temas', tags: ['Gracia', 'Salvación', 'Cruz', 'Sangre de Cristo', 'Resurrección', 'Espíritu Santo', 'Fe',
        'Esperanza', 'Amor de Dios', 'Sanidad', 'Liberación', 'Guerra espiritual', 'Gratitud', 'Segunda venida', 'Cielo',
        'Avivamiento', 'Misiones', 'Familia'] },
      { name: 'Ocasiones', tags: ['Navidad', 'Semana Santa', 'Año nuevo', 'Aniversario de la iglesia', 'Día de la Madre',
        'Día del Padre', 'Matrimonio', 'Funeral', 'Escuela dominical', 'Jóvenes', 'Niños', 'Damas', 'Varones',
        'Campaña evangelística', 'Vigilia', 'Culto al aire libre'] }
    ]
  },
  folklore: {
    label: 'Folklore', icon: '🪕',
    aliases: ['folklore', 'folclore', 'folklorico', 'folclorico', 'folklorica', 'folclorica', 'folk', 'huaso',
      'campesina', 'criolla chilena'],
    groups: [
      { name: 'Ritmo o danza', tags: ['Cueca', 'Cueca campesina', 'Cueca brava', 'Cueca chora', 'Cueca nortina',
        'Cueca chilota', 'Tonada', 'Vals chileno', 'Refalosa', 'Sirilla', 'Parabién', 'Polca', 'Mazurca', 'Rin',
        'Trastrasera', 'Pericona', 'Chapecao', 'Costillar', 'Mazamorra', 'Huayno', 'Trote', 'Cachimbo', 'Taquirari',
        'Sau sau', 'Ula ula', 'Purrún', 'Ül (canto mapuche)'] },
      { name: 'Canto a lo poeta', tags: ['Canto a lo divino', 'Canto a lo humano', 'Décima', 'Paya', 'Contrapunto',
        'Verso por saludo', 'Verso por despedida', 'Velorio de angelito', 'Guitarrón chileno'] },
      { name: 'Zona', tags: ['Norte grande', 'Norte chico', 'Zona central', 'Zona sur', 'Chiloé', 'Patagonia', 'Rapa Nui',
        'Mapuche', 'Andino', 'Campesino'] },
      { name: 'Fiestas y ocasiones', tags: ['Fiestas Patrias', 'Dieciocho', 'Fiesta de La Tirana', 'Fiesta de Andacollo',
        'Cuasimodo', 'San Pedro', 'Trilla', 'Vendimia', 'Rodeo', 'Navidad campesina', 'Villancico', 'Candelaria',
        'Carnaval'] },
      { name: 'Instrumentos', tags: ['Guitarra', 'Guitarrón', 'Arpa', 'Acordeón', 'Pandero', 'Bombo', 'Charango', 'Quena',
        'Zampoña', 'Tiple', 'Rabel', 'Violín', 'Cultrún', 'Trutruka'] }
    ]
  },
  latino: {
    label: 'Música latinoamericana', icon: '🌎',
    aliases: ['latino', 'latina', 'latinoamericano', 'latinoamericana', 'latin', 'tropical', 'bailable', 'criollo'],
    groups: [
      { name: 'Género', tags: ['Bolero', 'Son cubano', 'Salsa', 'Cumbia', 'Cumbia chilena', 'Cumbia villera', 'Merengue',
        'Bachata', 'Tango', 'Milonga', 'Vals criollo', 'Chacarera', 'Zamba', 'Chamamé', 'Vidala', 'Carnavalito', 'Huayno',
        'Saya', 'Caporal', 'Morenada', 'Bambuco', 'Pasillo', 'Joropo', 'Marinera', 'Festejo', 'Landó', 'Tondero', 'Samba',
        'Bossa nova', 'Choro', 'Ranchera', 'Corrido', 'Huapango', 'Son jarocho', 'Bolero ranchero', 'Cha-cha-chá', 'Mambo',
        'Danzón', 'Guaracha', 'Guajira', 'Trova', 'Nueva trova', 'Nueva canción', 'Canto nuevo', 'Balada', 'Rock latino',
        'Reggae en español', 'Candombe', 'Murga', 'Plena', 'Bomba'] },
      { name: 'País o región', tags: ['Chile', 'Argentina', 'Perú', 'Bolivia', 'Ecuador', 'Colombia', 'Venezuela', 'México',
        'Cuba', 'Puerto Rico', 'República Dominicana', 'Brasil', 'Uruguay', 'Paraguay', 'Centroamérica', 'Caribe', 'Andes'] },
      { name: 'Época', tags: ['Años 50', 'Años 60', 'Años 70', 'Años 80', 'Años 90', '2000 en adelante', 'Tradicional'] },
      { name: 'Temática', tags: ['Amor', 'Desamor', 'Social', 'Protesta', 'Paisaje', 'Trabajo', 'Fiesta', 'Nostalgia',
        'Patria', 'Infantil', 'Humor'] }
    ]
  }
};

// Para cualquier tradición
const TAG_GENERAL_GROUPS = [
  { name: 'Carácter', tags: ['Alegre', 'Festivo', 'Solemne', 'Meditativo', 'Tranquilo', 'Lento', 'Rápido'] },
  { name: 'Quién canta', tags: ['Asamblea', 'Coro', 'Solista', 'Dúo', 'Niños', 'Instrumental'] },
  { name: 'Dificultad', tags: ['Fácil', 'Intermedia', 'Difícil'] }
];

const tagNorm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cleanTag = s => String(s).replace(/[,\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();

// Índice: etiqueta normalizada → { canónica, tradiciones }
const TAG_INDEX = new Map();
function indexTag(tag, fam) {
  const k = tagNorm(tag);
  const e = TAG_INDEX.get(k) || { tag, families: new Set() };
  if (fam) e.families.add(fam);
  TAG_INDEX.set(k, e);
}
for (const [id, f] of Object.entries(TAG_FAMILIES)) {
  indexTag(f.label, id);
  f.groups.forEach(g => g.tags.forEach(t => indexTag(t, id)));
}
TAG_GENERAL_GROUPS.forEach(g => g.tags.forEach(t => indexTag(t, null)));

const familyOfLabel = tag => Object.keys(TAG_FAMILIES).find(id => tagNorm(TAG_FAMILIES[id].label) === tagNorm(tag)) || null;
const canonicalTag = tag => TAG_INDEX.get(tagNorm(tag))?.tag || cleanTag(tag);

// Tradiciones a las que puede pertenecer una etiqueta (por el vocabulario o por palabras clave)
function tagFamilies(tag) {
  const k = tagNorm(tag);
  const found = new Set(TAG_INDEX.get(k)?.families || []);
  const padded = ` ${k} `;
  for (const [id, f] of Object.entries(TAG_FAMILIES)) {
    if (f.aliases.some(a => padded.includes(` ${a} `))) found.add(id);
  }
  return [...found];
}

// La tradición que mejor explica las etiquetas. Si hay empate: ambigua (se pregunta).
function deduceFamily(tags) {
  const votes = {};
  let first = null;
  for (const t of tags) {
    const fams = tagFamilies(t);
    if (!fams.length) continue;
    const weight = familyOfLabel(t) ? 3 : 1;
    if (weight === 1) first ||= { tag: t, fams };
    fams.forEach(f => { votes[f] = (votes[f] || 0) + weight; });
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { fam: null, options: [], first: null };
  const top = ranked.filter(([, v]) => v === ranked[0][1]).map(([f]) => f);
  if (!first) first = { tag: tags.find(t => familyOfLabel(t)), fams: top };
  return { fam: top.length === 1 ? top[0] : null, options: top, first };
}

// La etiqueta de la tradición va primero (Católico, Evangélico…)
function withFamilyTag(tags, fam) {
  const rest = tags.filter(t => !familyOfLabel(t));
  return fam ? [TAG_FAMILIES[fam].label, ...rest] : rest;
}

function uniqueTags(tags) {
  const seen = new Set();
  return tags.map(cleanTag).filter(t => {
    const k = tagNorm(t);
    return k && !seen.has(k) && seen.add(k);
  });
}

const tagsToMeta = tags => (tags || []).map(cleanTag).filter(Boolean).join(', ');
const metaToTags = s => uniqueTags(String(s || '').split(',').map(canonicalTag));

// Etiquetas usadas en las canciones abiertas (para autocompletar y buscar)
function usedTags() {
  const count = new Map();
  for (const d of docs) for (const t of d.tags || []) count.set(t, (count.get(t) || 0) + 1);
  return count;
}

const tagChip = (t, extra = '') => `<span class="tag-chip${familyOfLabel(t) ? ' fam' : ''}"${extra}>${escapeHtml(t)}</span>`;

// ============ DIÁLOGO: ETIQUETAS DE LA CANCIÓN ============
function tagDialog() {
  syncFromEditor();
  const d = cur();
  let tags = uniqueTags(d.tags || []);
  let fam = deduceFamily(tags).fam;
  let manual = false;

  const known = [...new Set([...usedTags().keys(), ...[...TAG_INDEX.values()].map(e => e.tag)])]
    .sort((a, b) => a.localeCompare(b, 'es'));

  const render = dlg => {
    const ded = deduceFamily(tags);
    dlg.querySelector('#tagChips').innerHTML = tags.length
      ? tags.map((t, i) => `<span class="tag-chip${familyOfLabel(t) ? ' fam' : ''}">${escapeHtml(t)}<button type="button" data-del="${i}" title="Quitar">×</button></span>`).join('')
      : '<span class="hint">Sin etiquetas todavía. Escribe la primera (por ejemplo: Entrada, Cueca, Himno o Bolero).</span>';
    dlg.querySelectorAll('[data-fam]').forEach(b => b.classList.toggle('on', fam ? b.dataset.fam === fam : manual && !b.dataset.fam));
    let hint = '';
    if (!manual && ded.options.length > 1) {
      hint = `«${escapeHtml(ded.first.tag)}» sirve para ${ded.options.map(f => TAG_FAMILIES[f].label).join(' y ')}. ¿A cuál te refieres? ` +
        ded.options.map(f => `<button type="button" class="btn small" data-fam-pick="${f}">${TAG_FAMILIES[f].icon} ${TAG_FAMILIES[f].label}</button>`).join(' ');
    } else if (fam && ded.first && !manual && !familyOfLabel(ded.first.tag)) {
      hint = `Por «${escapeHtml(ded.first.tag)}» entiendo que es <b>${TAG_FAMILIES[fam].label}</b>: abajo tienes sus alternativas.`;
    } else if (fam) {
      hint = `Tradición: <b>${TAG_FAMILIES[fam].icon} ${TAG_FAMILIES[fam].label}</b>. Abajo tienes sus alternativas.`;
    } else if (!fam) {
      hint = 'Elige una tradición o escribe una etiqueta y Cancionero Universal deduce a cuál se refiere.';
    }
    dlg.querySelector('#tagHint').innerHTML = hint;
    const active = new Set(tags.map(tagNorm));
    const groups = [...(fam ? TAG_FAMILIES[fam].groups : []), ...TAG_GENERAL_GROUPS];
    const q = tagNorm(dlg.querySelector('#tagInput').value);
    dlg.querySelector('#tagGroups').innerHTML = groups.map(g => {
      const list = g.tags.filter(t => !q || tagNorm(t).includes(q));
      if (!list.length) return '';
      return `<div class="tag-group"><b>${escapeHtml(g.name)}</b><div>${list.map(t =>
        `<button type="button" class="tag-opt${active.has(tagNorm(t)) ? ' on' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div></div>`;
    }).join('') || '<p class="hint">Ninguna alternativa coincide; pulsa Añadir para crearla como etiqueta nueva.</p>';
  };

  const update = dlg => {
    if (!manual) fam = deduceFamily(tags).fam ?? fam;
    if (fam) tags = withFamilyTag(tags, fam);
    render(dlg);
  };
  const addText = (dlg, text) => {
    const list = text.split(',').map(canonicalTag).filter(Boolean);
    if (!list.length) return;
    tags = uniqueTags([...tags, ...list]);
    const input = dlg.querySelector('#tagInput');
    input.value = '';
    update(dlg);
    input.focus();
  };

  return showModal({
    title: '🏷️ Tags de la canción',
    wide: true,
    body: `<p class="hint">Canción: <b>${escapeHtml(d.title.trim() || 'Sin título')}</b>. Sirven para clasificar y buscar tus canciones.</p>
      <div class="tag-chips" id="tagChips"></div>
      <div class="tag-add"><input type="text" id="tagInput" list="tagList" placeholder="Escribe una etiqueta y pulsa Enter (varias: separadas por coma)" autocomplete="off">
        <button type="button" class="btn" id="tagAddBtn">Añadir</button></div>
      <datalist id="tagList">${known.map(t => `<option value="${escapeHtml(t)}">`).join('')}</datalist>
      <div class="tag-fams">${Object.entries(TAG_FAMILIES).map(([id, f]) =>
        `<button type="button" data-fam="${id}">${f.icon} ${escapeHtml(f.label)}</button>`).join('')}<button type="button" data-fam="">Otra</button></div>
      <div class="tag-hint" id="tagHint"></div>
      <div class="tag-groups" id="tagGroups"></div>`,
    onOpen: dlg => {
      const input = dlg.querySelector('#tagInput');
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (input.value.trim()) addText(dlg, input.value); }
      });
      input.addEventListener('input', e => {
        // Elegida de la lista de sugerencias: se añade sin pulsar Enter
        if (e.inputType === 'insertReplacementText' || (!e.inputType && known.includes(input.value))) addText(dlg, input.value);
        else render(dlg);
      });
      dlg.querySelector('#tagAddBtn').onclick = () => addText(dlg, input.value);
      dlg.querySelector('.modal-body').addEventListener('click', e => {
        const del = e.target.closest('[data-del]');
        const famBtn = e.target.closest('[data-fam], [data-fam-pick]');
        const opt = e.target.closest('[data-tag]');
        if (del) {
          const removed = tags.splice(+del.dataset.del, 1)[0];
          if (removed && familyOfLabel(removed) === fam) { fam = null; manual = false; }
          update(dlg);
        } else if (famBtn) {
          fam = (famBtn.dataset.fam ?? famBtn.dataset.famPick) || null;
          manual = true;
          tags = withFamilyTag(tags, fam);
          render(dlg);
        } else if (opt) {
          const k = tagNorm(opt.dataset.tag);
          tags = tags.some(t => tagNorm(t) === k) ? tags.filter(t => tagNorm(t) !== k) : [...tags, opt.dataset.tag];
          update(dlg);
        }
      });
      update(dlg);
      input.focus();
    },
    buttons: [
      { label: 'Cancelar' },
      { label: 'Guardar', primary: true, onClick: dlg => {
        const pending = dlg.querySelector('#tagInput').value.trim();
        if (pending) tags = uniqueTags([...tags, ...pending.split(',').map(canonicalTag)]);
        return true;
      } }
    ]
  }).then(ok => {
    if (!ok) return;
    d.tags = uniqueTags(tags);
    refresh();
    toast(d.tags.length ? `Tags: ${d.tags.join(', ')}` : 'Canción sin tags', 2500);
  });
}

// ============ DIÁLOGO: BUSCAR POR ETIQUETAS ============
const SCAN_SKIP_DIRS = new Set(['vendor', 'js', 'css', 'servidor', 'node_modules', 'audio', 'cache']);

// Lee la cabecera (título y etiquetas) de los .md de la carpeta de canciones
async function scanSongsFolder(dir, parts = [], out = [], depth = 0) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') {
      if (depth < 4 && !SCAN_SKIP_DIRS.has(name.toLowerCase())) await scanSongsFolder(h, [...parts, name], out, depth + 1);
      continue;
    }
    if (!/\.(md|markdown)$/i.test(name)) continue;
    try {
      out.push({ handle: h, path: [...parts, name].join('/'), ...await songFileHead(await h.getFile()) });
    } catch (_) {}
  }
  return out;
}

// Título y tags de la cabecera de un .md
function songHeadText(text, name) {
  const fm = text.slice(0, 4000).replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  const field = k => fm?.[1].match(new RegExp(`^${k}\\s*:\\s*(.*)$`, 'mi'))?.[1].trim().replace(/^"(.*)"$/, '$1') || '';
  return { title: field('titulo') || fileBase(name), tags: metaToTags(field('etiquetas')) };
}

// Sin leer el archivo entero
async function songFileHead(file) {
  return songHeadText(await file.slice(0, 4000).text(), file.name);
}

function tagSearchDialog() {
  syncFromEditor();
  let folder = null;
  const used = [...usedTags().entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  const matches = (title, tags, terms) => terms.every(q => tagNorm(title).includes(q) || tags.some(t => tagNorm(t).includes(q)));
  const row = (attr, title, tags, extra = '') =>
    `<button type="button" class="tag-result" ${attr}><b>${escapeHtml(title)}</b>${extra}<span>${tags.map(t => tagChip(t)).join('') || '<i class="hint">sin tags</i>'}</span></button>`;

  const render = dlg => {
    const terms = dlg.querySelector('#tsQuery').value.split(',').map(tagNorm).filter(Boolean);
    const open = docs.filter(d => !isBlank(d) && matches(d.title, d.tags || [], terms));
    let html = `<div class="tag-res-head">Canciones abiertas (${open.length})</div>` +
      (open.map(d => row(`data-doc="${d.id}"`, d.title.trim() || 'Sin título', d.tags || [])).join('') || '<p class="hint">Ninguna coincide.</p>');
    if (folder) {
      const openTitles = new Set(docs.map(d => tagNorm(d.title)));
      const found = folder.filter(f => !openTitles.has(tagNorm(f.title)) && matches(f.title, f.tags, terms));
      html += `<div class="tag-res-head">En la carpeta de canciones (${found.length})</div>` +
        (found.map(f => row(`data-file="${folder.indexOf(f)}"`, f.title, f.tags, ` <small>${escapeHtml(f.path)}</small>`)).join('') || '<p class="hint">Ninguna coincide.</p>');
    }
    dlg.querySelector('#tsResults').innerHTML = html;
  };

  showModal({
    title: '🔎 Buscar canciones por tags',
    wide: true,
    body: `<input type="text" id="tsQuery" class="tag-search" placeholder="Escribe tags o palabras del título (varias: separadas por coma)" autocomplete="off">
      ${used.length ? `<div class="tag-cloud">${used.map(([t, n]) => `<button type="button" class="tag-opt" data-q="${escapeHtml(t)}">${escapeHtml(t)} <small>${n}</small></button>`).join('')}</div>` : ''}
      ${canPickFiles ? '<button type="button" class="btn small" id="tsFolder">📁 Buscar también en la carpeta de canciones</button>' : ''}
      <div class="tag-results" id="tsResults"></div>`,
    onOpen: dlg => {
      const q = dlg.querySelector('#tsQuery');
      q.addEventListener('input', () => render(dlg));
      q.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
      dlg.querySelector('.modal-body').addEventListener('click', async e => {
        const chip = e.target.closest('[data-q]');
        const docBtn = e.target.closest('[data-doc]');
        const fileBtn = e.target.closest('[data-file]');
        if (chip) {
          const terms = q.value.split(',').map(s => s.trim()).filter(Boolean);
          if (!terms.some(t => tagNorm(t) === tagNorm(chip.dataset.q))) terms.push(chip.dataset.q);
          q.value = terms.join(', ');
          render(dlg);
        } else if (docBtn) {
          dlg.close();
          switchTab(docBtn.dataset.doc);
        } else if (fileBtn) {
          const f = folder[+fileBtn.dataset.file];
          dlg.close();
          await openFiles([{ file: await f.handle.getFile(), handle: f.handle }]);
        } else if (e.target.id === 'tsFolder') {
          const dir = await songsDirWithPermission(true, 'read');
          if (!dir) { toast('Primero añade tu carpeta de canciones (Archivo → Abrir colección…)', 4000); return; }
          e.target.disabled = true;
          e.target.textContent = 'Leyendo la carpeta…';
          folder = await scanSongsFolder(dir);
          e.target.textContent = `📁 ${folder.length} canciones leídas en "${dir.name}"`;
          render(dlg);
        }
      });
      render(dlg);
      q.focus();
    }
  });
}
