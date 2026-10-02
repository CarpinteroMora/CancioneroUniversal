'use strict';
// Cancionero Universal sin conexión: con internet siempre se carga la versión más nueva
// (y se guarda una copia); sin internet, o si la red tarda, se usa la copia guardada.

const CACHE = 'cancionero-4.2.0';
const NET_TIMEOUT = 3000;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/canciotras.css',
  'icons/icono-180.png', 'icons/icono-192.png', 'icons/icono-512.png', 'icons/icono-maskable-512.png',
  ...['acordes', 'markdown', 'ui', 'instrumentos', 'rasgueos', 'render', 'audio', 'extractor', 'youtube', 'hojas',
    'panel', 'pestanas', 'editor', 'cancionero', 'coleccion', 'grabar', 'nuevo', 'imprimir', 'etiquetas', 'exportar', 'zip', 'oficina',
    'ejemplo', 'guardar', 'colaboradores', 'movil', 'app'].map(n => `js/${n}.js`),
  ...['guitarra', 'ukelele', 'mandolina', 'charango'].map(n => `vendor/acordes/${n}.js`)
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('cancionero-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Solo archivos de la propia app: nada del servidor local, de YouTube ni pedidos parciales de audio
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') ||
      req.headers.has('range')) return;
  const net = fetch(req, { cache: 'no-cache' });
  e.waitUntil(net.then(res => {
    if (!res.ok || res.type !== 'basic') return;
    const copy = res.clone();
    return caches.open(CACHE).then(c => c.put(req, copy));
  }).catch(() => {}));
  e.respondWith(networkFirst(req, net));
});

async function networkFirst(req, net) {
  const cache = await caches.open(CACHE);
  const cached = () => cache.match(req, { ignoreSearch: true })
    .then(r => r || (req.mode === 'navigate' ? cache.match('index.html') : undefined));
  let timer;
  const slow = new Promise(resolve => { timer = setTimeout(resolve, NET_TIMEOUT); }).then(cached);
  try {
    const first = await Promise.race([net, slow.then(r => r || net)]);
    clearTimeout(timer);
    return first;
  } catch (err) {
    clearTimeout(timer);
    const r = await cached();
    if (r) return r;
    throw err;
  }
}
