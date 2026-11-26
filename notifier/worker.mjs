// Cloudflare Worker: roda o notificador a cada minuto (Cron Trigger).
import { run } from './notifier.mjs';

const igual = (a, b) => { // comparação em tempo constante
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
};

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env).then(r => console.log(JSON.stringify(r)), e => console.error(e.message)));
  },
  // GET /run com o cabeçalho x-run-key: <RUN_KEY> roda na hora (para testar). Sem a chave: nada é exposto.
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/run' && env.RUN_KEY && env.RUN_KEY.length >= 16 && igual(req.headers.get('x-run-key') || '', env.RUN_KEY)) {
      try { return Response.json(await run(env)); } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
    }
    return new Response('ok', { headers: { 'content-type': 'text/plain' } });
  },
};
