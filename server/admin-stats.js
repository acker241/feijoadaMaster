/* Tela de estatisticas de visita do painel. */
"use strict";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SECOES = [
  ["comece", "Comece aqui"], ["rede", "Rede de relações"], ["dinheiro", "Caminho do dinheiro"],
  ["escala", "Escala do dano"], ["linha", "Linha do tempo"], ["quem", "Quem é quem"],
  ["fontes", "Fontes e avisos"], ["creditos", "Imagens e licenças"], ["glossario", "Glossário"],
  ["errata-sec", "Errata"], ["contato", "Fale com o site"],
];
const BUSCAS = { rede: "busca na rede", quem: "busca em Quem é quem", glossario: "busca no glossário" };
const PERIODOS = [7, 30, 90, 365];

const CSS = `
:root{--paper:#FAF4E8;--surface:#FFFBF3;--surface-2:#F3E9D8;--ink:#241B14;--ink-2:#564636;--ink-3:#897463;
--rule:#E5D9C4;--rule-strong:#C8B69A;--dende:#9C7A16;--dende-2:#E4D3A0;--vinho:#A62449;--verde:#5A8A24;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#16120F;--surface:#1E1813;--surface-2:#2A221B;--ink:#F7F0E2;
--ink-2:#D5C5AE;--ink-3:#9E8C77;--rule:#342A22;--rule-strong:#4D4033;--dende:#C9A63A;--dende-2:#5A4A1E;--vinho:#C94A6B;--verde:#719C31;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 Karla,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px 18px 80px}
h1{font-size:24px;margin:0 0 2px;letter-spacing:-.02em}h1 span{color:var(--dende)}
h2{font-size:15px;margin:0 0 10px;letter-spacing:-.01em}
.sub{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
a{color:inherit}
.tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:20px 0 18px;padding-bottom:12px;border-bottom:1px solid var(--rule-strong)}
.tab{font-size:13px;font-weight:700;text-decoration:none;color:var(--ink-3);border:1px solid var(--rule-strong);border-radius:999px;padding:5px 11px}
.tab.on{background:var(--surface-2);color:var(--ink);border-color:var(--ink-3)}
.sp{flex:1}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.tile{border:1px solid var(--rule);background:var(--surface);padding:12px 14px}
.tile .v{font-size:26px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.2}
.tile .l{font-size:12.5px;color:var(--ink-3)}
.caixa{border:1px solid var(--rule);background:var(--surface);padding:14px 16px;margin-bottom:14px}
.grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.grade .caixa{margin:0}
.graf{overflow-x:auto}
.graf svg{display:block;width:100%;min-width:520px;height:auto}
.legenda{display:flex;gap:14px;font-size:12.5px;color:var(--ink-3);margin-top:6px}
.legenda i{display:inline-block;width:10px;height:10px;margin-right:5px;vertical-align:-1px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
td{padding:4px 0;vertical-align:middle}
td.n{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,monospace;font-size:12.5px;width:1%;white-space:nowrap;padding-left:10px}
td.rot{width:42%;padding-right:10px;overflow-wrap:anywhere}
.barra{height:8px;background:var(--dende);min-width:1px}
.vazio{color:var(--ink-3);font-size:13.5px}
.nota{font-size:12.5px;color:var(--ink-3);margin-top:18px;max-width:760px}
`;

function pagina(titulo, corpo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)}</title><style>${CSS}</style></head><body>${corpo}</body></html>`;
}

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR");
function duracao(s) {
  if (!s) return "—";
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m}min ${String(r).padStart(2, "0")}s` : `${r}s`;
}

/* dias sem evento tambem aparecem, com zero */
function serie(diario, dias, hoje) {
  const por = new Map(diario.map((d) => [d.dia, d]));
  const out = [];
  const base = new Date(hoje + "T12:00:00Z");
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10);
    out.push({ dia: d, visitantes: por.get(d)?.visitantes || 0, views: por.get(d)?.views || 0 });
  }
  return out;
}

function grafico(pts) {
  const W = 1000, H = 220, pe = 22, topo = 12, esq = 34;
  const max = Math.max(1, ...pts.map((p) => p.views));
  const passo = (W - esq) / pts.length;
  const larg = Math.max(1, passo * 0.72);
  const y = (v) => topo + (H - topo - pe) * (1 - v / max);
  const marcas = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const cada = Math.ceil(pts.length / 10);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visitantes e visualizações por dia">`;
  for (const v of marcas) {
    s += `<line x1="${esq}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)"/>`
      + `<text x="${esq - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--ink-3)">${fmt(v)}</text>`;
  }
  pts.forEach((p, i) => {
    const x = esq + i * passo + (passo - larg) / 2;
    const rot = `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}`;
    s += `<g><title>${rot}: ${fmt(p.visitantes)} visitante(s), ${fmt(p.views)} visualização(ões)</title>`
      + `<rect x="${x}" y="${y(p.views)}" width="${larg}" height="${H - pe - y(p.views)}" fill="var(--dende-2)"/>`
      + `<rect x="${x}" y="${y(p.visitantes)}" width="${larg}" height="${H - pe - y(p.visitantes)}" fill="var(--dende)"/></g>`;
    if (i % cada === 0 || i === pts.length - 1) {
      s += `<text x="${x + larg / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--ink-3)">${rot}</text>`;
    }
  });
  return s + "</svg>";
}

function lista(titulo, linhas, rotulo = (a) => a, total = null, vazio = "Nada no período.") {
  if (!linhas.length) return `<div class="caixa"><h2>${esc(titulo)}</h2><p class="vazio">${esc(vazio)}</p></div>`;
  const max = Math.max(1, ...linhas.map((l) => l.n));
  const tr = linhas.map((l) => `<tr><td class="rot">${esc(rotulo(l.alvo))}</td>
    <td><div class="barra" style="width:${(100 * l.n / max).toFixed(1)}%"></div></td>
    <td class="n">${fmt(l.n)}${total ? ` · ${Math.round(100 * l.n / total)}%` : ""}</td></tr>`).join("");
  return `<div class="caixa"><h2>${esc(titulo)}</h2><table>${tr}</table></div>`;
}

exports.stats = (r) => {
  const pts = serie(r.diario, r.dias, r.hoje);
  const hoje = pts[pts.length - 1];
  const ontem = pts[pts.length - 2] || { visitantes: 0 };
  const views = pts.reduce((a, p) => a + p.views, 0);
  const acao = Object.fromEntries(r.acoes.map((a) => [a.alvo, a.n]));
  const porSec = new Map(r.secoes.map((s) => [s.alvo, s.n]));
  const secoes = SECOES.map(([id, nome]) => ({ alvo: nome, n: porSec.get(id) || 0 }));

  const periodos = PERIODOS.map((d) => `<a class="tab ${d === r.dias ? "on" : ""}" href="/admin/stats?dias=${d}">${d} dias</a>`).join("");
  const tiles = [
    [fmt(hoje.visitantes), "visitantes hoje"],
    [fmt(ontem.visitantes), "visitantes ontem"],
    [fmt(r.visitas), `visitas em ${r.dias} dias`],
    [(r.visitas / r.dias).toLocaleString("pt-BR", { maximumFractionDigits: 1 }), "média de visitas por dia"],
    [fmt(views), "visualizações da página"],
    [duracao(r.tempo.mediana), "tempo mediano na página"],
    [fmt(acao.msg_ok), "mensagens enviadas pelo formulário"],
  ].map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

  const nomeLig = (a) => a.split("~").map((id) => r.nomes[id] || id).join(" — ");
  const nomeRef = (a) => {
    const [t, id] = a.split(":");
    const tipo = { glos: "glossário", verb: "ficha", sec: "seção", passo: "passo" }[t] || t;
    return `${tipo}: ${(t === "glos" ? r.termos[id] : r.nomes[id]) || id || ""}`;
  };

  return pagina("Estatísticas — Feijoada do Master", `
<div class="wrap">
  <p class="sub">Painel · estatísticas de visita</p>
  <h1>Feijoada <span>do Master</span></h1>
  <div class="tabs">${periodos}<span class="sp"></span>
    <a class="tab" href="/admin">mensagens</a><a class="tab" href="/admin/conteudo">editar conteúdo</a><a class="tab" href="/admin/sair">sair</a></div>

  <div class="tiles">${tiles}</div>

  <div class="caixa">
    <h2>Por dia</h2>
    <div class="graf">${grafico(pts)}</div>
    <div class="legenda"><span><i style="background:var(--dende)"></i>visitantes</span><span><i style="background:var(--dende-2)"></i>visualizações (inclui recarregar)</span></div>
  </div>

  <div class="grade">
    ${lista("Até onde leram — visitas que chegaram a cada seção", secoes, (a) => a, r.visitas)}
    <div style="display:grid;gap:14px;align-content:start">
      ${lista("De onde vieram", r.origens, (a) => a, r.visitas)}
      ${lista("Aparelho", r.disps, (a) => a, r.visitas)}
    </div>
    ${lista("Fichas abertas na rede", r.nos, (a) => r.nomes[a] || a)}
    ${lista("Ligações abertas na rede", r.ligacoes, nomeLig)}
    ${lista("Trilhas do dinheiro escolhidas", r.trilhas, (a) => r.nomesTr[a] || a)}
    ${lista("Termos e atalhos clicados no texto", r.refs, nomeRef)}
    ${lista("Links de fonte clicados (site de destino)", r.fontes)}
    ${lista("Usaram a busca", r.buscas, (a) => BUSCAS[a] || a)}
  </div>

  <p class="nota">Sem cookie e sem IP guardado: cada visitante vira um código que muda todo dia, então quem volta amanhã conta de novo, e as somas de período são visitas, não pessoas. Robôs conhecidos e quem bloqueia JavaScript não entram. Tempo na página conta só com a aba visível. Os eventos são apagados depois de 400 dias.${acao.copiar ? ` Texto do formulário copiado ${fmt(acao.copiar)} vez(es).` : ""}</p>
</div>`);
};
