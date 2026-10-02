'use strict';
// Herramientas → Grabar: graba con el micrófono y guarda la toma (.webm) en la carpeta «audios»
// de la carpeta de canciones (o en la que elija el usuario), vinculada a la canción abierta.
// El sonido pasa por una cadena propia para que no quede ni muy bajo ni reventado:
//   micrófono → ganancia de entrada → nivel automático (lento) → limitador → techo -1 dBFS → grabación
// El audio queda tal cual: quien quiera retocarlo lo abre con su propio editor.

const REC_FOLDER = 'audios';
const REC_TARGET_DB = -18;    // nivel medio al que lleva el nivel automático
const REC_MAX_UP_DB = 18;
const REC_MAX_DOWN_DB = -12;
const REC_GATE_DB = -50;      // por debajo es silencio: no se sube la ganancia (no levanta el ruido)
const REC_CEIL_DB = -1;       // ningún pico pasa de aquí
const REC_LOW_DB = -40;
const REC_TICK_MS = 50;
const REC_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

const dbToGain = db => Math.pow(10, db / 20);
const gainToDb = g => g > 0 ? 20 * Math.log10(g) : -Infinity;

// status: off (cerrado) | starting | ready (micrófono abierto) | recording | paused | done (toma sin guardar) | error
const rec = {
  status: 'off', stream: null, ctx: null, n: null, recorder: null, chunks: [], blob: null, url: '',
  mime: '', ext: 'webm', startedAt: 0, elapsed: 0, timer: 0,
  inPow: 0, outPow: 0, slowOut: -90, peakHold: 0, peakAt: 0, clipAt: 0, lowSince: 0, error: ''
};
const recSettings = { gain: 0, agc: true, ...JSON.parse(localStorage.getItem('canciotras-grabar') || '{}') };
const saveRecSettings = () => localStorage.setItem('canciotras-grabar', JSON.stringify(recSettings));

const recorderBusy = () => ['recording', 'paused', 'done'].includes(rec.status);

// ============ CARPETA DE AUDIOS ============
const savedAudiosFolder = () => handleGet('audios');

// Sin carpeta propia: «audios» dentro de la de canciones (se crea). `ask` puede abrir diálogos.
async function audiosFolder(ask) {
  const own = await savedAudiosFolder();
  if (own && await permissionOk(own, ask, 'readwrite')) return own;
  const songs = ask ? await songsFolder() : await savedSongsFolder();
  if (!songs || !await permissionOk(songs, ask, 'readwrite')) return null;
  try {
    return await songs.getDirectoryHandle(REC_FOLDER, { create: true });
  } catch (_) {
    return null;
  }
}

async function audiosFolderLabel() {
  if (!canPickFiles) return 'Se guarda en las <b>Descargas</b> de este dispositivo.';
  const own = await savedAudiosFolder();
  const songs = await savedSongsFolder();
  const where = own ? escapeHtml(own.name) : songs ? `${escapeHtml(songs.name)}/${REC_FOLDER}` : '';
  return (where ? `Se guarda en <b>${where}</b>` : `Se guarda en la carpeta <b>${REC_FOLDER}</b> de tus canciones`) +
    ' · <button type="button" class="linkish" data-rc="folder">Cambiar carpeta…</button>';
}

async function pickAudiosFolder() {
  let dir;
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite', startIn: (await audiosFolder(false)) || (await savedSongsFolder()) || 'music' });
  } catch (e) {
    if (e.name !== 'AbortError') toast('No se pudo usar esa carpeta');
    return;
  }
  await handleSet('audios', dir);
  toast(`Las grabaciones se guardarán en «${dir.name}»`, 3000);
  renderRecorder();
}

async function freeFileName(dir, base, ext) {
  for (let i = 1; ; i++) {
    const name = `${base}${i > 1 ? ` (${i})` : ''}.${ext}`;
    try { await dir.getFileHandle(name); } catch (_) { return name; }
  }
}

// ============ MICRÓFONO Y CADENA DE AUDIO ============
// Curva del techo: lineal hasta 0,7 y luego se acerca suave a -1 dBFS sin pasarlo nunca.
// La entrada se escala a la mitad para que la curva cubra hasta el doble de la escala completa.
function ceilingCurve() {
  const n = 4096, k = 0.7, c = dbToGain(REC_CEIL_DB), curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = (i / (n - 1) * 2 - 1) * 2;
    const a = Math.abs(v);
    curve[i] = Math.sign(v) * (a <= k ? a : k + (c - k) * Math.tanh((a - k) / (c - k)));
  }
  return curve;
}

async function startInput() {
  rec.status = 'starting';
  rec.error = '';
  renderRecorder();
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('unsupported');
    rec.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch (e) {
    rec.status = 'error';
    rec.error = e.message === 'unsupported' ? 'Este navegador no permite grabar desde la página.'
      : e.name === 'NotAllowedError' ? 'No hay permiso para usar el micrófono. Permítelo en el candado de la barra de direcciones.'
      : e.name === 'NotFoundError' ? 'No se encontró ningún micrófono.'
      : 'No se pudo abrir el micrófono.';
    renderRecorder();
    return;
  }
  const ctx = rec.ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(rec.stream);
  const analyser = () => { const a = ctx.createAnalyser(); a.fftSize = 2048; return a; };
  const n = rec.n = {
    raw: analyser(),            // lo que llega del micrófono: saturación que ya no tiene arreglo
    input: ctx.createGain(),
    level: analyser(),          // lo que mide el nivel automático
    agc: ctx.createGain(),
    limiter: ctx.createDynamicsCompressor(),
    pre: ctx.createGain(),
    ceiling: ctx.createWaveShaper(),
    out: analyser(),            // lo que se graba
    dest: ctx.createMediaStreamDestination()
  };
  n.input.gain.value = dbToGain(recSettings.gain);
  n.limiter.threshold.value = -6;
  n.limiter.knee.value = 0;
  n.limiter.ratio.value = 20;
  n.limiter.attack.value = 0.001;
  n.limiter.release.value = 0.15;
  n.pre.gain.value = 0.5;
  n.ceiling.curve = ceilingCurve();
  n.ceiling.oversample = '4x';
  src.connect(n.raw);
  src.connect(n.input);
  n.input.connect(n.level);
  n.input.connect(n.agc).connect(n.limiter).connect(n.pre).connect(n.ceiling).connect(n.dest);
  n.ceiling.connect(n.out);
  rec.buf = new Float32Array(2048);
  Object.assign(rec, { inPow: 0, outPow: 0, slowOut: -90, peakHold: 0, clipAt: 0, lowSince: performance.now() });
  rec.timer = setInterval(recTick, REC_TICK_MS);
  rec.status = 'ready';
  renderRecorder();
}

function stopInput() {
  clearInterval(rec.timer);
  rec.stream?.getTracks().forEach(t => t.stop());
  rec.ctx?.close().catch(() => {});
  Object.assign(rec, { stream: null, ctx: null, n: null, recorder: null });
}

// Pico y potencia media de un analizador
function readLevel(a) {
  a.getFloatTimeDomainData(rec.buf);
  let peak = 0, sum = 0;
  for (const v of rec.buf) { const x = Math.abs(v); if (x > peak) peak = x; sum += v * v; }
  return { peak, pow: sum / rec.buf.length };
}

function recTick() {
  const n = rec.n;
  if (!n) return;
  const now = performance.now();
  const raw = readLevel(n.raw), level = readLevel(n.level), out = readLevel(n.out);
  if (raw.peak >= 0.98) rec.clipAt = now;
  // Promedios (~300 ms) para que el nivel automático no reaccione a cada golpe
  const k = REC_TICK_MS / 300;
  rec.inPow += (level.pow - rec.inPow) * k;
  rec.outPow += (out.pow - rec.outPow) * k;
  const inDb = 10 * Math.log10(rec.inPow + 1e-12);
  const outDb = 10 * Math.log10(rec.outPow + 1e-12);
  rec.slowOut += (outDb - rec.slowOut) * (REC_TICK_MS / 3000);
  if (out.peak > rec.peakHold || now - rec.peakAt > 1500) { rec.peakHold = out.peak; rec.peakAt = now; }
  if (rec.slowOut > REC_LOW_DB) rec.lowSince = now;

  // Nivel automático: sube despacio (~2 s) y baja rápido (~0,3 s); en silencio se queda quieto
  const g = n.agc.gain, t = rec.ctx.currentTime;
  if (!recSettings.agc) {
    g.setTargetAtTime(1, t, 0.1);
  } else if (inDb > REC_GATE_DB) {
    const want = dbToGain(Math.min(REC_MAX_UP_DB, Math.max(REC_MAX_DOWN_DB, REC_TARGET_DB - inDb)));
    g.setTargetAtTime(want, t, want > g.value ? 0.7 : 0.1);
  }
  drawRecMeter(outDb, now);
  if (rec.status === 'recording') rq('.rc-time').textContent = fmtRecTime(recElapsed());
}

// ============ GRABAR ============
const recElapsed = () => rec.elapsed + (rec.status === 'recording' ? performance.now() - rec.startedAt : 0);
const fmtRecTime = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function startRecording() {
  if (!rec.n) return;
  rec.mime = REC_MIMES.find(m => MediaRecorder.isTypeSupported(m)) || '';
  rec.ext = rec.mime.startsWith('audio/mp4') ? 'm4a' : 'webm';
  rec.chunks = [];
  const r = rec.recorder = new MediaRecorder(rec.n.dest.stream, { ...(rec.mime && { mimeType: rec.mime }), audioBitsPerSecond: 128000 });
  r.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
  r.onstop = () => {
    rec.blob = new Blob(rec.chunks, { type: (rec.mime || r.mimeType || 'audio/webm').split(';')[0] });
    rec.chunks = [];
    if (rec.url) URL.revokeObjectURL(rec.url);
    rec.url = URL.createObjectURL(rec.blob);
    rec.status = 'done';
    renderRecorder();
  };
  r.start(1000);
  rec.elapsed = 0;
  rec.startedAt = performance.now();
  rec.status = 'recording';
  renderRecorder();
}

function pauseRecording() {
  if (rec.status === 'recording') {
    rec.recorder.pause();
    rec.elapsed += performance.now() - rec.startedAt;
    rec.status = 'paused';
  } else if (rec.status === 'paused') {
    rec.recorder.resume();
    rec.startedAt = performance.now();
    rec.status = 'recording';
  }
  renderRecorder();
}

function stopRecording() {
  if (rec.status !== 'recording' && rec.status !== 'paused') return;
  if (rec.status === 'recording') rec.elapsed += performance.now() - rec.startedAt;
  rec.recorder.stop();
}

function discardTake() {
  if (rec.url) URL.revokeObjectURL(rec.url);
  Object.assign(rec, { blob: null, url: '', elapsed: 0 });
  rec.status = rec.n ? 'ready' : 'off';
  renderRecorder();
}

function defaultTakeName() {
  const d = new Date(), p = v => String(v).padStart(2, '0');
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
  const title = cur().title.trim();
  return `${title ? title + ' - grabación' : 'Grabación'} ${when}`;
}

async function saveTake() {
  if (!rec.blob) return;
  const base = safeFileName(rq('.rc-name').value.trim() || defaultTakeName());
  const voice = rq('.rc-voice').value;
  const song = cur().title.trim() || 'Sin título';
  const btn = rq('[data-rc="save"]');
  btn.disabled = true;
  try {
    if (canPickFiles) {
      const dir = await audiosFolder(true);
      if (!dir) { toast('Elige dónde guardar las grabaciones (Cambiar carpeta…)', 4000); return; }
      const fileName = await freeFileName(dir, base, rec.ext);
      const fh = await dir.getFileHandle(fileName, { create: true });
      const w = await fh.createWritable();
      await w.write(rec.blob);
      await w.close();
      await attachLocalFile(await fh.getFile(), { handle: fh, name: base, voice });
      toast(`Grabación guardada en «${dir.name}/${fileName}» y vinculada a «${song}»`, 5000);
    } else {
      const fileName = `${base}.${rec.ext}`;
      if (!await saveFile(rec.blob, fileName, rec.blob.type, '.' + rec.ext, 'Grabación')) return;
      await attachLocalFile(new File([rec.blob], fileName, { type: rec.blob.type }), { name: base, voice });
      toast(`Grabación guardada («${fileName}») y vinculada a «${song}»`, 5000);
    }
    discardTake();
  } catch (e) {
    toast('No se pudo guardar la grabación: ' + e.message, 6000);
  } finally {
    btn.disabled = false;
  }
}

// ============ PANEL ============
const recPanel = el('aside', 'book-picker rec-panel');
recPanel.id = 'recordPanel';
recPanel.hidden = true;
recPanel.setAttribute('aria-label', 'Grabar');
recPanel.innerHTML = `
  <div class="bp-head">
    <div><b>🎙️ Grabar</b><div class="bp-name hint"></div></div>
    <button type="button" class="panel-close" data-rc="close" aria-label="Cerrar">×</button>
  </div>
  <div class="rc-dest hint"></div>
  <div class="rc-error" hidden></div>
  <canvas class="rc-meter" width="392" height="26" aria-hidden="true"></canvas>
  <div class="rc-status hint"></div>
  <div class="rc-controls">
    <button type="button" class="rc-rec" data-rc="rec" title="Grabar"><span></span></button>
    <span class="rc-time">0:00</span>
    <button type="button" class="btn" data-rc="pause">⏸ Pausa</button>
    <button type="button" class="btn" data-rc="stop">⏹ Detener</button>
  </div>
  <details class="rc-settings">
    <summary>Nivel de grabación</summary>
    <label class="rc-check"><input type="checkbox" class="rc-agc"> Nivel automático
      <small class="hint">sube lo que suena bajito y baja lo que suena fuerte</small></label>
    <label class="field"><span>Ganancia de entrada: <b class="rc-gain-val"></b></span>
      <input type="range" class="rc-gain" min="-12" max="24" step="1"></label>
    <p class="hint">El limitador está siempre activo: ningún pico pasa de ${REC_CEIL_DB} dB, así no se revienta.</p>
  </details>
  <div class="rc-take" hidden>
    <audio class="rc-preview" controls></audio>
    <label class="field"><span>Nombre del archivo</span><input type="text" class="rc-name" autocomplete="off"></label>
    <label class="field"><span>Voz</span><select class="rc-voice"></select></label>
    <div class="bp-foot">
      <span class="bp-count"></span>
      <button type="button" class="btn" data-rc="discard">Descartar</button>
      <button type="button" class="btn primary" data-rc="save">Guardar</button>
    </div>
  </div>`;
document.body.appendChild(recPanel);

const rq = s => recPanel.querySelector(s);

function drawRecMeter(outDb, now) {
  const cv = rq('.rc-meter'), g = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  const x = db => Math.max(0, Math.min(1, (db + 60) / 60)) * w;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#f1f3f4';
  g.fillRect(0, 0, w, h);
  const lvl = x(outDb);
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#34a853');
  grad.addColorStop(x(-12) / w, '#34a853');
  grad.addColorStop(x(-6) / w, '#fbbc04');
  grad.addColorStop(x(-2) / w, '#ea4335');
  g.fillStyle = grad;
  g.fillRect(0, 4, lvl, h - 8);
  const pk = x(gainToDb(rec.peakHold));
  g.fillStyle = rec.peakHold >= dbToGain(-3) ? '#ea4335' : '#3c4043';
  g.fillRect(Math.max(0, pk - 2), 0, 2, h);
  g.fillStyle = 'rgba(0,0,0,.25)';
  for (const db of [-48, -36, -24, -18, -12, -6]) g.fillRect(x(db), h - 4, 1, 4);

  const st = rq('.rc-status');
  const msg = now - rec.clipAt < 1500
    ? ['clip', '¡El micrófono satura! Baja su volumen en el sistema o aléjate un poco.']
    : rec.n && rec.n.limiter.reduction < -3 ? ['limit', 'Suena fuerte: el limitador lo está conteniendo.']
    : now - rec.lowSince > 3000 ? ['low', 'Muy bajo o no llega sonido: acércate o sube la ganancia de entrada.']
    : ['', rec.status === 'ready' ? 'Prueba el nivel: canta o toca y mira la barra.' : ''];
  if (st.dataset.kind !== msg[0] || st.textContent !== msg[1]) {
    st.dataset.kind = msg[0];
    st.textContent = msg[1];
  }
}

async function renderRecorder() {
  if (recPanel.hidden) return;
  const s = rec.status;
  rq('.bp-name').textContent = `Para «${cur().title.trim() || 'Sin título'}»`;
  rq('.rc-error').hidden = s !== 'error';
  rq('.rc-error').innerHTML = s === 'error'
    ? `${escapeHtml(rec.error)} <button type="button" class="btn small" data-rc="retry">Reintentar</button>` : '';
  const live = s === 'recording' || s === 'paused';
  const recBtn = rq('[data-rc="rec"]');
  recBtn.disabled = s !== 'ready';
  recBtn.classList.toggle('on', live);
  rq('[data-rc="pause"]').disabled = !live;
  rq('[data-rc="pause"]').textContent = s === 'paused' ? '⏺ Seguir' : '⏸ Pausa';
  rq('[data-rc="stop"]').disabled = !live;
  rq('.rc-time').classList.toggle('paused', s === 'paused');
  if (!live && s !== 'done') rq('.rc-time').textContent = '0:00';
  if (s === 'starting') rq('.rc-status').textContent = 'Abriendo el micrófono…';
  rq('.rc-agc').checked = recSettings.agc;
  rq('.rc-gain').value = recSettings.gain;
  rq('.rc-gain-val').textContent = `${recSettings.gain > 0 ? '+' : ''}${recSettings.gain} dB`;

  const take = rq('.rc-take');
  const wasHidden = take.hidden;
  take.hidden = s !== 'done';
  if (s === 'done' && wasHidden) {
    rq('.rc-preview').src = rec.url;
    rq('.rc-name').value = defaultTakeName();
    rq('.rc-voice').innerHTML = voiceOptionsHtml('todas');
    rq('.rc-time').textContent = fmtRecTime(rec.elapsed);
    rq('.bp-count').textContent = `${fmtRecTime(rec.elapsed)} · ${(rec.blob.size / 1048576).toFixed(1)} MB · .${rec.ext}${rec.ext !== 'webm' ? ' (este navegador no graba webm)' : ''}`;
  }
  if (s !== 'done') rq('.rc-preview').removeAttribute('src');
  rq('.rc-dest').innerHTML = await audiosFolderLabel();
}

async function openRecorder() {
  if (!recPanel.hidden) return;
  if (typeof closeCollection === 'function') closeCollection();
  updateChromeHeight();
  recPanel.hidden = false;
  if (!rec.n) await startInput();
  else renderRecorder();
}

async function closeRecorder() {
  if (rec.status === 'recording' || rec.status === 'paused' || rec.status === 'done') {
    const ok = await showModal({
      title: 'Grabación sin guardar',
      body: '<p>La toma que hiciste todavía no está guardada. ¿Descartarla?</p>',
      buttons: [{ label: 'Seguir grabando' }, { label: 'Descartar y cerrar', primary: true, value: true }]
    });
    if (!ok) return;
    if (rec.recorder && rec.recorder.state !== 'inactive') { rec.recorder.onstop = null; rec.recorder.stop(); }
  }
  stopInput();
  if (rec.url) URL.revokeObjectURL(rec.url);
  Object.assign(rec, { status: 'off', blob: null, url: '', elapsed: 0 });
  recPanel.hidden = true;
}

recPanel.addEventListener('click', e => {
  const b = e.target.closest('[data-rc]');
  if (!b || b.disabled) return;
  const act = b.dataset.rc;
  if (act === 'close') closeRecorder();
  else if (act === 'rec') startRecording();
  else if (act === 'pause') pauseRecording();
  else if (act === 'stop') stopRecording();
  else if (act === 'save') saveTake();
  else if (act === 'discard') discardTake();
  else if (act === 'folder') pickAudiosFolder();
  else if (act === 'retry') startInput();
});
rq('.rc-agc').addEventListener('change', e => { recSettings.agc = e.target.checked; saveRecSettings(); });
rq('.rc-gain').addEventListener('input', e => {
  recSettings.gain = +e.target.value;
  saveRecSettings();
  rq('.rc-gain-val').textContent = `${recSettings.gain > 0 ? '+' : ''}${recSettings.gain} dB`;
  if (rec.n) rec.n.input.gain.setTargetAtTime(dbToGain(recSettings.gain), rec.ctx.currentTime, 0.05);
});
rq('.rc-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveTake(); } });

// El panel dice siempre a qué canción se vincula
new MutationObserver(() => { if (!recPanel.hidden) rq('.bp-name').textContent = `Para «${cur().title.trim() || 'Sin título'}»`; })
  .observe($('#tabs'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
