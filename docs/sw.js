// Service worker: funciona offline. Não guarda respostas de anúncios, Auth ou Firestore.
const CACHE = 'meu-ponto-v2';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'ponto.js', 'config.js', 'manifest.webmanifest',
  'privacidade.html', 'icons/icon-192.png', 'icons/icon-512.png'];
const SDK = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Rede primeiro (pega atualizações); sem internet, usa o que está guardado.
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const proprio = u.origin === self.location.origin;
  const sdk = r.url.startsWith(SDK);
  if (!proprio && !sdk) return; // anúncios, Auth e Firestore seguem direto, sem cache
  e.respondWith(fetch(r).then(res => {
    if (res.ok && (proprio || res.type === 'cors')) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
