// Meu Ponto — app (PWA). Lançamentos só com login (e-mail verificado); dados no Firestore em usuarios/{uid},
// com cópia offline no aparelho separada por conta e apagada ao sair.
// Segurança: nada aqui é segredo. Quem protege os dados são as regras (firestore.rules) + App Check.
(function () {
  'use strict';
  const P = window.Ponto, CFG = window.APP_CONFIG || {};
  const VERSAO = '1.0.0';
  const $ = id => document.getElementById(id);
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const CAMPOS = ['entrada', 'saiAlm', 'volAlm', 'saida', 'jornada', 'intervalo'];
  const HORAS = ['entrada', 'saiAlm', 'volAlm', 'saida'];
  const chaveDia = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  // ---------- estado ----------
  let cfg = Object.assign({ jornada: '08:00', intervalo: '01:00', modo: 'S' }, ls.get('mp_cfg', {}));
  let dias = {};                               // { 'AAAA-MM-DD': {entrada,...,t} } da conta logada
  let diaAtual = chaveDia(new Date());
  let db = null, user = null, unsub = null;

  // ---------- Hoje ----------
  function carregarDia(k) {
    diaAtual = k; $('dia').value = k;
    const r = dias[k] || {};
    HORAS.forEach(c => { $(c).value = r[c] || ''; });
    $('jornada').value = r.jornada || cfg.jornada;
    $('intervalo').value = r.intervalo || cfg.intervalo;
    calc();
  }

  const liberado = () => !!(user && user.emailVerified);
  const chaveLocal = () => 'mp_dias_' + user.uid;

  function gravarDia() {
    if (!liberado()) return; // sem login não há lançamento
    const r = {};
    CAMPOS.forEach(c => { const v = $(c).value; if (P.HORA.test(v)) r[c] = v; });
    const vazio = !HORAS.some(c => r[c]);
    if (vazio) delete dias[diaAtual]; else { r.t = Date.now(); dias[diaAtual] = r; }
    ls.set(chaveLocal(), dias);
    cfg.jornada = $('jornada').value || cfg.jornada; cfg.intervalo = $('intervalo').value || cfg.intervalo;
    ls.set('mp_cfg', cfg);
    agendarEnvio(diaAtual); agendarPerfil();
  }

  function setModo(m) {
    cfg.modo = m; ls.set('mp_cfg', cfg);
    $('tabS').classList.toggle('on', m === 'S'); $('tabC').classList.toggle('on', m === 'C');
    $('completo').classList.toggle('hide', m !== 'C');
    calc(); agendarPerfil();
  }

  function syncChips() {
    [['chipsJ', 'jornada'], ['chipsI', 'intervalo']].forEach(([c, f]) =>
      document.querySelectorAll('#' + c + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === $(f).value)));
  }

  function calc() {
    syncChips();
    const d = {}; CAMPOS.forEach(c => d[c] = $(c).value);
    const p = P.previsao(d, cfg.modo), res = $('res'), det = $('det'), warn = $('warn');
    warn.classList.add('hide');
    if (!p) {
      res.classList.add('empty'); $('saidaPrev').textContent = '--:--';
      $('falta').textContent = 'Preencha a hora de entrada'; det.classList.add('hide');
    } else {
      res.classList.remove('empty');
      $('saidaPrev').textContent = P.fmt(p.saida) + (p.saida >= 1440 ? ' ⁺¹' : '');
      if (diaAtual === chaveDia(new Date())) {
        let n = nowMin(); if (n < p.entrada - 60) n += 1440;
        const rest = p.saida - n;
        $('falta').textContent = rest > 0 ? 'Faltam ' + P.dur(rest) : rest === 0 ? 'É agora! Pode bater o ponto 🎉' : 'Jornada cumprida há ' + P.dur(-rest) + ' 🎉';
      } else $('falta').textContent = 'Previsão para ' + dataBR(diaAtual);
      det.replaceChildren(...p.linhas.map(([a, b]) => { const r = el('div'); r.append(el('span', '', a), el('span', '', b)); return r; }));
      det.classList.remove('hide');
      if (p.avisos.length) { warn.replaceChildren(...p.avisos.map(a => el('div', '', a))); warn.classList.remove('hide'); }
    }
    const f = P.fechamento(d);
    $('fechHint').textContent = f
      ? 'Trabalhado: ' + P.dur(f.trabalhado) + ' · saldo do dia: ' + (f.saldo > 0 ? '+' : '') + P.dur(f.saldo)
      : 'Com a saída registrada, o dia entra no banco de horas.';
  }

  const dataBR = k => { const [a, m, d] = k.split('-'); return d + '/' + m + '/' + a; };
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  // ---------- Histórico ----------
  function diasDoMes(mes) { return Object.keys(dias).filter(k => k.startsWith(mes)).sort().reverse(); }

  function renderHist() {
    const mes = $('mes').value || chaveDia(new Date()).slice(0, 7);
    const ks = diasDoMes(mes);
    let nd = 0, trab = 0, saldo = 0;
    const itens = ks.map(k => {
      const r = dias[k], f = P.fechamento(r);
      if (f) { nd++; trab += f.trabalhado; saldo += f.saldo; }
      const li = el('li'), b = el('button');
      b.type = 'button';
      const dt = new Date(k + 'T12:00:00');
      b.append(el('span', 'd', SEM[dt.getDay()] + ' ' + k.slice(8) + '/' + k.slice(5, 7)),
        el('span', 'h', (r.entrada || '--:--') + ' → ' + (r.saida || '--:--')),
        el('span', 's ' + (f ? (f.saldo >= 0 ? 'pos' : 'neg') : ''), f ? (f.saldo > 0 ? '+' : '') + P.dur(f.saldo) : 'aberto'));
      b.onclick = () => { carregarDia(k); location.hash = '#hoje'; };
      li.append(b); return li;
    });
    $('lista').replaceChildren(...itens);
    $('vazio').classList.toggle('hide', ks.length > 0);
    $('tDias').textContent = nd; $('tTrab').textContent = P.dur(trab);
    const ts = $('tSaldo'); ts.textContent = (saldo > 0 ? '+' : '') + P.dur(saldo);
    ts.className = saldo >= 0 ? 'pos' : 'neg';
  }

  function baixar(nome, tipo, conteudo) {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // Evita injeção de fórmula ao abrir o CSV em planilhas.
  const csvCel = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };

  function exportarCSV() {
    const mes = $('mes').value || chaveDia(new Date()).slice(0, 7);
    const linhas = [['Data', 'Entrada', 'Saída almoço', 'Volta almoço', 'Saída', 'Jornada', 'Trabalhado', 'Saldo']];
    diasDoMes(mes).reverse().forEach(k => {
      const r = dias[k], f = P.fechamento(r);
      linhas.push([dataBR(k), r.entrada, r.saiAlm, r.volAlm, r.saida, r.jornada, f ? P.dur(f.trabalhado) : '', f ? P.dur(f.saldo) : '']);
    });
    baixar('meu-ponto-' + mes + '.csv', 'text/csv;charset=utf-8', '﻿' + linhas.map(l => l.map(csvCel).join(';')).join('\r\n'));
  }

  // ---------- Navegação ----------
  const VIEWS = { hoje: 'v-hoje', hist: 'v-hist', conta: 'v-conta' };
  function rota() {
    const ok = liberado();
    document.body.classList.toggle('gate', !ok);
    $('v-login').classList.toggle('hide', ok);
    if (!ok) { Object.values(VIEWS).forEach(id => $(id).classList.add('hide')); return; }
    const t = (location.hash || '#hoje').slice(1), tab = VIEWS[t] ? t : 'hoje';
    Object.entries(VIEWS).forEach(([k, id]) => $(id).classList.toggle('hide', k !== tab));
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    if (tab === 'hist') renderHist();
    Ads.preencher(document.getElementById(VIEWS[tab]));
    window.scrollTo(0, 0);
  }

  // ---------- Firebase: login e sincronização ----------
  const temFirebase = () => !!(window.firebase && CFG.firebase && CFG.firebase.apiKey && !String(CFG.firebase.apiKey).startsWith('COLE'));

  function setSync(s, txt) {
    const e = $('sync'); e.className = 'sync' + (s === 'on' ? ' on' : s === 'err' ? ' err' : '');
    e.lastElementChild.textContent = txt;
  }
  function msg(id, txt, tipo) { const m = $(id); m.textContent = txt || ''; m.className = 'msg' + (tipo ? ' ' + tipo : ''); }

  const ERROS = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Tente entrar.',
    'auth/weak-password': 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.',
    'auth/password-does-not-meet-requirements': 'A senha não atende aos requisitos (mínimo 8 caracteres, com letras e números).',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
    'auth/network-request-failed': 'Sem conexão. Tente de novo.',
    'auth/popup-closed-by-user': 'Login cancelado.',
    'auth/requires-recent-login': 'Por segurança, saia e entre de novo antes de apagar a conta.',
    'permission-denied': 'Acesso negado pelo servidor.'
  };
  const erroTxt = e => ERROS[e && e.code] || 'Algo deu errado. Tente de novo.';

  const pend = new Set(); let tEnvio = null, tPerfil = null;
  function agendarEnvio(k) { if (!db || !user) return; pend.add(k); clearTimeout(tEnvio); tEnvio = setTimeout(enviar, 800); }
  function agendarPerfil() { if (!db || !user) return; clearTimeout(tPerfil); tPerfil = setTimeout(enviarPerfil, 1500); }
  const refDias = () => db.collection('usuarios').doc(user.uid).collection('dias');

  async function enviar() {
    const ks = [...pend]; pend.clear();
    try {
      const b = db.batch();
      ks.forEach(k => {
        if (!DIA_RE.test(k)) return;
        const r = dias[k], ref = refDias().doc(k);
        if (!r) { b.delete(ref); return; }
        const o = {}; CAMPOS.forEach(c => { if (r[c]) o[c] = r[c]; });
        o.atualizado = firebase.firestore.FieldValue.serverTimestamp();
        b.set(ref, o);
      });
      await b.commit(); setSync('on', 'sincronizado');
    } catch (e) { ks.forEach(k => pend.add(k)); setSync('err', 'erro ao salvar'); }
  }
  async function enviarPerfil() {
    try {
      await db.collection('usuarios').doc(user.uid).set({
        jornada: cfg.jornada, intervalo: cfg.intervalo, modo: cfg.modo,
        atualizado: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {}
  }

  // Mostra a tela certa conforme o estado do login.
  function atualizarAcesso() {
    $('carregando').classList.add('hide');
    $('cLogin').classList.toggle('hide', !!user);
    $('cVerif').classList.toggle('hide', !user || user.emailVerified);
    if (user) { $('verifEmail').textContent = user.email || ''; $('quem').textContent = user.email || ''; }
    if (!liberado()) { dias = {}; rota(); return; }
    // Cópia offline desta conta + horários antigos feitos sem login neste aparelho (migram uma vez).
    dias = ls.get(chaveLocal(), {});
    const antigos = ls.get('mp_dias', null);
    if (antigos && typeof antigos === 'object') {
      Object.keys(antigos).forEach(k => { if (DIA_RE.test(k) && !dias[k]) dias[k] = antigos[k]; });
      ls.set('mp_dias', null); ls.set(chaveLocal(), dias);
    }
    carregarDia(chaveDia(new Date()));
    rota();
    Ads.pedirConsentimento(false);
    iniciarSync();
  }

  async function iniciarSync() {
    if (!liberado()) return;
    setSync('', 'sincronizando…');
    try {
      const perf = await db.collection('usuarios').doc(user.uid).get();
      if (perf.exists) {
        const p = perf.data();
        ['jornada', 'intervalo'].forEach(c => { if (P.HORA.test(p[c] || '')) cfg[c] = p[c]; });
        if (p.modo === 'S' || p.modo === 'C') cfg.modo = p.modo;
        ls.set('mp_cfg', cfg);
      } else enviarPerfil();
    } catch (e) {}
    let primeira = true;
    if (unsub) unsub();
    unsub = refDias().orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(400)
      .onSnapshot(snap => {
        let mudou = false; const remotos = new Map();
        snap.docs.forEach(doc => {
          if (doc.metadata.hasPendingWrites || !DIA_RE.test(doc.id)) return;
          const d = doc.data(), t = d.atualizado ? d.atualizado.toMillis() : 0, loc = dias[doc.id];
          remotos.set(doc.id, t);
          if (!loc || (loc.t || 0) < t) {
            const r = { t }; CAMPOS.forEach(c => { if (P.HORA.test(d[c] || '')) r[c] = d[c]; });
            dias[doc.id] = r; mudou = true;
          }
        });
        snap.docChanges().forEach(ch => { if (ch.type === 'removed' && !primeira && dias[ch.doc.id]) { delete dias[ch.doc.id]; mudou = true; } });
        if (primeira) { // dias criados sem conta (ou offline) sobem uma vez
          primeira = false;
          Object.keys(dias).forEach(k => { if (!remotos.has(k) || (dias[k].t || 0) > remotos.get(k)) agendarEnvio(k); });
        }
        if (mudou) { ls.set(chaveLocal(), dias); carregarDia(diaAtual); if (!$('v-hist').classList.contains('hide')) renderHist(); }
        setSync('on', 'sincronizado');
      }, () => setSync('err', 'sem acesso ao servidor'));
  }

  async function initFirebase() {
    if (!temFirebase()) {
      $('carregando').classList.add('hide'); $('cLogin').classList.remove('hide');
      $('semFirebase').classList.remove('hide'); $('fLogin').classList.add('hide'); $('bGoogle').classList.add('hide'); return;
    }
    firebase.initializeApp(CFG.firebase);
    // App Check: só o app publicado (com reCAPTCHA) consegue falar com o Firestore/Auth quando a verificação estiver "Aplicada".
    if (CFG.appCheckSiteKey) { try { firebase.appCheck().activate(CFG.appCheckSiteKey, true); } catch (e) {} }
    const auth = firebase.auth(); auth.languageCode = 'pt';
    db = firebase.firestore();
    auth.onAuthStateChanged(u => {
      if (unsub) { unsub(); unsub = null; }
      user = u; atualizarAcesso();
    });
    // Voltou para o app depois de clicar no link de verificação
    async function conferirVerificacao(avisar) {
      if (!user || user.emailVerified) return;
      try {
        await user.reload();
        if (auth.currentUser.emailVerified) { await auth.currentUser.getIdToken(true); user = auth.currentUser; atualizarAcesso(); }
        else if (avisar) msg('msgVerif', 'Ainda não confirmado. Abra o link do e-mail e tente de novo.', 'err');
      } catch (e) { if (avisar) msg('msgVerif', erroTxt(e), 'err'); }
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') conferirVerificacao(false); });
    $('bJaConfirmei').onclick = () => conferirVerificacao(true);

    $('fLogin').addEventListener('submit', async ev => {
      ev.preventDefault(); msg('msgLogin', 'Entrando…');
      try { await auth.signInWithEmailAndPassword($('email').value.trim(), $('senha').value); msg('msgLogin', ''); }
      catch (e) { msg('msgLogin', erroTxt(e), 'err'); }
    });
    $('bCriar').onclick = async () => {
      const em = $('email').value.trim(), pw = $('senha').value;
      if (!$('email').checkValidity() || pw.length < 8) { msg('msgLogin', 'Informe um e-mail válido e uma senha com pelo menos 8 caracteres.', 'err'); return; }
      msg('msgLogin', 'Criando conta…');
      try { const c = await auth.createUserWithEmailAndPassword(em, pw); await c.user.sendEmailVerification(); msg('msgLogin', ''); }
      catch (e) { msg('msgLogin', erroTxt(e), 'err'); }
    };
    $('bEsqueci').onclick = async () => {
      const em = $('email').value.trim();
      if (!$('email').checkValidity() || !em) { msg('msgLogin', 'Digite seu e-mail acima primeiro.', 'err'); return; }
      try { await auth.sendPasswordResetEmail(em); } catch (e) {}
      // Mesma resposta sempre: não revela se o e-mail tem conta.
      msg('msgLogin', 'Se houver uma conta com este e-mail, você vai receber o link para trocar a senha.', 'ok');
    };
    $('bGoogle').onclick = async () => {
      try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
      catch (e) { msg('msgLogin', erroTxt(e), 'err'); }
    };
    // Sair apaga a cópia local desta conta (aparelho compartilhado não fica com seus horários).
    const sair = async () => {
      if (unsub) { unsub(); unsub = null; }
      if (pend.size) { clearTimeout(tEnvio); await enviar(); }
      if (user) ls.set(chaveLocal(), null);
      dias = {}; await auth.signOut(); location.hash = '#hoje';
    };
    $('bSair').onclick = sair;
    $('bSairVerif').onclick = sair;
    $('bReenviar').onclick = async () => {
      try { await user.sendEmailVerification(); msg('msgVerif', 'Link reenviado. Confira também o spam.', 'ok'); }
      catch (e) { msg('msgVerif', erroTxt(e), 'err'); }
    };
  }

  // ---------- LGPD: exportar e apagar ----------
  function exportarTudo() {
    baixar('meu-ponto-dados.json', 'application/json', JSON.stringify({ exportado: new Date().toISOString(), conta: user ? user.email : null, ajustes: cfg, dias }, null, 2));
  }
  async function apagarTudo() {
    if (!liberado() || !db) return;
    if (!confirm('Apagar TODOS os seus horários e excluir a sua conta? Não dá para desfazer.')) return;
    const local = chaveLocal();
    try {
      {
        msg('msgConta', 'Apagando…');
        if (unsub) { unsub(); unsub = null; }
        for (;;) {
          const s = await refDias().limit(400).get(); if (s.empty) break;
          const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit();
        }
        await db.collection('usuarios').doc(user.uid).delete();
        await user.delete();
      }
      ['mp_dias', local, 'mp_cfg', 'mp_consent'].forEach(k => ls.set(k, null));
      location.reload();
    } catch (e) { msg('msgConta', erroTxt(e), 'err'); }
  }

  // ---------- Anúncios (Google AdSense) ----------
  const Ads = (() => {
    const A = CFG.adsense || {};
    const ativo = !!(A.client && /^ca-pub-\d{10,20}$/.test(A.client));
    let carregado = false;
    function carregar() {
      if (!ativo || carregado || !navigator.onLine) return;
      const c = ls.get('mp_consent', null); if (!c) return;
      carregado = true;
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.requestNonPersonalizedAds = c === 'sim' ? 0 : 1;
      const s = document.createElement('script');
      s.async = true; s.crossOrigin = 'anonymous';
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(A.client);
      document.head.append(s);
      preencher(document.querySelector('.view:not(.hide)'));
    }
    // Só preenche o espaço quando a aba está visível (o AdSense precisa da largura real).
    function preencher(view) {
      if (!carregado || !view) return;
      view.querySelectorAll('.ad:empty').forEach(box => {
        const slot = (A.slots || {})[box.dataset.slot]; if (!slot) return;
        const ins = document.createElement('ins');
        ins.className = 'adsbygoogle'; ins.style.display = 'block';
        ins.dataset.adClient = A.client; ins.dataset.adSlot = String(slot);
        ins.dataset.adFormat = 'auto'; ins.dataset.fullWidthResponsive = 'true';
        box.append(ins); box.classList.add('on');
        try { window.adsbygoogle.push({}); } catch (e) {}
      });
    }
    function pedirConsentimento(forcar) {
      if (!ativo) return;
      if (!forcar && ls.get('mp_consent', null)) { carregar(); return; }
      $('consent').classList.remove('hide');
    }
    function escolher(v) {
      const antes = ls.get('mp_consent', null);
      ls.set('mp_consent', v); $('consent').classList.add('hide');
      if (antes && antes !== v) location.reload(); else carregar();
    }
    return { ativo, carregar, preencher, pedirConsentimento, escolher };
  })();

  // ---------- eventos ----------
  $('tabS').onclick = () => setModo('S');
  $('tabC').onclick = () => setModo('C');
  CAMPOS.forEach(id => $(id).addEventListener('input', () => { calc(); gravarDia(); }));
  document.querySelectorAll('.now[data-t]').forEach(b => b.onclick = () => { $(b.dataset.t).value = P.fmt(nowMin()); calc(); gravarDia(); });
  document.querySelectorAll('#chipsJ button').forEach(b => b.onclick = () => { $('jornada').value = b.dataset.v; calc(); gravarDia(); });
  document.querySelectorAll('#chipsI button').forEach(b => b.onclick = () => { $('intervalo').value = b.dataset.v; calc(); gravarDia(); });
  $('dia').addEventListener('change', () => { if (DIA_RE.test($('dia').value)) carregarDia($('dia').value); });
  $('hojeBtn').onclick = () => carregarDia(chaveDia(new Date()));
  $('limpar').onclick = () => { HORAS.forEach(id => $(id).value = ''); calc(); gravarDia(); };
  $('mes').addEventListener('change', renderHist);
  $('csv').onclick = exportarCSV;
  $('bExport').onclick = exportarTudo;
  $('bApagar').onclick = apagarTudo;
  $('bConsent').onclick = () => Ads.ativo ? Ads.pedirConsentimento(true) : msg('msgConta', 'Anúncios ainda não configurados.', '');
  $('cSim').onclick = () => Ads.escolher('sim');
  $('cNao').onclick = () => Ads.escolher('nao');
  window.addEventListener('hashchange', rota);
  window.addEventListener('online', () => Ads.carregar());

  // ---------- início ----------
  $('versao').textContent = 'Meu Ponto ' + VERSAO;
  $('mes').value = diaAtual.slice(0, 7);
  setModo(cfg.modo === 'C' ? 'C' : 'S');
  rota();          // começa na tela de entrada até o login ser confirmado
  initFirebase();
  setInterval(() => { if (!$('v-hoje').classList.contains('hide')) calc(); }, 30000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
