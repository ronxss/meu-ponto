// Meu Ponto — app (PWA). Lançamentos só com login (e-mail verificado); dados no Firestore em usuarios/{uid},
// com cópia offline no aparelho separada por conta e apagada ao sair.
// Segurança: nada aqui é segredo. Quem protege os dados são as regras (firestore.rules) + App Check.
(function () {
  'use strict';
  const P = window.Ponto, CFG = window.APP_CONFIG || {};
  const VERSAO = '2.0.0';
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
  const CFG_PADRAO = { jornada: '08:00', intervalo: '01:00', ok: false };
  let cfg = Object.assign({}, CFG_PADRAO);     // jornada da conta logada (ok = já configurou)
  let dias = {};                               // { 'AAAA-MM-DD': {entrada,saiAlm,volAlm,saida,jornada,intervalo,t} }
  let db = null, user = null, unsub = null;

  const liberado = () => !!(user && user.emailVerified);
  const chaveLocal = () => 'mp_dias_' + user.uid;
  const chaveCfg = () => 'mp_cfg_' + user.uid;
  const dataBR = k => { const [a, m, d] = k.split('-'); return d + '/' + m + '/' + a; };
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  // ---------- Ponto: um botão, quatro registros ----------
  const ETAPAS = [
    { c: 'entrada', nome: 'Entrada', acao: 'Registrar entrada', g: 'a' },
    { c: 'saiAlm', nome: 'Saída para o almoço', acao: 'Registrar saída para o almoço', g: 'a' },
    { c: 'volAlm', nome: 'Retorno do almoço', acao: 'Registrar retorno do almoço', g: 'o' },
    { c: 'saida', nome: 'Saída', acao: 'Registrar saída', g: 'a' }
  ];
  // Sem intervalo (jornada sem almoço ou "hoje não vou almoçar"): pula as etapas do almoço.
  const semAlmoco = r => r.intervalo === '00:00' && !r.saiAlm;
  const etapasDo = r => ETAPAS.filter(e => !(semAlmoco(r) && (e.c === 'saiAlm' || e.c === 'volAlm')));
  const proxima = r => etapasDo(r).find(e => !r[e.c]) || null;

  // Dia de trabalho em andamento: hoje, ou ontem se o turno virou a meia-noite e ainda não saiu.
  function diaAtivo() {
    const h = new Date(), kH = chaveDia(h), kO = chaveDia(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 1));
    const o = dias[kO];
    if (!(dias[kH] && dias[kH].entrada) && o && o.entrada && !o.saida && (1440 + nowMin()) - P.toMin(o.entrada) < 18 * 60) return kO;
    return kH;
  }

  function salvarDia(k, r) {
    if (!liberado() || !DIA_RE.test(k)) return;
    const limpo = {};
    CAMPOS.forEach(c => { if (P.HORA.test(r[c] || '')) limpo[c] = r[c]; });
    if (!HORAS.some(c => limpo[c])) delete dias[k]; else { limpo.t = Date.now(); dias[k] = limpo; }
    ls.set(chaveLocal(), dias);
    agendarEnvio(k); Notif.agendar();
  }

  let travado = false;
  function bater() {
    if (!liberado() || travado) return;
    const k = diaAtivo(), r = Object.assign({}, dias[k] || {});
    if (!r.entrada) { r.jornada = cfg.jornada; r.intervalo = cfg.intervalo; }
    const e = proxima(r); if (!e) return;
    const h = P.fmt(nowMin());
    r[e.c] = h; salvarDia(k, r);
    travado = true; $('bBater').disabled = true;          // evita toque duplo
    setTimeout(() => { travado = false; renderPonto(); }, 2500);
    msg('msgPonto', '✓ ' + e.nome + ' registrad' + e.g + ' às ' + h, 'ok');
    if (navigator.vibrate) try { navigator.vibrate(40); } catch (x) {}
    renderPonto();
  }

  function semAlmocoHoje() {
    const k = diaAtivo(), r = Object.assign({}, dias[k] || {});
    if (!r.entrada || r.saiAlm) return;
    if (!confirm('Registrar o dia de hoje sem intervalo de almoço? O próximo registro será a saída.')) return;
    r.intervalo = '00:00'; salvarDia(k, r); renderPonto();
  }

  function desfazer() {
    const k = diaAtivo(), r = Object.assign({}, dias[k] || {});
    const feitas = ETAPAS.filter(e => r[e.c]); if (!feitas.length) return;
    const u = feitas[feitas.length - 1];
    if (!confirm('Desfazer "' + u.nome + ' às ' + r[u.c] + '"?')) return;
    delete r[u.c];
    salvarDia(k, r); msg('msgPonto', 'Registro desfeito.', ''); renderPonto();
  }

  function renderPonto() {
    const agora = new Date();
    $('pData').textContent = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('pHora').textContent = P.fmt(nowMin());
    if (!liberado()) return;
    const k = diaAtivo(), r = dias[k] || { jornada: cfg.jornada, intervalo: cfg.intervalo };
    const e = proxima(r), b = $('bBater');
    b.classList.toggle('fim', !e);
    b.disabled = !e || travado;
    $('bBaterTit').textContent = e ? e.acao : 'Jornada concluída ✓';
    $('bBaterSub').textContent = e ? 'Toque para bater o ponto agora' : 'Bom descanso! Até amanhã.';
    $('bSemAlm').classList.toggle('hide', !(e && e.c === 'saiAlm'));
    $('bDesfazer').classList.toggle('hide', !ETAPAS.some(x => r[x.c]));

    // Linha do dia: registrados e previstos
    const p = r.entrada ? P.previsao(r, 'C') : null;
    const prev = {};
    if (p) {
      if (r.saiAlm && !r.volAlm) prev.volAlm = P.fmt(P.toMin(r.saiAlm) + (P.toMin(r.intervalo) ?? 0));
      if (!r.saida) prev.saida = P.fmt(p.saida);
    }
    const itens = ETAPAS.map(x => {
      const li = el('li'), pulado = semAlmoco(r) && (x.c === 'saiAlm' || x.c === 'volAlm');
      li.className = r[x.c] ? 'ok' : pulado ? 'pulado' : (e && e.c === x.c ? 'prox' : '');
      li.append(el('span', 'pt'), el('span', 'nm', x.nome),
        r[x.c] ? el('span', 'hr', r[x.c]) : el('span', 'hr prev', pulado ? 'sem almoço' : prev[x.c] ? 'prev. ' + prev[x.c] : '--:--'));
      return li;
    });
    $('linha').replaceChildren(...itens);

    const res = $('resumo'); res.replaceChildren();
    const f = P.fechamento(r);
    if (f) {
      res.append('Trabalhado ', el('b', '', P.dur(f.trabalhado)), ' · saldo ',
        el('b', f.saldo >= 0 ? 'pos' : 'neg', (f.saldo > 0 ? '+' : '') + P.dur(f.saldo)));
    } else if (p) {
      let n = nowMin(); if (k !== chaveDia(agora)) n += 1440;
      const rest = p.saida - n;
      res.append('Saída prevista às ', el('b', '', P.fmt(p.saida)), rest > 0 ? ' · faltam ' + P.dur(rest) : ' · jornada cumprida 🎉');
    } else {
      res.append('Jornada de ', el('b', '', P.dur(P.toMin(cfg.jornada))));
      if (cfg.intervalo === '00:00') res.append(' sem intervalo');
      else res.append(' + ', el('b', '', P.dur(P.toMin(cfg.intervalo))), ' de almoço');
    }
    const warn = $('warn');
    const av = p && r.volAlm ? p.avisos : [];
    warn.classList.toggle('hide', !av.length);
    warn.replaceChildren(...av.map(a => el('div', '', a)));
    Notif.dica();
  }

  // ---------- Jornada (configuração inicial e Ajustes) ----------
  function syncChips() {
    [['chipsJ', 'jornada'], ['chipsI', 'intervalo']].forEach(([c, f]) =>
      document.querySelectorAll('#' + c + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === $(f).value)));
    const J = P.toMin($('jornada').value), I = P.toMin($('intervalo').value);
    $('jResumo').textContent = J ? 'Ex.: entrando às 08:00, a saída prevista é ' + P.fmt(480 + J + (I || 0)) + '.' : '';
  }
  function mostrarJornada() { $('jornada').value = cfg.jornada; $('intervalo').value = cfg.intervalo; syncChips(); }

  async function salvarJornada() {
    const j = $('jornada').value, i = $('intervalo').value || '00:00';
    if (!P.HORA.test(j) || P.toMin(j) < 60) { msg('msgJornada', 'Informe a jornada (pelo menos 1 hora).', 'err'); return; }
    if (!P.HORA.test(i)) { msg('msgJornada', 'Informe o tempo de almoço.', 'err'); return; }
    const primeira = !cfg.ok;
    cfg = { jornada: j, intervalo: i, ok: true };
    ls.set(chaveCfg(), cfg);
    // Dia em andamento (ainda sem saída) passa a usar a jornada nova.
    const k = diaAtivo(), r = dias[k];
    if (r && r.entrada && !r.saida) salvarDia(k, Object.assign({}, r, { jornada: j, intervalo: r.saiAlm || r.intervalo !== '00:00' ? i : r.intervalo }));
    enviarPerfil();
    Notif.agendar();
    if (primeira) { location.hash = '#ponto'; rota(); msg('msgPonto', 'Tudo pronto! Toque no botão para bater o ponto.', 'ok'); }
    else msg('msgJornada', 'Jornada salva ✓', 'ok');
  }

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
      b.onclick = () => abrirEditor(k);
      li.append(b); return li;
    });
    $('lista').replaceChildren(...itens);
    $('vazio').classList.toggle('hide', ks.length > 0);
    $('tDias').textContent = nd; $('tTrab').textContent = P.dur(trab);
    const ts = $('tSaldo'); ts.textContent = (saldo > 0 ? '+' : '') + P.dur(saldo);
    ts.className = saldo >= 0 ? 'pos' : 'neg';
  }

  const EDIT = { entrada: 'eEntrada', saiAlm: 'eSaiAlm', volAlm: 'eVolAlm', saida: 'eSaida' };
  let editando = null;
  function abrirEditor(k) {
    editando = k || null;
    const dia = k || chaveDia(new Date()), r = dias[dia] || {};
    $('eTit').textContent = k ? 'Corrigir ' + dataBR(k) : 'Lançar ou corrigir um dia';
    $('eDia').value = dia; $('eDia').disabled = !!k;
    Object.entries(EDIT).forEach(([c, id]) => { $(id).value = r[c] || ''; });
    $('eExcluir').classList.toggle('hide', !k);
    msg('msgEditar', '');
    $('cEditar').classList.remove('hide'); $('bNovoDia').classList.add('hide');
    $('cEditar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function fecharEditor() { editando = null; $('cEditar').classList.add('hide'); $('bNovoDia').classList.remove('hide'); }
  $('eDia').addEventListener('change', () => {
    const r = dias[$('eDia').value] || {};
    Object.entries(EDIT).forEach(([c, id]) => { $(id).value = r[c] || ''; });
  });
  function salvarEditor() {
    const k = editando || $('eDia').value;
    if (!DIA_RE.test(k)) { msg('msgEditar', 'Escolha o dia.', 'err'); return; }
    if (k > chaveDia(new Date())) { msg('msgEditar', 'Não dá para lançar um dia futuro.', 'err'); return; }
    const v = {}; Object.entries(EDIT).forEach(([c, id]) => { v[c] = $(id).value; });
    if (!v.entrada && (v.saiAlm || v.volAlm || v.saida)) { msg('msgEditar', 'Informe a entrada.', 'err'); return; }
    if (!!v.saiAlm !== !!v.volAlm && v.saida) { msg('msgEditar', 'Preencha a saída e o retorno do almoço (ou deixe os dois vazios).', 'err'); return; }
    const base = dias[k] || { jornada: cfg.jornada, intervalo: cfg.intervalo };
    const r = Object.assign({}, base, v);
    HORAS.forEach(c => { if (!r[c]) delete r[c]; });
    if (r.saida && !r.saiAlm) r.intervalo = '00:00'; // dia fechado sem registros de almoço
    salvarDia(k, r); fecharEditor(); renderHist(); renderPonto();
  }
  function excluirDia() {
    if (!editando || !confirm('Excluir todos os registros de ' + dataBR(editando) + '?')) return;
    salvarDia(editando, {}); fecharEditor(); renderHist(); renderPonto();
  }

  function baixar(nome, tipo, conteudo) {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // Evita injeção de fórmula ao abrir o CSV em planilhas.
  const csvCel = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };

  function exportarCSV() {
    const mes = $('mes').value || chaveDia(new Date()).slice(0, 7);
    const linhas = [['Data', 'Entrada', 'Saída almoço', 'Retorno almoço', 'Saída', 'Jornada', 'Trabalhado', 'Saldo']];
    diasDoMes(mes).reverse().forEach(k => {
      const r = dias[k], f = P.fechamento(r);
      linhas.push([dataBR(k), r.entrada, r.saiAlm, r.volAlm, r.saida, r.jornada, f ? P.dur(f.trabalhado) : '', f ? P.dur(f.saldo) : '']);
    });
    baixar('meu-ponto-' + mes + '.csv', 'text/csv;charset=utf-8', '﻿' + linhas.map(l => l.map(csvCel).join(';')).join('\r\n'));
  }

  // ---------- Navegação ----------
  const VIEWS = { ponto: 'v-ponto', hist: 'v-hist', ajustes: 'v-ajustes' };
  const ALIAS = { hoje: 'ponto', conta: 'ajustes' };
  function rota() {
    const ok = liberado();
    const todas = ['v-login', 'v-config', ...Object.values(VIEWS)];
    const mostrar = id => todas.forEach(v => $(v).classList.toggle('hide', v !== id));
    if (!ok) { document.body.classList.add('gate'); mostrar('v-login'); return; }
    if (!cfg.ok) { // primeira vez: configura a jornada antes de tudo
      document.body.classList.add('gate'); $('slotConfig').append($('cJornada'));
      $('jSalvar').textContent = 'Salvar e começar'; mostrarJornada(); mostrar('v-config'); return;
    }
    document.body.classList.remove('gate');
    $('slotAjustes').prepend($('cJornada')); $('jSalvar').textContent = 'Salvar';
    let t = (location.hash || '#ponto').slice(1); t = ALIAS[t] || t;
    const tab = VIEWS[t] ? t : 'ponto';
    mostrar(VIEWS[tab]);
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    if (tab === 'ponto') renderPonto();
    if (tab === 'hist') { fecharEditor(); renderHist(); }
    if (tab === 'ajustes') { mostrarJornada(); msg('msgJornada', ''); Notif.render(); }
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

  const pend = new Set(); let tEnvio = null;
  function agendarEnvio(k) { if (!db || !user) return; pend.add(k); clearTimeout(tEnvio); tEnvio = setTimeout(enviar, 500); }
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
    if (!db || !liberado()) return;
    try {
      await db.collection('usuarios').doc(user.uid).set({
        jornada: cfg.jornada, intervalo: cfg.intervalo,
        atualizado: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {}
  }
  // Jornada salva na conta (vale em qualquer aparelho). Sem internet, usa a cópia local.
  async function carregarPerfil() {
    try {
      const perf = await db.collection('usuarios').doc(user.uid).get();
      if (perf.exists) {
        const p = perf.data();
        if (P.HORA.test(p.jornada || '') && P.HORA.test(p.intervalo || '')) {
          cfg = { jornada: p.jornada, intervalo: p.intervalo, ok: true }; ls.set(chaveCfg(), cfg);
        }
      }
    } catch (e) {}
  }

  // Mostra a tela certa conforme o estado do login.
  async function atualizarAcesso() {
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
    cfg = Object.assign({}, CFG_PADRAO, ls.get(chaveCfg(), {}));
    if (!cfg.ok) { $('carregando').classList.remove('hide'); await carregarPerfil(); $('carregando').classList.add('hide'); }
    else carregarPerfil().then(() => { if (!$('v-ponto').classList.contains('hide')) renderPonto(); });
    ls.set('mp_cfg', null); // ajuste antigo, de antes das contas
    rota();
    Ads.pedirConsentimento(false);
    iniciarSync();
    Notif.iniciar();
  }

  async function iniciarSync() {
    if (!liberado()) return;
    setSync('', 'sincronizando…');
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
        if (mudou) {
          ls.set(chaveLocal(), dias); renderPonto(); Notif.agendar();
          if (!$('v-hist').classList.contains('hide') && $('cEditar').classList.contains('hide')) renderHist();
        }
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
      await Notif.desativar(true); // este aparelho para de receber lembretes desta conta
      if (user) { ls.set(chaveLocal(), null); ls.set(chaveCfg(), null); }
      dias = {}; cfg = Object.assign({}, CFG_PADRAO); await auth.signOut(); location.hash = '#ponto';
    };
    $('bSair').onclick = sair;
    $('bSairVerif').onclick = sair;
    $('bReenviar').onclick = async () => {
      try { await user.sendEmailVerification(); msg('msgVerif', 'Link reenviado. Confira também o spam.', 'ok'); }
      catch (e) { msg('msgVerif', erroTxt(e), 'err'); }
    };
  }

  // ---------- Lembretes por notificação (Firebase Cloud Messaging) ----------
  // O app calcula os horários (2 min antes da volta do almoço e da saída) e grava em avisos/{uid}.
  // O notificador (notifier/, Cloudflare Workers) roda a cada minuto e envia para os aparelhos do usuário.
  const Notif = (() => {
    const LST = 'mp_push_tok';
    let prefs = { alm: true, sai: true }, ultimo = '', tAg = null, swr = null, fgOn = false;
    const suportado = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    const vapid = () => CFG.vapidKey && !String(CFG.vapidKey).startsWith('COLE') ? CFG.vapidKey : '';
    const swReady = () => swr || (swr = navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready));
    const refAv = () => db.collection('usuarios').doc(user.uid);
    const ligado = () => !!ls.get(LST, null) && suportado() && Notification.permission === 'granted';

    function eventos() {
      return P.agendaAvisos({ dias, modo: 'C', agora: new Date(), alm: prefs.alm, sai: prefs.sai });
    }
    async function escrever(extra) {
      if (!liberado() || !db) return;
      const ev = eventos().concat(extra || []).sort((a, b) => a.ts - b.ts).slice(0, 4);
      const doc = { eventos: ev, prox: ev.length ? ev[0].ts : null, alm: prefs.alm, sai: prefs.sai };
      const j = JSON.stringify(doc);
      if (!extra && j === ultimo) return;
      await db.collection('avisos').doc(user.uid).set(Object.assign(doc, { atualizado: firebase.firestore.FieldValue.serverTimestamp() }));
      ultimo = j;
    }
    function agendar() { if (!liberado()) return; clearTimeout(tAg); tAg = setTimeout(() => escrever().catch(() => {}), 1000); dica(); }

    async function salvarToken(tok) {
      const ant = ls.get(LST, null);
      if (ant && ant !== tok) refAv().collection('push').doc(ant).delete().catch(() => {});
      await refAv().collection('push').doc(tok).set({ token: tok, ua: navigator.userAgent.slice(0, 120), at: firebase.firestore.FieldValue.serverTimestamp() });
      ls.set(LST, tok);
    }
    function ouvirPrimeiroPlano() {
      if (fgOn) return; fgOn = true;
      try {
        firebase.messaging().onMessage(async m => {
          const n = m.notification || {}, reg = await swReady();
          reg.showNotification(n.title || 'Meu Ponto', { body: n.body || '', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'mp-' + ((m.data && m.data.tipo) || 'x') });
        });
      } catch (e) {}
    }
    async function ativar() {
      msg('msgNotif', 'Ativando…');
      try {
        if (!vapid()) throw new Error('Os lembretes ainda não foram configurados neste servidor (falta a chave VAPID).');
        if (!suportado() || !firebase.messaging || !(await firebase.messaging.isSupported()))
          throw new Error('Este navegador não recebe notificações. No iPhone, adicione o app à Tela de Início e abra por lá (iOS 16.4+).');
        const p = await Notification.requestPermission();
        if (p !== 'granted') throw new Error('Permissão negada. Libere as notificações deste site nas configurações do navegador.');
        const reg = await swReady();
        const tok = await firebase.messaging().getToken({ vapidKey: vapid(), serviceWorkerRegistration: reg });
        if (!tok) throw new Error('Não foi possível registrar este aparelho.');
        await salvarToken(tok); ouvirPrimeiroPlano(); await escrever();
        msg('msgNotif', 'Lembretes ligados neste aparelho. Use "Enviar teste" para conferir.', 'ok');
      } catch (e) { msg('msgNotif', e.message || erroTxt(e), 'err'); }
      render();
    }
    async function desativar(silencioso) {
      const t = ls.get(LST, null); ls.set(LST, null);
      try { if (t && user) await refAv().collection('push').doc(t).delete(); } catch (e) {}
      try { if (firebase.messaging) await firebase.messaging().deleteToken(); } catch (e) {}
      if (!silencioso) { msg('msgNotif', 'Lembretes desligados neste aparelho.', ''); render(); }
    }
    async function testar() {
      try {
        const agora = Date.now();
        await escrever([{ ts: agora, tipo: 'teste', h: P.fmt(new Date().getHours() * 60 + new Date().getMinutes()) }]);
        msg('msgNotif', 'Teste enviado: chega em até 1 minuto nos aparelhos com lembrete ligado.', 'ok');
      } catch (e) { msg('msgNotif', 'Não deu para enviar o teste: ' + erroTxt(e), 'err'); }
    }
    function render() {
      const on = ligado();
      let est;
      if (!vapid()) est = 'Lembretes ainda não configurados neste servidor.';
      else if (!suportado()) est = 'Este navegador não suporta notificações. No iPhone, instale o app na Tela de Início.';
      else if (Notification.permission === 'denied') est = 'Notificações bloqueadas para este site. Libere nas configurações do navegador.';
      else est = on ? '✅ Ligado neste aparelho.' : 'Desligado neste aparelho.';
      $('nEstado').textContent = est;
      $('nAtivar').classList.toggle('hide', on);
      $('nTeste').classList.toggle('hide', !on);
      $('nDesativar').classList.toggle('hide', !on);
      $('nAlm').checked = prefs.alm; $('nSai').checked = prefs.sai;
      dica();
    }
    function dica() {
      const h = $('avisoHint');
      if (!liberado()) { h.textContent = ''; return; }
      if (!ligado()) { h.textContent = vapid() ? '🔔 Ative os lembretes em Ajustes para ser avisado 2 min antes.' : ''; return; }
      const ev = eventos();
      h.textContent = ev.length
        ? '🔔 ' + ev.map(e => P.fmt(new Date(e.ts).getHours() * 60 + new Date(e.ts).getMinutes()) + (e.tipo === 'alm' ? ' (volta do almoço)' : ' (saída)')).join(' · ')
        : '🔔 Lembretes ligados. Nenhum aviso pendente agora.';
    }
    async function iniciar() {
      try {
        const d = await db.collection('avisos').doc(user.uid).get();
        if (d.exists) { const x = d.data(); prefs.alm = x.alm !== false; prefs.sai = x.sai !== false; }
      } catch (e) {}
      render(); agendar();
      // Renova o token (o navegador pode trocá-lo) e volta a ouvir em primeiro plano.
      if (ligado() && vapid() && firebase.messaging) {
        try {
          if (await firebase.messaging.isSupported()) {
            const tok = await firebase.messaging().getToken({ vapidKey: vapid(), serviceWorkerRegistration: await swReady() });
            if (tok) await salvarToken(tok); ouvirPrimeiroPlano();
          }
        } catch (e) {}
      }
    }
    function pref(k, v) { prefs[k] = v; agendar(); }
    return { ativar, desativar, testar, render, dica, iniciar, agendar, pref, escrever };
  })();

  // ---------- LGPD: exportar e apagar ----------
  function exportarTudo() {
    baixar('meu-ponto-dados.json', 'application/json', JSON.stringify({ exportado: new Date().toISOString(), conta: user ? user.email : null, ajustes: cfg, dias }, null, 2));
  }
  async function apagarTudo() {
    if (!liberado() || !db) return;
    if (!confirm('Apagar TODOS os seus horários e excluir a sua conta? Não dá para desfazer.')) return;
    const local = chaveLocal(), localCfg = chaveCfg();
    try {
      {
        msg('msgConta', 'Apagando…');
        if (unsub) { unsub(); unsub = null; }
        for (;;) {
          const s = await refDias().limit(400).get(); if (s.empty) break;
          const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit();
        }
        await Notif.desativar(true);
        for (;;) {
          const s = await db.collection('usuarios').doc(user.uid).collection('push').limit(20).get(); if (s.empty) break;
          const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit();
        }
        await db.collection('avisos').doc(user.uid).delete();
        await db.collection('usuarios').doc(user.uid).delete();
        await user.delete();
      }
      ['mp_dias', local, localCfg, 'mp_cfg', 'mp_consent'].forEach(k => ls.set(k, null));
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
  $('bBater').onclick = bater;
  $('bSemAlm').onclick = semAlmocoHoje;
  $('bDesfazer').onclick = desfazer;
  ['jornada', 'intervalo'].forEach(id => $(id).addEventListener('input', syncChips));
  document.querySelectorAll('#chipsJ button').forEach(b => b.onclick = () => { $('jornada').value = b.dataset.v; syncChips(); });
  document.querySelectorAll('#chipsI button').forEach(b => b.onclick = () => { $('intervalo').value = b.dataset.v; syncChips(); });
  $('jSalvar').onclick = salvarJornada;
  $('bNovoDia').onclick = () => abrirEditor(null);
  $('eSalvar').onclick = salvarEditor;
  $('eCancelar').onclick = fecharEditor;
  $('eExcluir').onclick = excluirDia;
  $('mes').addEventListener('change', renderHist);
  $('csv').onclick = exportarCSV;
  $('bExport').onclick = exportarTudo;
  $('bApagar').onclick = apagarTudo;
  $('bConsent').onclick = () => Ads.ativo ? Ads.pedirConsentimento(true) : msg('msgConta', 'Anúncios ainda não configurados.', '');
  $('nAtivar').onclick = () => Notif.ativar();
  $('nDesativar').onclick = () => Notif.desativar(false);
  $('nTeste').onclick = () => Notif.testar();
  $('nAlm').onchange = e => Notif.pref('alm', e.target.checked);
  $('nSai').onchange = e => Notif.pref('sai', e.target.checked);
  $('cSim').onclick = () => Ads.escolher('sim');
  $('cNao').onclick = () => Ads.escolher('nao');
  window.addEventListener('hashchange', rota);
  window.addEventListener('online', () => Ads.carregar());

  // ---------- início ----------
  $('versao').textContent = 'Meu Ponto ' + VERSAO;
  $('mes').value = chaveDia(new Date()).slice(0, 7);
  rota();          // começa na tela de entrada até o login ser confirmado
  initFirebase();
  setInterval(() => { if (!$('v-ponto').classList.contains('hide')) renderPonto(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && liberado() && cfg.ok) renderPonto(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
