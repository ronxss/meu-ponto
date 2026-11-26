// Testa o notificador com as APIs do Google simuladas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { run, separar, lerEventos, mensagem } from '../notifier/notifier.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ project_id: 'p', client_email: 'x@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const NOW = Date.UTC(2026, 10, 26, 15, 58, 5);
const ev = (ts, tipo, h) => ({ mapValue: { fields: { ts: { integerValue: String(ts) }, tipo: { stringValue: tipo }, h: { stringValue: h } } } });

test('separar: vencidos, futuros e próximo', () => {
  const r = separar([{ ts: NOW - 5000, tipo: 'alm', h: '13:00' }, { ts: NOW + 60000, tipo: 'sai', h: '17:00' }, { ts: NOW - 3600e3, tipo: 'sai', h: '09:00' }], NOW);
  assert.deepEqual(r.due.map(e => e.tipo), ['alm']);
  assert.deepEqual(r.rest.map(e => e.tipo), ['sai']);
  assert.equal(r.prox, NOW + 60000);
});

test('lerEventos descarta lixo; texto vem do servidor', () => {
  const evs = lerEventos({ eventos: { arrayValue: { values: [ev(1, 'alm', '13:00'), ev(2, 'hack', '13:00'), ev(3, 'sai', '<b>')] } } });
  assert.deepEqual(evs.map(e => e.tipo), ['alm']);
  assert.match(mensagem({ tipo: 'alm', h: '13:00' }).body, /13:00/);
});

test('run: envia só para os aparelhos do próprio usuário e limpa token inválido', async () => {
  const calls = [];
  const fake = async (url, o = {}) => {
    calls.push([o.method || 'GET', url, o.body]);
    const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (url.includes('oauth2')) return J({ access_token: 'T', expires_in: 3600 });
    if (url.endsWith(':runQuery')) return J([{ document: {
      name: 'projects/p/databases/(default)/documents/avisos/U1', updateTime: '2026-11-26T15:00:00Z',
      fields: { eventos: { arrayValue: { values: [ev(NOW - 5000, 'alm', '13:00'), ev(NOW + 3600e3, 'sai', '17:00')] } } } } }, { readTime: 'x' }]);
    if (o.method === 'PATCH') return J({});
    if (url.includes('/usuarios/U1/push')) {
      if (o.method === 'DELETE') return J({});
      return J({ documents: [{ name: '.../push/A', fields: { token: { stringValue: 'TA' } } }, { name: '.../push/B', fields: { token: { stringValue: 'TB' } } }] });
    }
    if (url.includes('fcm.googleapis.com')) {
      const tok = JSON.parse(o.body).message.token;
      return tok === 'TB' ? new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 }) : J({ name: 'm' });
    }
    return J({}, 404);
  };
  const r = await run({ FIREBASE_SERVICE_ACCOUNT: SA, APP_URL: 'https://app.test/' }, { fetch: fake, now: NOW });
  assert.equal(r.usuarios, 1); assert.equal(r.enviados, 1); assert.equal(r.tokensRemovidos, 1);
  const patch = calls.find(c => c[0] === 'PATCH');
  assert.match(patch[1], /currentDocument\.updateTime=/);
  const body = JSON.parse(patch[2]);
  assert.equal(body.fields.eventos.arrayValue.values.length, 1);
  assert.equal(body.fields.prox.integerValue, String(NOW + 3600e3));
  const msg = JSON.parse(calls.find(c => c[1].includes('fcm.googleapis.com'))[2]).message;
  assert.equal(msg.notification.title, '🍽️ Volta do almoço em 2 min');
  assert.equal(msg.webpush.fcm_options.link, 'https://app.test/#hoje');
  // PATCH (marcar) acontece antes do envio
  assert.ok(calls.findIndex(c => c[0] === 'PATCH') < calls.findIndex(c => c[1].includes('fcm.googleapis.com')));
});

test('run: conflito com o app (documento mudou) não envia', async () => {
  let enviou = false;
  const fake = async (url, o = {}) => {
    const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (url.includes('oauth2')) return J({ access_token: 'T', expires_in: 3600 });
    if (url.endsWith(':runQuery')) return J([{ document: { name: 'x/avisos/U2', updateTime: 't', fields: { eventos: { arrayValue: { values: [ev(NOW - 1000, 'sai', '17:00')] } } } } }]);
    if (o.method === 'PATCH') return J({ error: 'FAILED_PRECONDITION' }, 400);
    if (url.includes('fcm')) enviou = true;
    return J({});
  };
  const r = await run({ FIREBASE_SERVICE_ACCOUNT: SA }, { fetch: fake, now: NOW });
  assert.equal(r.conflitos, 1); assert.equal(enviou, false);
});
