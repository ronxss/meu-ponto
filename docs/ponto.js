// Motor de cálculo do Meu Ponto (sem DOM): usado pelo app e pelos testes.
(function (root) {
  const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
  const toMin = v => { if (!v || !HORA.test(v)) return null; const [h, m] = v.split(':').map(Number); return h * 60 + m; };
  const fmt = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const dur = m => {
    const s = m < 0 ? '-' : ''; m = Math.abs(m); const h = Math.floor(m / 60), mm = m % 60;
    return s + (h ? h + 'h' + (mm ? String(mm).padStart(2, '0') : '') : mm + 'min');
  };
  // Ajusta horários que viram a meia-noite para ficarem sempre depois do anterior.
  const depois = (t, ref) => (t === null || ref === null) ? t : (t < ref ? t + 1440 : t);

  // Previsão de saída. d = {jornada, intervalo, entrada, saiAlm, volAlm}; modo 'S' (simples) ou 'C' (completo).
  function previsao(d, modo) {
    const J = toMin(d.jornada), E = toMin(d.entrada), I = toMin(d.intervalo) ?? 0;
    if (E === null || J === null) return null;
    let almoco = I, previsto = false;
    const linhas = [['Entrada', fmt(E)]];
    if (modo === 'C') {
      const SA = depois(toMin(d.saiAlm), E);
      if (SA !== null) {
        linhas.push(['Saída almoço', fmt(SA)]);
        const VA = depois(toMin(d.volAlm), SA);
        if (VA !== null) { almoco = VA - SA; linhas.push(['Volta almoço', fmt(VA)]); }
        else { previsto = true; linhas.push(['Volta prevista', fmt(SA + I)]); }
        linhas.push(['Trabalhado antes do almoço', dur(SA - E)]);
        linhas.push(['Falta trabalhar depois', dur(Math.max(0, J - (SA - E)))]);
      } else previsto = true;
    }
    linhas.push(['Almoço' + (previsto ? ' (previsto)' : ''), dur(almoco)]);
    const saida = E + J + almoco;
    linhas.push(['Limite com 2h extras', fmt(saida + 120)]);
    const avisos = [];
    if (J > 360 && almoco < 60) avisos.push('Jornadas acima de 6h normalmente exigem pelo menos 1h de intervalo (CLT).');
    if (J > 240 && J <= 360 && almoco < 15) avisos.push('Jornadas entre 4h e 6h normalmente exigem 15min de intervalo (CLT).');
    if (J > 600) avisos.push('Jornada acima de 10h — confira se está certo.');
    return { entrada: E, saida, almoco, linhas, avisos };
  }

  // Horas trabalhadas de um dia fechado (com saída registrada) e saldo para o banco de horas.
  function fechamento(d) {
    const E = toMin(d.entrada), S0 = toMin(d.saida), J = toMin(d.jornada);
    if (E === null || S0 === null) return null;
    const S = depois(S0, E);
    let almoco = toMin(d.intervalo) ?? 0;
    const SA = depois(toMin(d.saiAlm), E), VA = depois(toMin(d.volAlm), SA);
    if (SA !== null && VA !== null) almoco = VA - SA;
    const trabalhado = Math.max(0, S - E - almoco);
    return { trabalhado, almoco, saldo: J === null ? 0 : trabalhado - J };
  }

  // Avisos de push: volta do almoço e saída, ANTECEDENCIA minutos antes.
  // dias = {'AAAA-MM-DD': registro}; agora = Date. Considera hoje e ontem (jornada que vira a meia-noite).
  const ANTECEDENCIA = 2;
  const chave = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function agendaAvisos({ dias, modo, agora, alm = true, sai = true }) {
    const out = [], now = agora.getTime();
    for (const delta of [-1, 0]) {
      const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + delta);
      const r = dias[chave(d)];
      if (!r || !r.entrada || r.saida) continue;
      const em = m => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m - ANTECEDENCIA).getTime();
      const E = toMin(r.entrada);
      if (alm) {
        const SA = depois(toMin(r.saiAlm), E);
        if (SA !== null && !r.volAlm) {
          const volta = SA + (toMin(r.intervalo) ?? 0);
          out.push({ ts: em(volta), tipo: 'alm', h: fmt(volta) });
        }
      }
      if (sai) {
        const p = previsao(r, modo === 'C' || r.saiAlm ? 'C' : 'S');
        if (p) out.push({ ts: em(p.saida), tipo: 'sai', h: fmt(p.saida) });
      }
    }
    return out.filter(e => e.ts > now).sort((a, b) => a.ts - b.ts).slice(0, 3);
  }

  const api = { HORA, toMin, fmt, dur, previsao, fechamento, agendaAvisos, ANTECEDENCIA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ponto = api;
})(typeof self !== 'undefined' ? self : this);
