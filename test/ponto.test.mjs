// node --test test/ — motor de cálculo e checagens de segurança estáticas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ler = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ctx = { module: { exports: {} } };
vm.runInNewContext(ler('docs/ponto.js'), ctx);
const P = ctx.module.exports;

test('previsão simples: 08:00 + 8h + 1h = 17:00', () => {
  const p = P.previsao({ jornada: '08:00', intervalo: '01:00', entrada: '08:00' }, 'S');
  assert.equal(P.fmt(p.saida), '17:00');
  assert.equal(p.avisos.length, 0);
});

test('previsão completa usa almoço real', () => {
  const p = P.previsao({ jornada: '08:00', intervalo: '01:00', entrada: '08:00', saiAlm: '12:00', volAlm: '12:40' }, 'C');
  assert.equal(P.fmt(p.saida), '16:40');
  assert.ok(p.avisos.some(a => a.includes('1h de intervalo')));
});

test('virada da meia-noite', () => {
  const p = P.previsao({ jornada: '08:00', intervalo: '01:00', entrada: '22:00' }, 'S');
  assert.equal(P.fmt(p.saida), '07:00');
  assert.ok(p.saida >= 1440);
  const f = P.fechamento({ entrada: '22:00', saida: '07:30', jornada: '08:00', intervalo: '01:00' });
  assert.equal(f.trabalhado, 510); assert.equal(f.saldo, 30);
});

test('fechamento e saldo negativo', () => {
  const f = P.fechamento({ entrada: '09:00', saiAlm: '12:00', volAlm: '13:30', saida: '17:00', jornada: '08:00', intervalo: '01:00' });
  assert.equal(f.trabalhado, 390); assert.equal(f.saldo, -90);
  assert.equal(P.dur(f.saldo), '-1h30');
  assert.equal(P.fechamento({ entrada: '09:00' }), null);
});

test('valores inválidos são ignorados', () => {
  assert.equal(P.toMin('25:00'), null);
  assert.equal(P.toMin('<img src=x>'), null);
  assert.equal(P.previsao({ jornada: '08:00', entrada: 'abc' }, 'S'), null);
});

test('HTML sem scripts inline (compatível com a CSP)', () => {
  for (const f of ['docs/index.html', 'docs/privacidade.html']) {
    const h = ler(f);
    assert.doesNotMatch(h, /<script(?![^>]*\bsrc=)[^>]*>/i, f + ' tem <script> inline');
    assert.doesNotMatch(h, /\son[a-z]+\s*=/i, f + ' tem handler inline (onclick=...)');
  }
});

test('app não usa innerHTML/eval', () => {
  const js = ler('docs/app.js');
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
});

test('regras: negar por padrão e isolar por usuário', () => {
  const r = ler('firestore.rules');
  assert.match(r, /match \/\{caminho=\*\*\} \{ allow read, write: if false; \}/);
  assert.match(r, /request\.auth\.uid == uid/);
  assert.doesNotMatch(r, /allow\s+(read|write)[^;]*:\s*if\s+true/);
  assert.doesNotMatch(r, /request\.time\s*<\s*timestamp/); // regra temporária do modo de teste
});

test('cabeçalhos de segurança na hospedagem', () => {
  const cfg = JSON.parse(ler('firebase.json'));
  const hs = cfg.hosting.headers.find(h => h.source === '**').headers;
  const k = Object.fromEntries(hs.map(h => [h.key, h.value]));
  assert.match(k['Content-Security-Policy'], /object-src 'none'/);
  assert.match(k['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(k['Content-Security-Policy'], /script-src[^;]*'unsafe-(inline|eval)'/);
  assert.ok(k['Strict-Transport-Security']);
  assert.equal(k['X-Content-Type-Options'], 'nosniff');
});

test('config.js não tem segredos', () => {
  const c = ler('docs/config.js');
  assert.doesNotMatch(c, /private_key|client_secret|BEGIN .*PRIVATE/);
});
