// Notificador do Meu Ponto: a cada minuto procura em avisos/{uid} os lembretes vencidos
// (volta do almoço e saída, 2 min antes) e envia push para os aparelhos daquele usuário.
// Sem dependências: roda no Cloudflare Workers e no Node 18+ (fetch + WebCrypto).
// Usa conta de serviço (ignora as regras do Firestore), mas só envia cada aviso para os
// aparelhos registrados pelo PRÓPRIO usuário em usuarios/{uid}/push.

const MAX_ATRASO_MS = 10 * 60 * 1000; // aviso atrasado mais que isso é descartado
const TIPOS = {
  alm: h => ({ title: '🍽️ Volta do almoço em 2 min', body: `Bata o ponto de retorno às ${h}.` }),
  sai: h => ({ title: '🏁 Fim da jornada em 2 min', body: `Bata o ponto de saída às ${h}.` }),
  teste: () => ({ title: '🔔 Teste do Meu Ponto', body: 'Se chegou, os avisos estão funcionando neste aparelho.' }),
};
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const b64url = buf => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let cache = null; // token de acesso reaproveitado entre execuções (economiza CPU no Worker)
export async function googleToken(sa, fetchFn = fetch) {
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.email === sa.client_email && cache.exp - 300 > now) return cache.tok;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claim}.${b64url(sig)}`,
  });
  if (!r.ok) throw new Error(`token Google: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cache = { tok: j.access_token, exp: now + (j.expires_in || 3600), email: sa.client_email };
  return cache.tok;
}

const str = f => f && (f.stringValue ?? (f.integerValue != null ? String(f.integerValue) : undefined));

// Converte o array do Firestore em eventos válidos (descarta qualquer coisa fora do formato).
export function lerEventos(fields) {
  const vals = fields?.eventos?.arrayValue?.values || [];
  return vals.map(v => v.mapValue?.fields || {}).map(f => ({ ts: +str(f.ts), tipo: str(f.tipo), h: str(f.h) || '' }))
    .filter(e => Number.isFinite(e.ts) && TIPOS[e.tipo] && (e.tipo === 'teste' || HORA.test(e.h)))
    .slice(0, 5);
}

// Separa vencidos (para enviar agora) dos futuros. Função pura (testável).
export function separar(eventos, now) {
  const due = eventos.filter(e => e.ts <= now && e.ts > now - MAX_ATRASO_MS);
  const rest = eventos.filter(e => e.ts > now);
  return { due, rest, prox: rest.length ? Math.min(...rest.map(e => e.ts)) : null };
}

export function mensagem(e) { return TIPOS[e.tipo](e.h); }

const evFs = e => ({ mapValue: { fields: { ts: { integerValue: String(e.ts) }, tipo: { stringValue: e.tipo }, h: { stringValue: e.h } } } });

export async function run(env, opts = {}) {
  const fetchFn = opts.fetch || fetch;
  const now = opts.now || Date.now();
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Defina o segredo FIREBASE_SERVICE_ACCOUNT (JSON da conta de serviço).');
  const sa = typeof env.FIREBASE_SERVICE_ACCOUNT === 'string' ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : env.FIREBASE_SERVICE_ACCOUNT;
  const project = sa.project_id;
  const tok = await googleToken(sa, fetchFn);
  const H = { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
  const root = `projects/${project}/databases/(default)/documents`;
  const base = `https://firestore.googleapis.com/v1/${root}`;

  // Só documentos com algum aviso vencido (prox <= agora).
  const q = await fetchFn(`${base}:runQuery`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'avisos' }],
      where: { fieldFilter: { field: { fieldPath: 'prox' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(now) } } },
      limit: 500,
    } }),
  });
  if (!q.ok) throw new Error(`Firestore runQuery: ${q.status} ${await q.text()}`);
  const docs = (await q.json()).filter(x => x.document).map(x => x.document);

  const res = { now: new Date(now).toISOString(), usuarios: docs.length, enviados: 0, tokensRemovidos: 0, conflitos: 0 };
  const umUsuario = async doc => {
    const uid = doc.name.split('/').pop();
    const { due, rest, prox } = separar(lerEventos(doc.fields), now);
    // Marca antes de enviar (evita duplicado). Se o app mudou o documento nesse meio-tempo, pula: a próxima rodada usa a versão nova.
    const mask = 'updateMask.fieldPaths=eventos&updateMask.fieldPaths=prox';
    const pre = `currentDocument.updateTime=${encodeURIComponent(doc.updateTime)}`;
    const up = await fetchFn(`${base}/avisos/${encodeURIComponent(uid)}?${mask}&${pre}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ fields: { eventos: { arrayValue: { values: rest.map(evFs) } }, prox: prox == null ? { nullValue: null } : { integerValue: String(prox) } } }),
    });
    if (!up.ok) { res.conflitos++; return; }
    if (!due.length) return;

    const tl = await fetchFn(`${base}/usuarios/${encodeURIComponent(uid)}/push?pageSize=20`, { headers: H });
    if (!tl.ok) return;
    const tokens = ((await tl.json()).documents || []).map(d => ({ id: d.name.split('/').pop(), token: str(d.fields?.token) })).filter(t => t.token);

    // Se houver mais de um vencido do mesmo tipo, manda só o mais recente.
    const porTipo = {}; for (const e of due) if (!porTipo[e.tipo] || porTipo[e.tipo].ts < e.ts) porTipo[e.tipo] = e;
    for (const t of tokens) for (const e of Object.values(porTipo)) {
      const n = mensagem(e);
      const webpush = { notification: { tag: 'mp-' + e.tipo, renotify: true, requireInteraction: e.tipo !== 'teste' } };
      if (env.APP_URL) {
        webpush.fcm_options = { link: new URL('#ponto', env.APP_URL).href };
        webpush.notification.icon = new URL('icons/icon-192.png', env.APP_URL).href;
        webpush.notification.badge = new URL('icons/badge-96.png', env.APP_URL).href;
      }
      const r = await fetchFn(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ message: { token: t.token, notification: n, data: { tipo: e.tipo }, webpush } }),
      });
      if (r.ok) { res.enviados++; continue; }
      const txt = await r.text();
      // Token que não existe mais (app desinstalado, permissão revogada): apaga e para de tentar.
      if (r.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(txt)) {
        await fetchFn(`https://firestore.googleapis.com/v1/${root}/usuarios/${encodeURIComponent(uid)}/push/${encodeURIComponent(t.id)}`, { method: 'DELETE', headers: H });
        res.tokensRemovidos++; break;
      }
    }
  };
  // Até 10 usuários em paralelo.
  for (let i = 0; i < docs.length; i += 10) await Promise.all(docs.slice(i, i + 10).map(d => umUsuario(d).catch(() => {})));
  return res;
}
