// Service worker: funciona offline e recebe os lembretes (Firebase Cloud Messaging) com o app fechado.
// Não guarda respostas de Auth, Firestore ou anúncios.
const CACHE = 'meu-ponto-v3';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'ponto.js', 'config.js', 'manifest.webmanifest',
  'privacidade.html', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png'];
const SDK = 'https://www.gstatic.com/firebasejs/';

importScripts('config.js');
const CFG = self.APP_CONFIG || {};
if (CFG.vapidKey && CFG.firebase && CFG.firebase.apiKey && !String(CFG.firebase.apiKey).startsWith('COLE')) {
  try {
    importScripts(SDK + '10.14.1/firebase-app-compat.js', SDK + '10.14.1/firebase-messaging-compat.js');
    firebase.initializeApp(CFG.firebase);
    firebase.messaging(); // mensagens com "notification" são exibidas pelo próprio SDK
  } catch (e) { /* sem rede agora: tenta de novo na próxima ativação */ }
}

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

// Toque na notificação: abre (ou traz para frente) o app na tela Hoje.
self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {};
  if (d.FCM_MSG) return; // o SDK do Firebase já trata
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./#hoje');
  }));
});
