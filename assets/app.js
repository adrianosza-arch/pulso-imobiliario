/* Pulso Imobiliário — interface. Lê window.PULSO (gerado por collector/collect.ps1). */
(function () {
  'use strict';
  const D = window.PULSO;
  const main = document.getElementById('main');
  if (!D) { main.innerHTML = '<div class="empty">Dados não encontrados. Rode <code>pwsh -File collector/collect.ps1</code> para gerar <code>data/bundle.js</code>.</div>'; return; }
  const SNAP = !!window.PULSO_SNAPSHOT;

  /* ================= dados ================= */
  const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
  const SERIES = arr(D.series).map((s) => ({ ...s, areas: arr(s.areas), gaps: arr(s.gaps), revisions: arr(s.revisions), obs: arr(s.obs) }));
  const S = Object.fromEntries(SERIES.map((s) => [s.id, s]));
  const C = D.curated || {};
  const CUR_NEWS = arr(C.news);
  const ALERTS = arr(D.alerts).map((a) => ({ ...a, series: arr(a.series) }));
  const RUNS = arr(D.runs).map((r) => ({ ...r, results: arr(r.results) }));
  const NEWS = arr(D.news && D.news.items).map((n) => ({ ...n, themes: arr(n.themes), matched: arr(n.matched) }));
  const VIDEOS = arr(D.videos && D.videos.items).map((v) => ({ ...v, themes: arr(v.themes) }));
  const TODAY = (D.generatedAt || '').slice(0, 10);

  /* ================= formatação ================= */
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  function decimals(s) {
    const u = s.unit || '';
    if (/^%/.test(u)) return 2;
    if (/pessoas|R\$ milh|R\$ mil$|^meses$|unidades/.test(u)) return 0;
    if (/R\$\/US\$/.test(u)) return 3;
    return 2;
  }
  const fmtVal = (s, v) => nf(v, decimals(s));
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function fmtPeriod(k) {
    if (!k) return '—';
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k))) return `${m[3]}/${m[2]}/${m[1]}`;
    if ((m = /^(\d{4})-(\d{2})$/.exec(k))) return `${MES[+m[2] - 1]}/${m[1]}`;
    if ((m = /^(\d{4})-T(\d)$/.exec(k))) return `${m[2]}º tri ${m[1]}`;
    return k;
  }
  function keyToTime(k) {
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(k))) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if ((m = /^(\d{4})-(\d{2})$/.exec(k))) return Date.UTC(+m[1], +m[2] - 1, 1);
    if ((m = /^(\d{4})-T(\d)$/.exec(k))) return Date.UTC(+m[1], (+m[2] - 1) * 3, 1);
    if ((m = /^(\d{4})$/.exec(k))) return Date.UTC(+m[1], 0, 1);
    return NaN;
  }
  function fmtStamp(iso) {
    if (!iso) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}h${m[5]}` : iso;
  }
  function fmtDate(iso) { if (!iso) return '—'; const t = new Date(iso); if (isNaN(t)) return fmtPeriod(String(iso).slice(0, 10)); return t.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).replace(/\./g, ''); }
  function ago(iso) {
    if (!iso) return '';
    const days = Math.floor((keyToTime(TODAY) - keyToTime(String(iso).slice(0, 10))) / 864e5);
    if (days <= 0) return 'hoje'; if (days === 1) return 'ontem'; if (days < 30) return `há ${days} dias`;
    if (days < 365) return `há ${Math.round(days / 30)} ${Math.round(days / 30) === 1 ? 'mês' : 'meses'}`;
    return `há ${Math.round(days / 365)} ${Math.round(days / 365) === 1 ? 'ano' : 'anos'}`;
  }
  const isRate = (s) => /^%/.test(s.unit || '');
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const store = { get(k) { try { return localStorage.getItem('pulso:' + k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('pulso:' + k, v); } catch (e) { /* sem armazenamento */ } } };

  /* ================= ícones ================= */
  const P = (d, extra = '') => `<svg viewBox="0 0 20 20" aria-hidden="true" ${extra}><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const NI = {
    visao: P('M3 10.5 10 4l7 6.5M5 9v7h4v-4h2v4h4V9'),
    alertas: P('M10 3a5 5 0 0 0-5 5v3l-1.5 3h13L15 11V8a5 5 0 0 0-5-5zM8 16.5a2 2 0 0 0 4 0'),
    noticias: P('M4 4h10v12H5a1 1 0 0 1-1-1V4zM14 7h2v8a1 1 0 0 1-2 0M6.5 7h5M6.5 10h5M6.5 13h3'),
    videos: P('M3 5.5h14v9H3zM8.5 8v4l3.5-2z'),
    macro: P('M3 16h14M5 13l3-4 3 2 4-6'),
    setorial: P('M4 16V9l4-3v10M8 16V6l5-2v12M13 16V8l3 1.5V16M3 16h14'),
    mundo: P('M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM3 10h14M10 3c2 2 2.8 4.5 2.8 7S12 15 10 17M10 3C8 5 7.2 7.5 7.2 10S8 15 10 17'),
    brasil: P('M5 4l5 1 4-1 2 4-1 4-4 5-3-1-2-4-2-3z'),
    sc: P('M3 8l5-2 3 1 4-1 2 3-3 2-4 1-4 2-3-2z'),
    joinville: P('M4 16V8l3-2v10M7 16V5h5v11M12 16V9h4v7M3 16h14M9 8h1M9 11h1'),
    itapoa: P('M3 13c2 0 2-1.5 3.5-1.5S8 13 10 13s2-1.5 3.5-1.5S15 13 17 13M5 10V6h6v4M8 6V4'),
    fontes: P('M4 4h12v4H4zM4 10h12v6H4zM7 6h.01M7 13h.01'),
  };
  const ICON = {
    critico: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 10H1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 4.5v2.6M6 8.6v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    atencao: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 3.4v3.2M6 8.4v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    oportunidade: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8.5 5 5.5l2 2 3-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ok: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.3 5 8.6l4.5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 3.5V6l1.8 1.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  };
  const ext = P('M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8');
  const playSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4v12l10-6z"/></svg>';
  const closeSvg = P('M5 5l10 10M15 5 5 15');
  const LEVEL = { critico: ['crit', 'Crítico'], atencao: ['warn', 'Atenção'], oportunidade: ['ok', 'Oportunidade'] };
  const levelChip = (l) => `<span class="chip ${LEVEL[l][0]}">${ICON[l]}${LEVEL[l][1]}</span>`;
  const STATE = { em_dia: ['ok', 'ok', 'Em dia'], defasado: ['warn', 'clock', 'Defasado'], falha_ultima_coleta: ['crit', 'critico', 'Falha na última coleta'], falha: ['crit', 'critico', 'Falha'], sem_dados: ['warn', 'atencao', 'Sem dados'] };
  const stateChip = (st) => { const x = STATE[st] || STATE.sem_dados; return `<span class="chip ${x[0]}">${ICON[x[1]]}${x[2]}</span>`; };
  const TYPE = { fato: 'Fato', inferencia: 'Inferência', hipotese: 'Hipótese', implicacao: 'Implicação' };
  const typeChip = (t) => `<span class="chip t-${t}">${TYPE[t]}</span>`;
  const SRC_STATUS = { automatico: ['ok', 'ok', 'Coleta automática'], manual: ['', 'clock', 'Curadoria manual'], planejado: ['warn', 'clock', 'Planejado'], perfil_a_confirmar: ['warn', 'atencao', 'Perfil a confirmar'], planilha: ['ok', 'ok', 'Planilha importada'] };
  const THEMES = { juros: 'Juros', inflacao: 'Inflação', cambio: 'Câmbio', atividade: 'Atividade', credito: 'Crédito', custos: 'Custos da construção', emprego: 'Emprego e renda', populacao: 'População', precos: 'Preços', mercado: 'Lançamentos e vendas', infraestrutura: 'Infraestrutura', legislacao: 'Legislação', saneamento: 'Saneamento', locacao: 'Locação', habitacao: 'Habitação', investimento: 'Investimento' };
  const THEME_COLORS = { credito: ['#1f5fae', '#123a6b'], custos: ['#b45a1f', '#6b3210'], mercado: ['#0b6b63', '#0d3d39'], locacao: ['#6a4bb8', '#3a2870'], habitacao: ['#2d7a2d', '#174417'], legislacao: ['#4b5b66', '#26323a'], investimento: ['#3c4fb0', '#1f2a66'], infraestrutura: ['#9a6a00', '#553a00'] };

  /* ================= navegação ================= */
  const NAV = [
    ['Painel', [['visao', 'Visão geral'], ['alertas', 'Alertas', () => ALERTS.length]]],
    ['Conteúdo', [['noticias', 'Notícias', () => NEWS.length], ['videos', 'Vídeos', () => VIDEOS.length]]],
    ['Indicadores', [['macro', 'Macroeconômicos'], ['setorial', 'Setoriais']]],
    ['Escalas geográficas', [['mundo', 'Mundo'], ['brasil', 'Brasil'], ['sc', 'Santa Catarina'], ['joinville', 'Joinville'], ['itapoa', 'Itapoá']]],
    ['Governança', [['fontes', 'Fontes e método']]],
  ];
  const LABEL = Object.fromEntries(NAV.flatMap((g) => g[1].map((i) => [i[0], i[1]])));
  LABEL.macro = 'Indicadores Macroeconômicos'; LABEL.setorial = 'Indicadores Setoriais';
  function renderNav() {
    document.getElementById('nav').innerHTML = NAV.map(([g, items]) => `<div class="nav-group"><div class="nav-label">${g}</div>${items.map(([id, label, cnt]) => `<a href="#${id}">${NI[id]}<span>${label}</span>${cnt ? `<span class="badge">${cnt()}</span>` : ''}</a>`).join('')}</div>`).join('');
    const sched = RUNS.some((r) => r.trigger === 'agendado');
    const run = RUNS[RUNS.length - 1];
    document.getElementById('side-status').innerHTML = `<div><span class="dot ${sched ? 'on' : ''}"></span>${sched ? 'Rotina diária ativa' : 'Agendamento não ativado'}</div><div>Última coleta: <b>${fmtStamp(run && run.start)}</b></div><div>Rotina: <b>07h15</b> (America/Sao_Paulo)</div>${SNAP ? '<div>Cópia estática publicada</div>' : ''}`;
  }

  /* ================= gráficos ================= */
  function niceTicks(min, max, n) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => span / s <= n) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }
  const FREQ_MS = { mensal: 32 * 864e5, trimestral: 93 * 864e5, anual: 367 * 864e5 };
  function segments(s, pts) {
    const lim = FREQ_MS[s.freq]; const segs = []; let cur = [];
    pts.forEach((p, i) => { if (i && lim && p.t - pts[i - 1].t > lim) { segs.push(cur); cur = []; } cur.push(p); });
    if (cur.length) segs.push(cur);
    return segs;
  }
  let gradId = 0;
  function drawChart(el, ids, range) {
    const labels = (el.dataset.labels || '').split('|');
    const list = ids.map((id, i) => ({ s: S[id], color: `var(--series-${i + 1})`, label: labels[i] || (S[id] && (S[id].short || S[id].name)) })).filter((x) => x.s && x.s.obs.length);
    if (!list.length) { el.innerHTML = '<div class="empty">Sem observações disponíveis.</div>'; return; }
    list.forEach((x) => { x.pts = x.s.obs.map((o) => ({ t: keyToTime(o.d), v: +o.v, d: o.d })).filter((p) => !isNaN(p.t)); if (range) x.pts = x.pts.filter((p) => p.t >= range[0] && p.t <= range[1]); });
    const all = list.flatMap((x) => x.pts);
    if (!all.length) { el.innerHTML = '<div class="empty">Nenhuma observação no intervalo escolhido.</div>'; return; }
    const W = Math.max(280, el.clientWidth || 600), H = el.dataset.h ? +el.dataset.h : 240;
    const m = { l: 54, r: 14, t: 12, b: 26 };
    const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
    const ticks = niceTicks(Math.min(...all.map((p) => p.v)), Math.max(...all.map((p) => p.v)), 5);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = (t) => m.l + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const dec = decimals(list[0].s);
    const tickDec = Math.max(0, Math.min(dec, (String(ticks[1] - ticks[0]).split('.')[1] || '').length));
    let g = '';
    ticks.forEach((v) => { g += `<g class="tick"><line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 7}" y="${Y(v) + 3.5}" text-anchor="end">${nf(v, tickDec)}</text></g>`; });
    const ya = new Date(t0).getUTCFullYear(), yb = new Date(t1).getUTCFullYear();
    const span = yb - ya, every = span > 24 ? 5 : span > 12 ? 2 : 1;
    for (let y = ya; y <= yb; y++) { const t = Date.UTC(y, 0, 1); if (t < t0 || y % every) continue; g += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle">${y}</text><line class="base" x1="${X(t)}" x2="${X(t)}" y1="${H - m.b}" y2="${H - m.b + 4}"/>`; }
    if (span < 1) { const d0 = new Date(t0); for (let k = 0; k < 14; k++) { const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k, 1); if (t > t1) break; if (t >= t0 && k % 2 === 0) g += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle">${MES[new Date(t).getUTCMonth()]}</text>`; } }
    g += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    const single = list.length === 1; const gid = 'g' + (++gradId);
    if (single) g = `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--series-1)" stop-opacity="0.18"/><stop offset="1" stop-color="var(--series-1)" stop-opacity="0"/></linearGradient></defs>` + g;
    list.forEach((x) => {
      const step = x.s.freq === 'diaria_decisao';
      segments(x.s, x.pts).forEach((seg) => {
        let d = '';
        seg.forEach((p, i) => { if (!i) d += `M${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`; else d += step ? `H${X(p.t).toFixed(1)}V${Y(p.v).toFixed(1)}` : `L${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`; });
        if (single && seg.length > 1) g += `<path class="area" d="${d}V${H - m.b}H${X(seg[0].t).toFixed(1)}Z" fill="url(#${gid})"/>`;
        g += `<path class="ln" d="${d}" style="stroke:${x.color}"/>`;
        if (seg.length === 1) g += `<circle cx="${X(seg[0].t)}" cy="${Y(seg[0].v)}" r="3" fill="${x.color}"/>`;
      });
      const lp = x.pts[x.pts.length - 1];
      g += `<circle class="dot" cx="${X(lp.t)}" cy="${Y(lp.v)}" r="4" style="fill:${x.color}"/>`;
    });
    g += `<g class="hover" visibility="hidden"><line class="cross" y1="${m.t}" y2="${H - m.b}"/>${list.map((x) => `<circle class="dot" r="4.5" style="fill:${x.color}"/>`).join('')}</g>`;
    g += `<rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Gráfico: ${esc(list.map((x) => x.label).join(', '))}">${g}</svg><div class="tip" hidden></div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), hov = svg.querySelector('.hover');
    const times = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b);
    const at = (x, t) => { let best = null; for (const p of x.pts) { if (p.t <= t) best = p; else break; } return best; };
    function move(ev) {
      const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width);
      const tt = t0 + ((px - m.l) / (W - m.l - m.r)) * (t1 - t0);
      let near = times[0]; for (const t of times) if (Math.abs(t - tt) < Math.abs(near - tt)) near = t;
      hov.setAttribute('visibility', 'visible');
      const cx = X(near); const ln = hov.querySelector('line'); ln.setAttribute('x1', cx); ln.setAttribute('x2', cx);
      const dots = hov.querySelectorAll('circle'); let rows = '';
      list.forEach((x, i) => {
        const p = x.s.freq === 'diaria_decisao' ? at(x, near) : x.pts.find((q) => q.t === near);
        if (p) { dots[i].setAttribute('cx', cx); dots[i].setAttribute('cy', Y(p.v)); dots[i].style.display = ''; rows += `<div class="row"><span><span class="sw" style="background:${x.color}"></span>${esc(single ? x.s.unit : x.label)}</span><b>${fmtVal(x.s, p.v)}</b></div>`; }
        else { dots[i].style.display = 'none'; rows += `<div class="row"><span><span class="sw" style="background:${x.color}"></span>${esc(x.label)}</span><span class="muted">sem dado</span></div>`; }
      });
      const keyRef = (list.map((x) => x.pts.find((q) => q.t === near)).find(Boolean) || {}).d;
      tip.innerHTML = `<div class="muted">${fmtPeriod(keyRef || new Date(near).toISOString().slice(0, 10))}</div>${rows}${single ? '' : `<div class="muted small">${esc(list[0].s.unit)}</div>`}`;
      tip.hidden = false;
      const left = (cx / W) * r.width; const tw = tip.offsetWidth;
      tip.style.top = '6px'; tip.style.left = (left + 12 + tw > r.width ? Math.max(0, left - tw - 12) : left + 12) + 'px';
    }
    const hit = svg.querySelector('.hit');
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }
  function sparkline(s, w = 84, h = 26) {
    const pts = s.obs.slice(-36).map((o) => +o.v); if (pts.length < 2) return '';
    const mn = Math.min(...pts), mx = Math.max(...pts);
    const X = (i) => 2 + (i / (pts.length - 1)) * (w - 6), Y = (v) => 3 + (mx === mn ? 0.5 : 1 - (v - mn) / (mx - mn)) * (h - 6);
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--series-1)" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${X(pts.length - 1)}" cy="${Y(pts[pts.length - 1])}" r="2.6" fill="var(--series-1)"/></svg>`;
  }
  function mountCharts(root, range) { root.querySelectorAll('[data-chart]').forEach((el) => drawChart(el, el.dataset.chart.split(','), range)); }

  /* ================= peças ================= */
  function delta(s) {
    const o = s.obs; if (o.length < 2) return { html: '<span class="muted">—</span>', ref: '' };
    const a = o[o.length - 1];
    let b = o[o.length - 2];
    if (s.freq === 'diaria_decisao') { for (let i = o.length - 2; i >= 0; i--) { if (+o[i].v !== +a.v) { b = o[i]; break; } } }
    const dv = +a.v - +b.v;
    const cls = Math.abs(dv) < 1e-9 ? '' : dv > 0 ? 'up' : 'down';
    const txt = isRate(s) ? `${dv > 0 ? '+' : ''}${nf(dv, 2)} p.p.` : `${dv > 0 ? '+' : ''}${nf((+a.v / +b.v - 1) * 100, 1)}%`;
    return { html: `<span class="delta ${cls}">${txt}</span>`, ref: `vs ${fmtPeriod(b.d)}` };
  }
  function kpis(ids) {
    return `<div class="kpis">${ids.map((id) => S[id]).filter(Boolean).map((s) => {
      const l = s.obs[s.obs.length - 1]; const dl = delta(s);
      return `<button type="button" class="kpi" data-open="${s.id}" title="Abrir série histórica"><span class="k-label"><span>${esc(s.short || s.name)}</span>${s.state !== 'em_dia' ? stateChip(s.state) : ''}</span><span class="k-val">${l ? fmtVal(s, l.v) : '—'}<small>${esc(s.unit)}</small></span><span class="k-foot"><span>${l ? fmtPeriod(l.d) : ''}<br>${dl.html} <span>${dl.ref}</span></span>${sparkline(s)}</span></button>`;
    }).join('')}</div>`;
  }
  function chartCard(ids, opt) {
    opt = opt || {};
    const ss = ids.map((id) => S[id]).filter(Boolean); if (!ss.length) return '';
    const s = ss[0]; const title = opt.title || s.name;
    const labels = opt.labels || ss.map((x) => x.short || x.name);
    const legend = ss.length > 1 ? `<div class="legend">${ss.map((x, i) => `<span style="--c:var(--series-${i + 1})">${esc(labels[i])}</span>`).join('')}</div>` : '';
    const srcs = [...new Set(ss.map((x) => x.source))].join('; ');
    const first = ss.map((x) => x.first).sort()[0], last = ss.map((x) => x.last).sort().reverse()[0];
    return `<article class="card chart-card"><header><h3>${esc(title)}</h3><span class="unit">${esc(s.unit)} · ${esc(srcs)}</span></header>${legend}<div class="chart" data-chart="${ids.join(',')}" data-labels="${esc(labels.join('|'))}" ${opt.h ? `data-h="${opt.h}"` : ''}></div><div class="chart-foot"><span>${fmtPeriod(first)} a ${fmtPeriod(last)}</span><span>${ss.reduce((a, x) => a + x.count, 0)} observações</span><span>${ss.reduce((a, x) => a + x.gaps.length, 0) ? ss.reduce((a, x) => a + x.gaps.length, 0) + ' períodos sem dado' : 'sem lacunas'}</span><a href="#" data-open="${s.id}">Abrir série completa</a></div>${opt.note ? `<p class="note">${esc(opt.note)}</p>` : s.note && ss.length === 1 ? `<p class="note">${esc(s.note)}</p>` : ''}</article>`;
  }
  function indicatorTable(list) {
    if (!list.length) return '<div class="empty">Nenhum indicador para esta área.</div>';
    return `<div class="table-wrap"><table><thead><tr><th>Indicador</th><th class="num">Último valor</th><th>Período</th><th class="num">Variação</th><th>Tendência</th><th>Situação</th><th>Fonte</th></tr></thead><tbody>${list.map((s) => {
      const l = s.obs[s.obs.length - 1]; const dl = delta(s);
      return `<tr class="clickable" data-open="${s.id}" tabindex="0"><td><b>${esc(s.name)}</b><span class="sub">${esc(s.geo)} · ${esc(s.unit)}</span></td><td class="num"><b class="num">${l ? fmtVal(s, l.v) : '—'}</b><span class="sub">${esc(s.unit)}</span></td><td>${l ? fmtPeriod(l.d) : '—'}<span class="sub">coletado ${fmtStamp(s.lastSuccess)}</span></td><td class="num">${dl.html}<span class="sub">${dl.ref}</span></td><td>${sparkline(s, 96, 28)}</td><td>${stateChip(s.state)}</td><td class="small"><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(s.source)}</a></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function synthesis(key) {
    const sy = (C.syntheses || {})[key]; if (!sy) return '';
    return `<section class="section"><div class="shead"><h2>${esc(sy.title)}</h2><p>Cada afirmação traz seu tipo: fato, inferência, hipótese ou implicação.</p></div><div class="card">${arr(sy.blocks).map((b) => `<div class="synth-row"><div>${typeChip(b.type)}</div><div><p>${esc(b.text)}</p>${arr(b.refs).length ? `<div class="refs">Base: ${arr(b.refs).map((r) => S[r] ? `<a href="#" data-open="${r}">${esc(S[r].name)}</a>` : (CUR_NEWS.find((n) => n.id === r) ? esc(CUR_NEWS.find((n) => n.id === r).source) : esc(r))).join(' · ')}</div>` : ''}</div></div>`).join('')}</div></section>`;
  }
  function analysisList(list) {
    if (!list.length) return '';
    const layer = (k, items) => arr(items).length ? `<div class="synth-row"><div>${typeChip(k)}</div><ul class="gaps">${arr(items).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
    return `<section class="section"><div class="shead"><h2>Análises e documentos selecionados</h2><p>Curadoria com separação entre fato, inferência, hipótese e implicação.</p></div><div class="grid-2">${list.map((n) => `<article class="card" style="display:grid;gap:10px"><div class="small muted">${fmtPeriod(n.date)} · ${esc(n.source)}</div><h3>${esc(n.title)}</h3><p class="note">${esc(n.summary)}</p><span class="chip" style="justify-self:start;white-space:normal">${esc(n.verification)}</span><details><summary class="small" style="cursor:pointer;color:var(--accent)">Fato, inferência, hipótese e implicação</summary><div style="margin-top:8px">${layer('fato', n.facts)}${layer('inferencia', n.inferences)}${layer('hipotese', n.hypotheses)}${layer('implicacao', n.implications)}</div></details><div class="links"><a href="${esc(n.url)}" target="_blank" rel="noopener">Abrir origem ↗</a>${n.primaryUrl ? `<a href="${esc(n.primaryUrl)}" target="_blank" rel="noopener">Documento primário ↗</a>` : ''}</div></article>`).join('')}</div></section>`;
  }
  function alertList(list) {
    if (!list.length) return '<div class="empty">Nenhum alerta ativo pelas regras atuais.</div>';
    const order = { critico: 0, atencao: 1, oportunidade: 2 };
    return `<div class="alerts">${[...list].sort((a, b) => order[a.level] - order[b.level]).map((a) => `<article class="alert lv-${a.level}"><div class="stripe"></div><div class="body"><div class="meta">${levelChip(a.level)}${a.isNew ? '<span class="chip new">Novo nesta coleta</span>' : `<span>Ativo desde ${fmtStamp(a.firstSeen)}</span>`}<span>Regra ${esc(a.rule.split('_')[0])}</span></div><h3>${esc(a.title)}</h3><dl><dt>Evidência</dt><dd>${esc(a.evidence)}</dd><dt>Possível efeito</dt><dd>${esc(a.implication)}</dd><dt>Séries</dt><dd>${a.series.map((id) => S[id] ? `<a href="#" data-open="${id}">${esc(S[id].name)}</a>` : esc(id)).join(' · ')}</dd></dl></div></article>`).join('')}</div>`;
  }
  function manualTable(area) {
    const list = arr(C.manualIndicators).filter((m) => m.area === area); if (!list.length) return '';
    return `<section class="section"><div class="shead"><h2>Indicadores de pesquisa e coleta pontual</h2><p>Inseridos manualmente, com a natureza da informação identificada.</p></div><div class="table-wrap"><table><thead><tr><th>Indicador</th><th class="num">Valor</th><th>Período</th><th>Natureza</th><th>Fonte</th></tr></thead><tbody>${list.map((m) => `<tr><td><b>${esc(m.name)}</b><span class="sub">${esc(m.geo)}</span></td><td class="num"><b class="num">${nf(m.value, Number.isInteger(m.value) ? 0 : m.value < 10 ? 2 : 1)}</b><span class="sub">${esc(m.unit)}</span></td><td>${esc(m.period)}</td><td class="small">${esc(m.nature)}</td><td class="small"><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.source)}</a></td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function gapsBlock(area) {
    const g = arr((C.gaps || {})[area]); if (!g.length) return '';
    return `<section class="section"><div class="shead"><h2>Ainda não coberto</h2><p>Lacunas conhecidas. Não há dado de demonstração no lugar delas.</p></div><div class="card"><ul class="gaps">${g.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></section>`;
  }
  const phead = (eyebrow, title, desc, pills) => `<header class="phead"><div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${desc ? `<p>${desc}</p>` : ''}</div>${pills ? `<div class="meta">${pills}</div>` : ''}</header>`;
  const pill = (label, val) => `<span class="pill">${label} <b>${val}</b></span>`;

  /* ================= notícias: cartões ================= */
  const themeIcon = P('M4 16V9l4-3v10M8 16V6l5-2v12M13 16V8l3 1.5V16M3 16h14');
  function placeholder(n) {
    const c = THEME_COLORS[n.themes[0]] || ['#0b6b63', '#0d3d39'];
    return `<div class="ph" style="--ph1:${c[0]};--ph2:${c[1]}">${themeIcon}<span>${esc(n.source)}</span></div>`;
  }
  function mediaHtml(n) {
    return n.image ? `${placeholder(n)}<img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="position:absolute;inset:0" onerror="this.remove()">` : placeholder(n);
  }
  function newsCard(n, feature) {
    return `<button type="button" class="ncard${feature ? ' feature' : ''}" data-news="${esc(n.id)}"><div class="media">${mediaHtml(n)}</div><div class="nbody"><div class="nmeta"><b>${esc(n.source)}</b><span>${fmtDate(n.published || n.firstSeen)}</span><span>${esc(n.geo)}</span></div><h3>${esc(n.title)}</h3>${n.summary ? `<p>${esc(n.summary)}</p>` : ''}<div class="ntags">${n.themes.map((t) => `<span class="tag">${esc(THEMES[t] || t)}</span>`).join('')}</div></div></button>`;
  }
  function openNews(id) {
    const n = NEWS.find((x) => x.id === id); if (!n) return;
    const dlg = document.getElementById('news-modal');
    dlg.innerHTML = `<div class="modal"><div class="media">${mediaHtml(n)}<button type="button" class="close" data-close aria-label="Fechar">${closeSvg}</button></div><div class="mbody"><div class="small muted">${esc(n.source)} · ${esc(n.geo)}</div><h2>${esc(n.title)}</h2>${n.summary ? `<p>${esc(n.summary)}</p>` : '<p class="muted">A fonte não forneceu resumo no feed.</p>'}<div class="kv-grid"><div><span>Publicada em</span>${fmtStamp(n.published)}</div><div><span>Coletada pelo painel</span>${fmtStamp(n.firstSeen)}</div><div><span>Tipo de fonte</span>${n.kind === 'setorial' ? 'Fonte do setor' : 'Veículo geral, filtrado por relevância'}</div><div><span>Temas</span>${n.themes.map((t) => esc(THEMES[t] || t)).join(', ') || '—'}</div></div>${n.matched.length ? `<p class="note">Termos que tornaram a notícia relevante: ${n.matched.map(esc).join(', ')}.</p>` : ''}<p class="note">O resumo vem do feed da fonte e é limitado a um trecho curto. O texto completo, os dados e o contexto estão no site original.</p><div class="toolbar"><a class="btn primary" href="${esc(n.url)}" target="_blank" rel="noopener">${ext}Ler no site original</a><a class="btn" href="${esc(n.site)}" target="_blank" rel="noopener">Ir para ${esc(n.source)}</a></div></div></div>`;
    dlg.showModal();
  }

  /* ================= vídeos ================= */
  const thumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  const ytUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  function videoCard(v) {
    const media = `<img src="${thumb(v.id)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'"><span class="play"><i>${playSvg}</i></span><span class="fs">${SNAP ? 'Abre no YouTube' : 'Tela cheia'}</span>`;
    const thumbEl = SNAP ? `<a class="vthumb" href="${ytUrl(v.id)}" target="_blank" rel="noopener" aria-label="Assistir no YouTube: ${esc(v.title)}">${media}</a>` : `<button type="button" class="vthumb" data-play="${esc(v.id)}" aria-label="Assistir em tela cheia: ${esc(v.title)}">${media}</button>`;
    return `<article class="vcard">${thumbEl}<div class="vbody"><h3>${esc(v.title)}</h3><div class="vmeta"><b>${esc(v.channel)}</b><span>${fmtDate(v.published)}</span>${v.themes.length ? `<span>${esc(THEMES[v.themes[0]] || v.themes[0])}</span>` : ''}</div><div class="vact">${SNAP ? '' : `<button type="button" class="btn primary" data-play="${esc(v.id)}">${playSvg.replace('<svg', '<svg style="fill:currentColor"')}Assistir aqui</button>`}<a class="btn" href="${ytUrl(v.id)}" target="_blank" rel="noopener">${ext}YouTube</a></div></div></article>`;
  }
  function openVideo(id) {
    const v = VIDEOS.find((x) => x.id === id) || { id, title: '' };
    const dlg = document.getElementById('video-modal');
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1`;
    dlg.innerHTML = `<div class="player" id="player"><div class="pbar"><b>${esc(v.title)}</b><button type="button" class="btn" data-fs>Tela cheia</button><a class="btn" href="${ytUrl(id)}" target="_blank" rel="noopener">Abrir no YouTube</a><button type="button" class="btn" data-close>Fechar</button></div><div class="frame"><iframe src="${src}" title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${location.protocol === 'file:' ? '<div class="hint">Se o vídeo não carregar, abra o site por endereço http (por exemplo, pelo scripts/serve.ps1 ou GitHub Pages). O YouTube bloqueia reprodução em arquivos abertos direto do disco.</div>' : ''}</div>`;
    dlg.showModal();
    const pl = document.getElementById('player');
    if (pl.requestFullscreen) pl.requestFullscreen().catch(() => { /* navegador recusou: segue no modal */ });
  }
  function closeDialog(dlg) { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); dlg.close(); if (dlg.id === 'video-modal') dlg.innerHTML = ''; }

  /* ================= explorador de séries ================= */
  const EXP = { macro: { id: store.get('serie:macro') || 'selic_meta', cmp: '', preset: 'tudo', from: '', to: '', table: false, q: '' }, setorial: { id: store.get('serie:setorial') || 'cub_sc_res', cmp: '', preset: 'tudo', from: '', to: '', table: false, q: '' } };
  function groupOf(id) { return S[id] ? S[id].group : 'macro'; }
  function rangeFor(st, s) {
    if (st.preset === 'custom' && (st.from || st.to)) return [st.from ? keyToTime(st.from) : -Infinity, st.to ? keyToTime(st.to) + 31 * 864e5 : Infinity];
    const last = keyToTime(s.last); const yrs = { '12m': 1, '5a': 5, '10a': 10 }[st.preset];
    return yrs ? [Date.UTC(new Date(last).getUTCFullYear() - yrs, new Date(last).getUTCMonth(), 1), Infinity] : null;
  }
  function explorer(group) {
    return `<section class="section" id="explorer"><div class="shead"><h2>Explorar séries históricas</h2><p>Período ajustável, comparação só entre séries com a mesma unidade, tabela e exportação.</p></div><div class="explorer"><nav class="card slist" aria-label="Séries" id="slist-${group}"></nav><div id="detail-${group}" style="min-width:0;display:grid;gap:14px"></div></div></section>`;
  }
  function renderList(group) {
    const st = EXP[group]; const box = document.getElementById('slist-' + group); if (!box) return;
    const q = norm(st.q);
    const vis = SERIES.filter((s) => s.group === group && (!q || norm(s.name + ' ' + s.source + ' ' + s.geo).includes(q)));
    const groups = {}; vis.forEach((s) => (groups[THEMES[s.theme] || s.theme] = groups[THEMES[s.theme] || s.theme] || []).push(s));
    box.innerHTML = `<label class="sr" for="sq-${group}">Buscar série</label><input class="field" type="search" id="sq-${group}" placeholder="Buscar série" value="${esc(st.q)}">` + (vis.length ? Object.keys(groups).map((g) => `<div class="grp">${esc(g)}</div>${groups[g].map((s) => `<button type="button" data-pick="${s.id}" aria-pressed="${s.id === st.id}"><span>${esc(s.name)}</span><span class="sub">${esc(s.geo)} · ${esc(s.unit)}</span></button>`).join('')}`).join('') : '<div class="empty">Nenhuma série encontrada.</div>');
  }
  function renderDetail(group) {
    const st = EXP[group]; const box = document.getElementById('detail-' + group); if (!box) return;
    if (!S[st.id] || S[st.id].group !== group) st.id = SERIES.find((s) => s.group === group).id;
    const s = S[st.id];
    const compat = SERIES.filter((x) => x.id !== s.id && x.unit === s.unit);
    if (st.cmp && !compat.some((x) => x.id === st.cmp)) st.cmp = '';
    const ids = st.cmp ? [s.id, st.cmp] : [s.id];
    const rg = rangeFor(st, s);
    const inRange = (o) => { const t = keyToTime(o.d); return !rg || (t >= rg[0] && t <= rg[1]); };
    const shown = s.obs.filter(inRange);
    const presets = [['12m', '12 meses'], ['5a', '5 anos'], ['10a', '10 anos'], ['tudo', 'Tudo']];
    const l = s.obs[s.obs.length - 1]; const revs = s.revisions.slice(-8).reverse();
    box.innerHTML = `
      <article class="card chart-card">
        <header><h2>${esc(s.name)}</h2><span class="unit">${esc(s.unit)} · ${esc(s.geo)} · <a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(s.source)}</a> ${stateChip(s.state)}</span></header>
        <div class="toolbar"><div class="seg" role="group" aria-label="Período">${presets.map((p) => `<button type="button" data-preset="${p[0]}" data-g="${group}" aria-pressed="${st.preset === p[0]}">${p[1]}</button>`).join('')}</div>
          <label class="small">De <input class="field" id="from-${group}" type="month" value="${esc(st.from)}"></label><label class="small">Até <input class="field" id="to-${group}" type="month" value="${esc(st.to)}"></label>
          <button type="button" class="btn" data-reset="${group}">Restaurar período completo</button></div>
        <div class="toolbar"><label class="small">Comparar com <select class="field" id="cmp-${group}"><option value="">Nenhuma série</option>${compat.map((x) => `<option value="${x.id}" ${x.id === st.cmp ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>${compat.length ? '' : '<span class="small muted">Nenhuma outra série com a mesma unidade.</span>'}</div>
        ${st.cmp ? `<div class="legend"><span style="--c:var(--series-1)">${esc(s.short || s.name)}</span><span style="--c:var(--series-2)">${esc(S[st.cmp].short || S[st.cmp].name)}</span></div>` : ''}
        <div class="chart" data-chart="${ids.join(',')}" data-h="320"></div>
        <div class="chart-foot"><span>Exibindo ${shown.length} de ${s.count} observações${shown.length ? `, de ${fmtPeriod(shown[0].d)} a ${fmtPeriod(shown[shown.length - 1].d)}` : ''}</span></div>
        <div class="toolbar">${SNAP ? '' : `<button type="button" class="btn" data-csv="download" data-g="${group}">Baixar CSV</button>`}<button type="button" class="btn" data-csv="copy" data-g="${group}">Copiar CSV</button><button type="button" class="btn" data-table="${group}">${st.table ? 'Ocultar tabela' : 'Ver dados em tabela'}</button><span class="small muted" id="csv-msg-${group}" role="status"></span></div>
        ${st.table ? `<div class="table-wrap" style="max-height:360px;overflow:auto;box-shadow:none"><table><thead><tr><th>Período</th><th class="num">Valor (${esc(s.unit)})</th></tr></thead><tbody>${shown.slice().reverse().map((o) => `<tr><td>${fmtPeriod(o.d)}</td><td class="num">${fmtVal(s, o.v)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </article>
      <article class="card" style="display:grid;gap:12px"><h3>Ficha da série</h3>
        <div class="kv-grid">
          <div><span>Último valor</span><b class="num">${l ? fmtVal(s, l.v) : '—'}</b> ${esc(s.unit)}</div><div><span>Período de referência</span>${l ? fmtPeriod(l.d) : '—'}</div>
          <div><span>Geografia</span>${esc(s.geo)}</div><div><span>Frequência</span>${esc({ diaria_decisao: 'Diária (muda nas decisões do Copom)', mensal: 'Mensal', trimestral: 'Trimestral', anual: 'Anual' }[s.freq] || s.freq)}</div>
          <div><span>Início e fim</span>${fmtPeriod(s.first)} a ${fmtPeriod(s.last)}</div><div><span>Observações</span><span class="num">${s.count}</span></div>
          <div><span>${s.connector === 'manual' ? 'Planilha importada em' : 'Última coleta bem-sucedida'}</span>${fmtStamp(s.connector === 'manual' ? s.importedAt : s.lastSuccess)}</div><div><span>Última verificação</span>${fmtStamp(s.lastAttempt)}</div>
          <div><span>Origem</span><span class="mono">${esc(s.connector === 'manual' ? 'Planilha' : s.connector.toUpperCase() + ' ' + s.code)}</span></div><div><span>Conferência</span>${esc(s.titleCheck)}</div>
        </div>
        ${s.note ? `<p class="note"><b>Metodologia e cobertura:</b> ${esc(s.note)}</p>` : ''}
        <p class="note"><b>Lacunas:</b> ${s.gaps.length ? `${s.gaps.length} período(s) sem dado: ${s.gaps.slice(0, 24).map(fmtPeriod).join(', ')}${s.gaps.length > 24 ? '…' : ''}` : 'nenhuma no intervalo da série.'}${s.skipped ? ` A fonte marcou ${s.skipped} valor(es) como indisponível(is).` : ''}</p>
        <p class="note"><b>Revisões registradas:</b> ${revs.length ? revs.map((r) => `${fmtPeriod(r.d)}: ${fmtVal(s, r.old)} → ${fmtVal(s, r.new)}`).join('; ') : 'nenhuma até agora. Cada execução é comparada com a anterior, e toda alteração feita pela fonte fica registrada.'}</p>
        ${s.lastError ? `<p class="note" style="color:var(--st-crit-ink)"><b>Último erro:</b> ${esc(s.lastError)}. O último dado válido foi preservado.</p>` : ''}
        <div class="links"><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">Consultar na fonte ↗</a>${s.docUrl ? `<a href="${esc(s.docUrl)}" target="_blank" rel="noopener">Documentação ↗</a>` : ''}</div>
      </article>`;
    mountCharts(box, rg);
  }
  function csvFor(group) {
    const st = EXP[group]; const s = S[st.id]; const rg = rangeFor(st, s);
    const pick = (x) => x.obs.filter((o) => { const t = keyToTime(o.d); return !rg || (t >= rg[0] && t <= rg[1]); });
    const line = (x, o) => [x.id, x.connector === 'manual' ? 'planilha' : `${x.connector}:${x.code}`, o.d, String(o.v).replace('.', ','), x.unit, x.geo, x.source, x.lastSuccess].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';');
    let out = 'serie;origem;periodo;valor;unidade;geografia;fonte;coletado_em\n' + pick(s).map((o) => line(s, o)).join('\n');
    if (st.cmp) out += '\n' + pick(S[st.cmp]).map((o) => line(S[st.cmp], o)).join('\n');
    return out;
  }

  /* ================= visões ================= */
  function viewVisao() {
    const run = RUNS[RUNS.length - 1];
    const changed = run ? run.results.filter((r) => r.status === 'ok') : [];
    const failing = SERIES.filter((s) => /falha|defasado/.test(s.state));
    const latestNews = NEWS.slice(0, 4); const latestVid = VIDEOS.slice(0, 3);
    const newToday = NEWS.filter((n) => (n.firstSeen || '').slice(0, 10) === TODAY).length;
    return `${phead('Resumo executivo', 'Visão geral', `O que mudou, os indicadores prioritários e o que merece atenção no desenvolvimento imobiliário, do cenário nacional a Joinville e Itapoá.`, pill('Dados de', fmtStamp(D.generatedAt)) + pill('Séries em dia', `${SERIES.filter((s) => s.state === 'em_dia').length}/${SERIES.length}`) + pill('Notícias novas hoje', newToday))}
      <section class="section">${kpis(['selic_meta', 'ipca_12m', 'fin_imob_taxa', 'cub_sc_res', 'incc_m_12m', 'desocupacao_sc'])}</section>
      <section class="split">
        <div class="card" style="display:grid;gap:12px"><div class="shead"><h2>Alertas ativos</h2><a href="#alertas">Ver evidências</a></div>${ALERTS.length ? ALERTS.map((a) => `<div class="alert-mini">${levelChip(a.level)}<span>${esc(a.title)}</span></div>`).join('') : '<p class="muted">Nenhum alerta ativo.</p>'}</div>
        <div class="card" style="display:grid;gap:10px"><h2>Desde a última coleta</h2>${!run ? '<p class="muted">Nenhuma execução registrada.</p>' : `<ul class="gaps">${changed.length ? changed.slice(0, 8).map((r) => `<li><a href="#" data-open="${r.id}">${esc(S[r.id] ? S[r.id].name : r.id)}</a>: ${r.newObs ? `${r.newObs} período(s) novo(s)` : ''}${r.newObs && r.revised ? '; ' : ''}${r.revised ? `${r.revised} revisão(ões) da fonte` : ''}</li>`).join('') : '<li>Nenhuma série com dado novo ou revisado.</li>'}${run.content && run.content.newsAdded != null ? `<li>${run.content.newsAdded} notícia(s) e ${run.content.videosAdded || 0} vídeo(s) acrescentados ao histórico.</li>` : ''}</ul>`}${failing.length ? `<p class="note">${failing.length} série(s) com falha ou defasagem: ${failing.map((s) => `<a href="#" data-open="${s.id}">${esc(s.name)}</a>`).join(', ')}.</p>` : '<p class="note">Todas as séries estão em dia com o calendário esperado de divulgação.</p>'}</div>
      </section>
      <section class="section"><div class="grid-2">${chartCard(['selic_meta'])}${chartCard(['cub_sc_res_12m', 'incc_m_12m', 'ipca_12m'], { title: 'Custo da construção × inflação, em 12 meses', labels: ['CUB/SC residencial', 'INCC-M (Brasil)', 'IPCA (Brasil)'], note: 'Todas em % acumulado em 12 meses. Os índices medem cestas diferentes; a comparação indica direção, não equivalência.' })}</div></section>
      ${synthesis('visao')}
      <section class="section"><div class="shead"><h2>Últimas notícias</h2><a href="#noticias">Ver todas (${NEWS.length})</a></div>${latestNews.length ? `<div class="ncards">${latestNews.map((n, i) => newsCard(n, i === 0)).join('')}</div>` : '<div class="empty">Nenhuma notícia coletada ainda.</div>'}</section>
      <section class="section"><div class="shead"><h2>Vídeos recentes</h2><a href="#videos">Ver todos (${VIDEOS.length})</a></div>${latestVid.length ? `<div class="vcards">${latestVid.map(videoCard).join('')}</div>` : '<div class="empty">Nenhum vídeo no histórico.</div>'}</section>`;
  }
  const RULES = [
    ['R1', 'Decisão do Copom nos últimos 60 dias', 'Corte: oportunidade. Alta < 0,5 p.p.: atenção. Alta ≥ 0,5 p.p.: crítico.', 'SGS 432'],
    ['R2', 'IPCA em 12 meses acima do teto da meta', '> 4,5% (meta de 3,0% ± 1,5 p.p.): atenção. > 6,0%: crítico.', 'SGS 13522'],
    ['R3', 'SINAPI-SC acima do IPCA no mesmo mês, em 12 meses', 'Diferença ≥ 1,5 p.p.: atenção. ≥ 3,0 p.p.: crítico.', 'SIDRA 2296 × SGS 13522'],
    ['R4', 'Taxa do financiamento imobiliário em 6 meses', 'Alta ≥ 0,5 p.p.: atenção. Queda ≥ 0,5 p.p.: oportunidade.', 'SGS 20772'],
    ['R5', 'Inadimplência imobiliária em 12 meses', 'Alta ≥ 0,3 p.p.: atenção.', 'SGS 21151'],
    ['R6', 'Concessões em 12 meses contra os 12 anteriores (nominal)', 'Queda ≥ 10%: atenção. Alta ≥ 10%: oportunidade.', 'SGS 20704'],
    ['R7', 'Desocupação em SC contra o mesmo trimestre do ano anterior', 'Alta ≥ 1,0 p.p.: atenção.', 'SIDRA 4099'],
    ['R8', 'Operacional: falha de coleta ou série defasada', 'Falha: crítico. Defasagem acima do prazo da frequência: atenção.', 'Registro de execuções'],
  ];
  function viewAlertas() {
    return `${phead('Painel', 'Alertas', 'Gerados a cada execução por regras e limiares fixos. Um alerta já visto não volta como novo enquanto o cenário não muda. Indicam o que investigar e não são recomendações automáticas.', pill('Ativos', ALERTS.length))}
      <section class="section">${alertList(ALERTS)}</section>
      <section class="section"><div class="shead"><h2>Regras e limiares</h2><p>Calibração inicial, a revisar com o uso. R2 segue a meta oficial; os demais são convenções deste painel.</p></div><div class="table-wrap"><table><thead><tr><th>Regra</th><th>Evento monitorado</th><th>Limiar e classificação</th><th>Dados</th></tr></thead><tbody>${RULES.map((r) => `<tr><td class="mono">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="small">${r[3]}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  const NF = { q: '', source: '', theme: '', geo: '', days: '0', shown: 24 };
  function filteredNews() {
    const q = norm(NF.q);
    return NEWS.filter((n) => (!NF.source || n.source === NF.source) && (!NF.theme || n.themes.includes(NF.theme)) && (!NF.geo || n.geo === NF.geo)
      && (NF.days === '0' || (keyToTime(TODAY) - keyToTime((n.published || n.firstSeen || '').slice(0, 10))) / 864e5 <= +NF.days)
      && (!q || norm(n.title + ' ' + n.summary + ' ' + n.source).includes(q)));
  }
  function viewNoticias() {
    const sources = [...new Set(NEWS.map((n) => n.source))].sort();
    const themes = [...new Set(NEWS.flatMap((n) => n.themes))];
    const lastUpd = (D.news && D.news.items && NEWS.length) ? NEWS.map((n) => n.firstSeen).sort().reverse()[0] : null;
    return `${phead('Conteúdo', 'Notícias', 'Varredura diária dos principais sites do mercado imobiliário e da construção. Fontes do setor entram integralmente; veículos gerais passam por filtro de relevância. O histórico só cresce: nada é apagado.', pill('No histórico', NEWS.length) + pill('Fontes', sources.length) + pill('Última varredura', fmtStamp(lastUpd)))}
      <section class="section">
        <div class="toolbar"><label class="sr" for="nq">Buscar notícias</label><input class="field" type="search" id="nq" placeholder="Buscar nas notícias" value="${esc(NF.q)}">
          <label class="sr" for="nsrc">Fonte</label><select class="field" id="nsrc"><option value="">Todas as fontes</option>${sources.map((s) => `<option ${NF.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <label class="sr" for="ngeo">Geografia</label><select class="field" id="ngeo"><option value="">Todas as geografias</option>${['Brasil', 'Santa Catarina', 'Joinville', 'Itapoá', 'Mundo'].map((g) => `<option ${NF.geo === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
          <label class="sr" for="ndays">Período</label><select class="field" id="ndays">${[['0', 'Todo o histórico'], ['1', 'Últimas 24 horas'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias']].map((o) => `<option value="${o[0]}" ${NF.days === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        <div class="chips-filter" role="group" aria-label="Tema"><button type="button" data-ntheme="" aria-pressed="${!NF.theme}">Todos os temas</button>${themes.map((t) => `<button type="button" data-ntheme="${t}" aria-pressed="${NF.theme === t}">${esc(THEMES[t] || t)}</button>`).join('')}</div>
        <div id="news-grid"></div>
      </section>`;
  }
  function renderNewsGrid() {
    const box = document.getElementById('news-grid'); if (!box) return;
    const list = filteredNews(); const page = list.slice(0, NF.shown);
    const plain = !NF.q && !NF.source && !NF.theme && !NF.geo && NF.days === '0';
    box.innerHTML = `<p class="small muted" style="margin-bottom:12px">${list.length} notícia(s)${list.length > page.length ? `, exibindo ${page.length}` : ''}.</p>` + (page.length ? `<div class="ncards">${page.map((n, i) => newsCard(n, plain && i === 0)).join('')}</div>` : '<div class="empty">Nenhuma notícia com esses filtros.</div>') + (list.length > page.length ? `<div class="more" style="margin-top:18px"><button type="button" class="btn" data-more-news>Mostrar mais ${Math.min(24, list.length - page.length)}</button></div>` : '');
  }
  const VF = { q: '', channel: '', shown: 24 };
  function viewVideos() {
    const channels = [...new Set(VIDEOS.map((v) => v.channel))].sort();
    const api = (D.videos && D.videos.api) || {};
    return `${phead('Conteúdo', 'Vídeos', `Vídeos sobre mercado imobiliário, incorporação, crédito e construção. A cada atualização diária, novos vídeos dos canais monitorados${api.keyConfigured ? ' e da busca por tema' : ''} são acrescentados ao histórico, sem substituir os anteriores. ${SNAP ? 'Nesta cópia publicada, os vídeos abrem no YouTube.' : 'Clique no vídeo para assistir em tela cheia sem sair do site.'}`, pill('No histórico', VIDEOS.length) + pill('Canais', channels.length) + pill('Coleta', api.keyConfigured ? 'RSS + API do YouTube' : 'RSS dos canais'))}
      ${SNAP ? `<section class="section"><div class="card" style="display:grid;gap:6px;border-color:var(--accent)"><h3>Nesta cópia publicada, os vídeos abrem no YouTube</h3><p class="note">O visualizador do claude.ai bloqueia reprodutores de outros sites dentro da página. No site principal do Pulso Imobiliário (publicado no GitHub Pages), o clique no cartão toca o vídeo em tela cheia sem sair do site, em qualquer computador ou celular.</p></div></section>` : ''}
      <section class="section">
        <div class="toolbar"><label class="sr" for="vq">Buscar vídeos</label><input class="field" type="search" id="vq" placeholder="Buscar nos vídeos" value="${esc(VF.q)}"><label class="sr" for="vch">Canal</label><select class="field" id="vch"><option value="">Todos os canais</option>${channels.map((c) => `<option ${VF.channel === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div id="video-grid"></div>
      </section>`;
  }
  function renderVideoGrid() {
    const box = document.getElementById('video-grid'); if (!box) return;
    const q = norm(VF.q);
    const list = VIDEOS.filter((v) => (!VF.channel || v.channel === VF.channel) && (!q || norm(v.title + ' ' + v.channel).includes(q)));
    const page = list.slice(0, VF.shown);
    box.innerHTML = `<p class="small muted" style="margin-bottom:12px">${list.length} vídeo(s).</p>` + (page.length ? `<div class="vcards">${page.map(videoCard).join('')}</div>` : '<div class="empty">Nenhum vídeo com esses filtros.</div>') + (list.length > page.length ? `<div class="more" style="margin-top:18px"><button type="button" class="btn" data-more-videos>Mostrar mais</button></div>` : '');
  }
  function viewMacro() {
    const ck = D.ipcaCheck;
    return `${phead('Indicadores', 'Indicadores Macroeconômicos', 'Juros, inflação, câmbio, atividade, emprego e demografia. Séries oficiais do Banco Central e do IBGE, com todo o histórico disponível.', pill('Séries', SERIES.filter((s) => s.group === 'macro').length) + pill('Fontes', 'BCB · IBGE'))}
      <section class="section">${kpis(['selic_meta', 'ipca_12m', 'ipca_mensal', 'cambio_usd', 'ibcbr', 'desocupacao_br'])}</section>
      <section class="section"><div class="grid-2">${chartCard(['selic_meta'])}${chartCard(['ipca_12m'])}${chartCard(['cambio_usd'])}${chartCard(['desocupacao_sc', 'desocupacao_br'], { title: 'Taxa de desocupação: SC e Brasil', labels: ['Santa Catarina', 'Brasil'] })}</div></section>
      ${ck ? `<section class="section"><div class="card" style="display:grid;gap:8px"><h3>IPCA da sua planilha conferido com o Banco Central</h3><p>${ck.divergences.length ? `${ck.divergences.length} divergência(s) em ${ck.compared} meses comparados: ${ck.divergences.slice(0, 6).map((d) => `${fmtPeriod(d.d)} (planilha ${nf(d.planilha, 2)}% × BCB ${nf(d.bcb, 2)}%)`).join('; ')}.` : `Os ${ck.compared} meses em comum (a partir de jan/2006) são idênticos à série oficial SGS 433. ${ck.withoutPair} meses anteriores da planilha não foram comparados, pois o painel armazena o IPCA a partir de 2006.`} O painel usa a série oficial do BCB.</p><p class="note">Arquivo: ${esc(ck.file)} · importado em ${fmtStamp(ck.importedAt)}.</p></div></section>` : ''}
      ${explorer('macro')}`;
  }
  function viewSetorial() {
    return `${phead('Indicadores', 'Indicadores Setoriais', 'Custos da construção (CUB/SC, INCC-M e SINAPI) e crédito imobiliário, com todo o histórico disponível. CUB e INCC vêm da sua planilha; SINAPI e crédito, das APIs oficiais.', pill('Séries', SERIES.filter((s) => s.group === 'setorial').length) + (S.cub_sc_res && S.cub_sc_res.importedAt ? pill('Planilha importada', fmtStamp(S.cub_sc_res.importedAt)) : ''))}
      <section class="section">${kpis(['cub_sc_res', 'cub_sc_res_12m', 'cub_sc_com', 'incc_m_12m', 'sinapi_sc_m2', 'fin_imob_taxa'])}</section>
      <section class="section"><div class="shead"><h2>Custos da construção</h2></div><div class="grid-2">
        ${chartCard(['cub_sc_res', 'cub_sc_com'], { title: 'CUB/SC: residencial e comercial médio', labels: ['Residencial médio', 'Comercial médio'], note: 'Valores nominais em R$/m². O comercial médio só tem dados a partir de out/2024 na planilha. Projeto-padrão de referência a confirmar.' })}
        ${chartCard(['cub_sc_res_12m', 'incc_m_12m', 'sinapi_sc_12m', 'ipca_12m'], { title: 'Custos em 12 meses: CUB/SC, INCC-M, SINAPI-SC e IPCA', labels: ['CUB/SC residencial', 'INCC-M (Brasil)', 'SINAPI (SC)', 'IPCA (Brasil)'], note: 'Todas em % acumulado em 12 meses. CUB e INCC-M foram calculados pelo painel a partir dos níveis e das taxas mensais (por capitalização). Cestas e metodologias diferem.' })}
        ${chartCard(['sinapi_sc_material', 'sinapi_sc_mao'], { title: 'SINAPI-SC: material e mão de obra', labels: ['Material', 'Mão de obra'], note: 'Componentes do custo médio do m² em SC (R$/m², nominal).' })}
        ${chartCard(['incc_m_mensal'], { title: 'INCC-M: variação mensal' })}
      </div></section>
      <section class="section"><div class="shead"><h2>Crédito imobiliário</h2></div><div class="grid-2">${chartCard(['fin_imob_concessoes', 'fin_imob_concessoes_mercado'], { title: 'Concessões de financiamento imobiliário (PF)', labels: ['Total', 'Taxas de mercado'] })}${chartCard(['fin_imob_taxa'])}${chartCard(['fin_imob_inadimplencia'])}${chartCard(['fin_imob_prazo'])}</div></section>
      ${explorer('setorial')}`;
  }
  const AREAS = {
    mundo: { geo: 'Mundo', charts: [['cambio_usd']], intro: 'Tendências internacionais com possível repercussão no Brasil. A conexão é explicada caso a caso, sem supor que o que acontece lá fora vai se repetir aqui.' },
    brasil: { geo: 'Brasil', charts: [['selic_meta'], ['fin_imob_taxa'], ['ipca_12m'], ['fin_imob_concessoes'], ['incc_m_12m'], ['ibcbr']], intro: 'Economia, crédito imobiliário, custos e preços em escala nacional.' },
    sc: { geo: 'Santa Catarina', charts: [['cub_sc_res'], ['sinapi_sc_12m', 'sinapi_br_12m'], ['desocupacao_sc', 'desocupacao_br'], ['pop_sc']], intro: 'Dinâmica estadual. As médias de SC servem de contexto e não devem ser aplicadas diretamente a municípios.' },
    joinville: { geo: 'Joinville', charts: [['pop_joinville'], ['pib_joinville']], intro: 'Lançamentos e vendas, população, atividade e legislação urbanística. A cobertura por bairro e tipologia depende de dados ainda não disponíveis.' },
    itapoa: { geo: 'Itapoá', charts: [['pop_itapoa'], ['pib_itapoa']], intro: 'Município com forte crescimento e influência portuária. A expansão do porto é tratada como vetor a investigar, e não como prova de demanda residencial.' },
  };
  function viewArea(key) {
    const A = AREAS[key];
    const ind = SERIES.filter((s) => s.areas.includes(key));
    const geoNews = NEWS.filter((n) => n.geo === A.geo || (key === 'sc' && ['Joinville', 'Itapoá'].includes(n.geo))).slice(0, 6);
    const cur = CUR_NEWS.filter((n) => n.area === key).sort((a, b) => b.date.localeCompare(a.date));
    return `${phead('Escala geográfica', LABEL[key], A.intro)}
      ${synthesis(key)}
      ${ind.length ? `<section class="section"><div class="shead"><h2>Indicadores</h2><p>Clique em uma linha para abrir a série.</p></div>${indicatorTable(ind)}</section>` : ''}
      <section class="section"><div class="shead"><h2>Séries históricas</h2><p>Passe o cursor ou toque para ver valores. Linhas interrompidas indicam períodos sem dado.</p></div><div class="grid-2">${A.charts.map((ids) => chartCard(ids, ids.length > 1 ? { title: S[ids[0]].name.replace(/\s*\((SC|Brasil)\)\s*$/, '') + ': SC e Brasil', labels: ['Santa Catarina', 'Brasil'] } : {})).join('')}</div></section>
      ${manualTable(key)}
      ${analysisList(cur)}
      <section class="section"><div class="shead"><h2>Notícias recentes: ${esc(A.geo)}</h2><a href="#noticias" data-geo="${esc(A.geo)}">Ver todas</a></div>${geoNews.length ? `<div class="ncards">${geoNews.map((n) => newsCard(n)).join('')}</div>` : `<div class="empty">Nenhuma notícia classificada para ${esc(A.geo)} no histórico até agora.</div>`}</section>
      ${gapsBlock(key)}`;
  }
  function viewFontes() {
    const srcs = arr(C.sources);
    const sched = RUNS.some((r) => r.trigger === 'agendado');
    const ns = (D.news && D.news.sources) || {}; const vc = (D.videos && D.videos.channels) || {}; const api = (D.videos && D.videos.api) || {};
    const ck = D.ipcaCheck;
    return `${phead('Governança de dados', 'Fontes e método', 'A prioridade é a origem oficial. Fontes setoriais, imprensa, vídeos e LinkedIn entram como sinal e não são tratados como verdade sem validação independente.', pill('Execuções registradas', RUNS.length) + pill('Agendamento', sched ? 'ativo' : 'não ativado'))}
      <section class="section"><div class="card" style="display:grid;gap:8px"><h2>Atualização automática</h2><p>${sched ? `Execução agendada registrada.` : '<b>Coletor pronto e testado; agendamento ainda não ativado.</b> As execuções abaixo foram disparadas manualmente. A rotina diária das 07h15 (America/Sao_Paulo) passa a valer quando for ativada no GitHub Actions ou no Agendador de Tarefas do Windows (instruções no README).'}</p><p class="note">A rotina diária não usa inteligência artificial: é um script que consulta APIs e feeds e não consome tokens. Cada série segue o calendário de divulgação da fonte. Em caso de falha, o último dado válido é preservado com a data dele.</p></div></section>
      <section class="section"><div class="shead"><h2>Catálogo de fontes</h2><p>${srcs.length} fontes</p></div><div class="grid-3">${srcs.map((x) => { const st = SRC_STATUS[x.status] || SRC_STATUS.planejado; return `<article class="card src"><div class="toolbar"><span class="chip">${esc(x.type)}</span><span class="chip ${st[0]}">${ICON[st[1]]}${st[2]}</span></div><h3>${esc(x.name)}</h3><p class="small" style="color:var(--fg-2)">${esc(x.covers)}</p>${x.statusNote ? `<p class="note">${esc(x.statusNote)}</p>` : ''}<div class="row"><span>${esc(x.cadence)}</span><span>${esc(x.access)}</span></div>${x.url ? `<a class="small" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir fonte ↗</a>` : '<span class="small muted">Perfil ainda não confirmado. Nenhuma publicação foi atribuída por semelhança de nome.</span>'}</article>`; }).join('')}</div></section>
      <section class="section"><div class="shead"><h2>Feeds de notícias</h2><p>Situação da última varredura de cada site.</p></div><div class="table-wrap"><table><thead><tr><th>Fonte</th><th>Última tentativa</th><th>Último sucesso</th><th class="num">Lidos</th><th class="num">Relevantes</th><th class="num">Novos</th><th>Situação</th></tr></thead><tbody>${Object.keys(ns).map((k) => { const x = ns[k]; return `<tr><td><b>${esc(k)}</b></td><td class="mono small">${fmtStamp(x.lastAttempt)}</td><td class="mono small">${fmtStamp(x.lastSuccess)}</td><td class="num">${x.read}</td><td class="num">${x.accepted}</td><td class="num">${x.added}</td><td>${x.lastError ? `<span class="chip crit">${ICON.critico}Falha</span><span class="sub small">${esc(x.lastError.slice(0, 90))}</span>` : `<span class="chip ok">${ICON.ok}OK</span>`}</td></tr>`; }).join('')}</tbody></table></div></section>
      <section class="section"><div class="shead"><h2>Canais de vídeo</h2><p>${api.keyConfigured ? `API do YouTube configurada. Cota estimada na última execução: ${api.unitsEstimated || 0} unidades (limite gratuito: 10.000/dia).` : 'Sem chave da API do YouTube: coleta só pelo RSS dos canais, que oscila. Com a chave, o coletor usa a API como alternativa.'}</p></div><div class="table-wrap"><table><thead><tr><th>Canal</th><th>Via</th><th>Último sucesso</th><th class="num">Novos</th><th>Situação</th></tr></thead><tbody>${Object.keys(vc).map((k) => { const x = vc[k]; return `<tr><td><b>${esc(k)}</b></td><td>${esc(x.via || '—')}</td><td class="mono small">${fmtStamp(x.lastSuccess)}</td><td class="num">${x.added}</td><td>${x.lastError && !x.via ? `<span class="chip warn">${ICON.atencao}Indisponível</span><span class="sub small">${esc(x.lastError.slice(0, 80))}</span>` : `<span class="chip ok">${ICON.ok}OK</span>`}</td></tr>`; }).join('')}</tbody></table></div></section>
      ${ck ? `<section class="section"><div class="card" style="display:grid;gap:6px"><h2>Planilha de índices setoriais</h2><p>Arquivo <b>${esc(ck.file)}</b>, importado em ${fmtStamp(ck.importedAt)} (SHA-256 ${esc(String(ck.sha256).slice(0, 12))}…). Fontes indicadas na planilha: CUB: ${arr(ck.sources && ck.sources.cub).map(esc).join(', ')}; INCC: ${esc(ck.sources && ck.sources.incc)}; IPCA: ${esc(ck.sources && ck.sources.ipca)}.</p><p class="note">Para atualizar CUB e INCC: salve a planilha e rode <code>pwsh -File scripts/importar-planilha.ps1 -Caminho "…\\Indices CUB INCC IPCA.xlsx"</code>. O IPCA da planilha é usado só para conferência com o BCB.</p></div></section>` : ''}
      <section class="section"><div class="shead"><h2>Séries</h2></div><div class="table-wrap"><table><thead><tr><th>Série</th><th>Fonte</th><th>Grupo</th><th>Último período</th><th>Último sucesso</th><th>Situação</th></tr></thead><tbody>${SERIES.map((s) => `<tr class="clickable" data-open="${s.id}" tabindex="0"><td><b>${esc(s.name)}</b><span class="sub">${esc(s.unit)}</span></td><td class="small">${esc(s.source)}</td><td class="small">${s.group === 'setorial' ? 'Setorial' : 'Macro'}</td><td>${fmtPeriod(s.last)}</td><td class="mono small">${fmtStamp(s.connector === 'manual' ? s.importedAt : s.lastSuccess)}</td><td>${stateChip(s.state)}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="section"><div class="shead"><h2>Registro de execuções</h2></div><div class="table-wrap"><table><thead><tr><th>Execução</th><th>Disparo</th><th>Início</th><th class="num">Séries novas</th><th class="num">Sem novidade</th><th class="num">Falhas</th><th class="num">Notícias +</th><th class="num">Vídeos +</th></tr></thead><tbody>${[...RUNS].reverse().map((r) => `<tr><td class="mono small">${esc(r.id)}</td><td>${r.trigger === 'agendado' ? 'Agendado' : 'Manual'}</td><td class="mono small">${fmtStamp(r.start)}</td><td class="num">${r.summary.ok}</td><td class="num">${r.summary.sem_novidade}</td><td class="num">${r.summary.falha}${r.summary.falha ? `<span class="sub">${r.results.filter((x) => x.status === 'falha').map((x) => esc(x.id)).join(', ')}</span>` : ''}</td><td class="num">${r.content && r.content.newsAdded != null ? r.content.newsAdded : '—'}</td><td class="num">${r.content && r.content.videosAdded != null ? r.content.videosAdded : '—'}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="section"><div class="card method"><h2>Método</h2>
        <h3>Fluxo de dados</h3><ul><li><b>Coleta:</b> APIs SGS (BCB) e SIDRA (IBGE), planilha importada, feeds RSS e YouTube (RSS e API oficial), com novas tentativas.</li><li><b>Validação:</b> limites, saltos, datas duplicadas, série que encolhe e respostas que não são JSON. Dados reprovados não são publicados.</li><li><b>Armazenamento:</b> respostas brutas quando mudam, histórico por série, revisões, histórico acumulativo de notícias e vídeos.</li><li><b>Publicação:</b> data/bundle.js, o único arquivo que o site lê.</li></ul>
        <h3>Notícias</h3><ul><li>Fontes do setor (CBIC, Secovi-SP, SindusCon, Portas, Imobi Report e outras) entram integralmente.</li><li>Veículos gerais só entram com termo forte no título (por exemplo imobiliário, incorporação, CUB, MCMV) ou com pontuação alta de termos do setor.</li><li>Duplicatas são eliminadas por endereço normalizado e por título.</li><li>O resumo é o trecho do próprio feed, limitado a cerca de 320 caracteres; o texto completo fica no site original. A imagem vem do feed ou da etiqueta og:image da página.</li></ul>
        <h3>Vídeos</h3><ul><li>Primeiro o RSS dos canais monitorados (não usa cota). Se falhar e houver chave, a API (playlistItems, 1 unidade por canal). Com chave, também até 2 buscas por tema por dia (100 unidades cada), em rodízio. Estimativa: cerca de 200 a 215 unidades por dia, de um limite gratuito de 10.000.</li><li>Canais gerais passam pelo mesmo filtro de relevância das notícias.</li></ul>
        <h3>Natureza das medidas</h3><ul><li>Taxa mensal, acumulado em 12 meses, taxa anual e nível de índice nunca são somados entre si. Acumulados vêm da fonte ou são calculados por capitalização composta.</li><li>Valores em reais são nominais. Variações de taxas aparecem em p.p.; de níveis, em %.</li><li>Preço anunciado não equivale a preço transacionado.</li></ul>
        <h3>VSO</h3><p>VSO do período = vendas do período ÷ (estoque final + vendas do período). Valores calculados aqui com dados secundários são marcados como cálculo próprio.</p>
        <h3>Publicações de especialistas fornecidas</h3><p>Os links do LinkedIn exigem login e não foram acessados nem validados.</p><ul>${arr(C.linkedinPosts).map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a> <span class="muted small">não verificado</span></li>`).join('')}</ul>
      </div></section>`;
  }

  /* ================= roteamento ================= */
  let current = 'visao';
  function render() {
    let key = (location.hash || '#visao').slice(1);
    if (key === 'indicadores') key = 'macro';
    current = LABEL[key] ? key : 'visao';
    document.querySelectorAll('.nav a').forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === '#' + current ? 'page' : 'false'));
    const views = { visao: viewVisao, alertas: viewAlertas, noticias: viewNoticias, videos: viewVideos, macro: viewMacro, setorial: viewSetorial, fontes: viewFontes };
    main.innerHTML = (views[current] || (() => viewArea(current)))();
    mountCharts(main);
    if (current === 'noticias') renderNewsGrid();
    if (current === 'videos') renderVideoGrid();
    if (current === 'macro' || current === 'setorial') { renderList(current); renderDetail(current); }
    document.title = (current === 'visao' ? '' : LABEL[current] + ' · ') + 'Pulso Imobiliário';
    document.getElementById('top-title').textContent = LABEL[current];
    document.getElementById('app').classList.remove('menu-open');
    document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');
  }
  function openSeries(id) {
    const g = groupOf(id); EXP[g].id = id; EXP[g].cmp = ''; store.set('serie:' + g, id);
    if (current === g) { renderList(g); renderDetail(g); } else { location.hash = '#' + g; }
    setTimeout(() => { const el = document.getElementById('explorer'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  }

  /* ================= eventos ================= */
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const close = t.closest('[data-close]'); if (close) { closeDialog(close.closest('dialog')); return; }
    if (t.tagName === 'DIALOG') { closeDialog(t); return; }
    const play = t.closest('[data-play]'); if (play) { openVideo(play.dataset.play); return; }
    if (t.closest('[data-fs]')) { const pl = document.getElementById('player'); if (pl && pl.requestFullscreen) pl.requestFullscreen().catch(() => {}); return; }
    const nw = t.closest('[data-news]'); if (nw) { openNews(nw.dataset.news); return; }
    const open = t.closest('[data-open]'); if (open && !t.closest('a[href^="http"]')) { ev.preventDefault(); openSeries(open.dataset.open); return; }
    const geoLink = t.closest('a[data-geo]'); if (geoLink) { NF.geo = geoLink.dataset.geo; NF.shown = 24; }
    const pick = t.closest('[data-pick]'); if (pick) { const g = groupOf(pick.dataset.pick); EXP[g].id = pick.dataset.pick; EXP[g].cmp = ''; store.set('serie:' + g, EXP[g].id); renderList(g); renderDetail(g); return; }
    const pre = t.closest('[data-preset]'); if (pre) { const st = EXP[pre.dataset.g]; st.preset = pre.dataset.preset; st.from = ''; st.to = ''; renderDetail(pre.dataset.g); return; }
    const rs = t.closest('[data-reset]'); if (rs) { const st = EXP[rs.dataset.reset]; st.preset = 'tudo'; st.from = ''; st.to = ''; renderDetail(rs.dataset.reset); return; }
    const tb = t.closest('[data-table]'); if (tb) { EXP[tb.dataset.table].table = !EXP[tb.dataset.table].table; renderDetail(tb.dataset.table); return; }
    const nt = t.closest('[data-ntheme]'); if (nt) { NF.theme = nt.dataset.ntheme; NF.shown = 24; document.querySelectorAll('[data-ntheme]').forEach((b) => b.setAttribute('aria-pressed', b === nt)); renderNewsGrid(); return; }
    if (t.closest('[data-more-news]')) { NF.shown += 24; renderNewsGrid(); return; }
    if (t.closest('[data-more-videos]')) { VF.shown += 24; renderVideoGrid(); return; }
    const csv = t.closest('[data-csv]');
    if (csv) {
      const g = csv.dataset.g; const text = csvFor(g); const msg = document.getElementById('csv-msg-' + g);
      if (csv.dataset.csv === 'copy') {
        try { navigator.clipboard.writeText(text).then(() => { msg.textContent = 'CSV copiado.'; }, () => { msg.textContent = 'Não foi possível copiar. Use "Ver dados em tabela".'; }); } catch (e) { msg.textContent = 'Não foi possível copiar. Use "Ver dados em tabela".'; }
      } else {
        try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = `pulso_${EXP[g].id}.csv`; document.body.appendChild(a); a.click(); a.remove(); msg.textContent = 'Download iniciado.'; } catch (e) { msg.textContent = 'Download indisponível. Use "Copiar CSV".'; }
      }
    }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('tr[data-open]')) ev.target.click(); });
  document.addEventListener('change', (ev) => {
    const id = ev.target.id;
    if (/^cmp-/.test(id)) { const g = id.slice(4); EXP[g].cmp = ev.target.value; renderDetail(g); }
    if (/^(from|to)-/.test(id)) { const [k, g] = id.split('-'); EXP[g].preset = 'custom'; EXP[g][k] = ev.target.value; renderDetail(g); }
    if (id === 'nsrc') { NF.source = ev.target.value; NF.shown = 24; renderNewsGrid(); }
    if (id === 'ngeo') { NF.geo = ev.target.value; NF.shown = 24; renderNewsGrid(); }
    if (id === 'ndays') { NF.days = ev.target.value; NF.shown = 24; renderNewsGrid(); }
    if (id === 'vch') { VF.channel = ev.target.value; VF.shown = 24; renderVideoGrid(); }
  });
  let qt;
  document.addEventListener('input', (ev) => {
    const id = ev.target.id; clearTimeout(qt);
    qt = setTimeout(() => {
      if (id === 'nq') { NF.q = ev.target.value.trim(); NF.shown = 24; renderNewsGrid(); }
      if (id === 'vq') { VF.q = ev.target.value.trim(); VF.shown = 24; renderVideoGrid(); }
      if (/^sq-/.test(id)) { const g = id.slice(3); EXP[g].q = ev.target.value; renderList(g); const f = document.getElementById(id); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
    }, 180);
  });
  document.getElementById('menu-btn').addEventListener('click', () => { const app = document.getElementById('app'); const open = !app.classList.contains('menu-open'); app.classList.toggle('menu-open', open); document.getElementById('menu-btn').setAttribute('aria-expanded', open); });
  document.getElementById('scrim').addEventListener('click', () => document.getElementById('app').classList.remove('menu-open'));
  document.getElementById('video-modal').addEventListener('close', (e) => { e.target.innerHTML = ''; });
  window.addEventListener('hashchange', render);
  let rt; window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      main.querySelectorAll('[data-chart]').forEach((el) => { if (!el.closest('[id^="detail-"]')) drawChart(el, el.dataset.chart.split(',')); });
      if (current === 'macro' || current === 'setorial') renderDetail(current);
    }, 150);
  });

  renderNav();
  render();
})();
