/* Telas do monitor de noticias no painel: fila de triagem e cadastro de veiculos. */
"use strict";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STATUS = [["novo", "novas"], ["relevante", "relevantes"], ["usado", "usadas no site"], ["descartado", "descartadas"], ["todas", "todas"]];
const GRUPOS = ["grande", "independente", "especializado", "regional", "outros"];

const CSS = `
:root{--paper:#FAF4E8;--surface:#FFFBF3;--surface-2:#F3E9D8;--ink:#241B14;--ink-2:#564636;--ink-3:#897463;
--rule:#E5D9C4;--rule-strong:#C8B69A;--dende:#9C7A16;--vinho:#A62449;--verde:#5A8A24;--azul:#3355A8;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#16120F;--surface:#1E1813;--surface-2:#2A221B;--ink:#F7F0E2;
--ink-2:#D5C5AE;--ink-3:#9E8C77;--rule:#342A22;--rule-strong:#4D4033;--dende:#C9A63A;--vinho:#C94A6B;--verde:#719C31;--azul:#5C7FD0;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 Karla,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px 18px 80px}
h1{font-size:24px;margin:0 0 2px;letter-spacing:-.02em}h1 span{color:var(--dende)}
.sub{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
a{color:inherit}
.tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:20px 0 12px;padding-bottom:12px;border-bottom:1px solid var(--rule-strong)}
.tab{font-size:13px;font-weight:700;text-decoration:none;color:var(--ink-3);border:1px solid var(--rule-strong);border-radius:999px;padding:5px 11px}
.tab.on{background:var(--surface-2);color:var(--ink);border-color:var(--ink-3)}
.tab b{font-family:ui-monospace,monospace;font-weight:500;color:var(--dende)}
.sp{flex:1}
.filtros{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}
select,input[type=text],input[type=search]{font:14px Karla,sans-serif;padding:6px 9px;border:1px solid var(--rule-strong);background:var(--surface);color:var(--ink);border-radius:2px;max-width:100%}
button{font:700 12.5px Karla,sans-serif;background:none;border:1px solid var(--rule-strong);color:var(--ink-2);padding:6px 11px;border-radius:2px;cursor:pointer}
button:hover{color:var(--ink);border-color:var(--ink-3)}
button.pri{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.status{font-size:13px;color:var(--ink-2);border-left:3px solid var(--dende);background:var(--surface);padding:9px 13px;margin-bottom:14px}
.item{border:1px solid var(--rule);background:var(--surface);padding:12px 15px;margin-bottom:10px}
.item h3{font-size:15.5px;margin:0 0 3px;line-height:1.35;font-weight:700}
.item h3 a{text-decoration:none}.item h3 a:hover{text-decoration:underline}
.meta{font-family:ui-monospace,monospace;font-size:11px;color:var(--ink-3)}
.resumo{font-size:13.5px;color:var(--ink-2);margin:6px 0 0}
.tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.tag{font-size:11.5px;border:1px solid var(--rule-strong);border-radius:999px;padding:1px 8px;color:var(--ink-2);text-decoration:none}
.tag:hover{border-color:var(--ink-3);color:var(--ink)}
.selo{font-family:ui-monospace,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border:1px solid currentColor;padding:1px 5px;border-radius:2px;margin-left:6px}
.acoes{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;padding-top:9px;border-top:1px solid var(--rule)}
.acoes input[type=text]{flex:1;min-width:160px}
form.inline{display:contents}
.vazio{color:var(--ink-3);padding:24px 0}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;font-family:ui-monospace,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);padding:6px 6px;border-bottom:1px solid var(--rule-strong)}
td{padding:6px;border-bottom:1px solid var(--rule);vertical-align:top}
td input[type=text]{width:100%;min-width:120px}
.erro{color:var(--vinho);font-size:12px}
`;

function pagina(titulo, corpo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)}</title><style>${CSS}</style></head><body>${corpo}</body></html>`;
}
const dataSP = (d) => d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function topo(sub, ativo) {
  return `<p class="sub">Painel · ${esc(sub)}</p>
  <h1>Feijoada <span>do Master</span></h1>
  <div class="tabs">
    <a class="tab ${ativo === "fila" ? "on" : ""}" href="/admin/noticias">notícias</a>
    <a class="tab ${ativo === "veiculos" ? "on" : ""}" href="/admin/noticias/veiculos">veículos monitorados</a>
    <span class="sp"></span>
    <a class="tab" href="/admin">mensagens</a><a class="tab" href="/admin/conteudo">editar conteúdo</a>
    <a class="tab" href="/admin/stats">estatísticas</a><a class="tab" href="/admin/sair">sair</a>
  </div>`;
}

function linhaStatus(o) {
  const u = o.ultima;
  const quando = u ? `última coleta ${dataSP(u.quando)} · ${u.novas} nova(s) em ${u.segundos}s${u.pessoas ? " · incluiu busca por pessoa" : ""}` : "nenhuma coleta registrada ainda";
  return `<div class="status">${o.rodando ? "<b>Coleta em andamento</b> — recarregue em alguns minutos. " : ""}${esc(quando)}.
    Coleta automática a cada ${o.horas}h; busca por pessoa uma vez por dia.
    <form class="inline" method="post" action="/admin/noticias/coletar"><button type="submit" ${o.rodando ? "disabled" : ""} style="margin-left:8px">coletar agora</button></form>
    ${o.msg ? `<br><b>${esc(o.msg)}</b>` : ""}</div>`;
}

exports.fila = (rows, o) => {
  const qs = (mud) => {
    const f = { ...o.filtro, ...mud };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    const s = p.toString();
    return "/admin/noticias" + (s ? "?" + s : "");
  };
  const volta = qs({});
  const abas = STATUS.map(([s, rot]) =>
    `<a class="tab ${o.filtro.status === s ? "on" : ""}" href="${qs({ status: s })}">${rot} <b>${o.contagens[s] ?? 0}</b></a>`).join("");

  const opPessoa = o.pessoas.map((p) =>
    `<option value="${esc(p.id)}" ${o.filtro.pessoa === p.id ? "selected" : ""}>${esc(o.nomes[p.id] || p.id)} (${p.n})</option>`).join("");
  const opVeiculo = o.veiculos.map((v) =>
    `<option value="${esc(v.dominio)}" ${o.filtro.veiculo === v.dominio ? "selected" : ""}>${esc(v.nome)}</option>`).join("");
  const opGrupo = GRUPOS.map((g) => `<option value="${g}" ${o.filtro.grupo === g ? "selected" : ""}>${g}</option>`).join("");

  const botoes = (r) => ["relevante", "usado", "descartado", "novo"].filter((s) => s !== r.status).map((s) => `
      <form class="inline" method="post" action="/admin/noticias/acao">
        <input type="hidden" name="ids" value="${r.id}"><input type="hidden" name="status" value="${s}"><input type="hidden" name="volta" value="${esc(volta)}">
        <button type="submit">${{ relevante: "relevante", usado: "usada no site", descartado: "descartar", novo: "voltar para novas" }[s]}</button>
      </form>`).join("");

  const itens = rows.length ? rows.map((r) => `
  <article class="item">
    <h3><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.titulo)}</a></h3>
    <div class="meta">${esc(r.veiculo || r.dominio || "?")} · ${dataSP(r.publicado_em || r.encontrado_em)} · via ${esc(r.via || "?")}${o.fontesSite.has(r.dominio) ? `<span class="selo" style="color:var(--verde)">já é fonte do site</span>` : ""}${r.status !== "novo" ? `<span class="selo">${esc(r.status)}</span>` : ""}</div>
    ${r.resumo ? `<p class="resumo">${esc(r.resumo.slice(0, 320))}${r.resumo.length > 320 ? "…" : ""}</p>` : ""}
    ${r.pessoas.length ? `<div class="tags">${r.pessoas.map((p) => `<a class="tag" href="${qs({ pessoa: p })}">${esc(o.nomes[p] || p)}</a>`).join("")}</div>` : ""}
    <div class="acoes">${botoes(r)}
      <form class="inline" method="post" action="/admin/noticias/acao">
        <input type="hidden" name="ids" value="${r.id}"><input type="hidden" name="volta" value="${esc(volta)}">
        <input type="text" name="nota" placeholder="nota interna" value="${esc(r.nota || "")}"><button type="submit">salvar nota</button>
      </form>
    </div>
  </article>`).join("") : `<p class="vazio">Nenhuma notícia com esse filtro.</p>`;

  const lote = rows.length && o.filtro.status === "novo" ? `
    <form method="post" action="/admin/noticias/acao" style="margin:4px 0 14px">
      <input type="hidden" name="ids" value="${rows.map((r) => r.id).join(",")}"><input type="hidden" name="status" value="descartado">
      <input type="hidden" name="volta" value="${esc(volta)}">
      <button type="submit">descartar as ${rows.length} listadas</button>
      ${o.noFiltro > rows.length ? `<button type="submit" name="lote" value="filtro">descartar todas as ${o.noFiltro} deste filtro</button>` : ""}
    </form>` : "";

  return pagina("Notícias — Feijoada do Master", `
<div class="wrap">
  ${topo("monitor de notícias", "fila")}
  ${linhaStatus(o)}
  <div class="tabs" style="margin-top:0">${abas}</div>
  <form class="filtros" method="get" action="/admin/noticias">
    <input type="hidden" name="status" value="${esc(o.filtro.status)}">
    <select name="pessoa"><option value="">todas as pessoas</option>${opPessoa}</select>
    <select name="grupo"><option value="">todos os grupos</option>${opGrupo}</select>
    <select name="veiculo"><option value="">todos os veículos</option>${opVeiculo}</select>
    <input type="search" name="q" placeholder="buscar no título" value="${esc(o.filtro.q || "")}">
    <button class="pri" type="submit">filtrar</button>
    ${o.filtro.pessoa || o.filtro.grupo || o.filtro.veiculo || o.filtro.q ? `<a class="tab" href="${qs({ pessoa: null, grupo: null, veiculo: null, q: null })}">limpar filtros</a>` : ""}
  </form>
  ${lote}
  ${itens}
  <p class="meta" style="margin-top:18px">Mostrando ${Math.min(rows.length, o.limite)} de ${o.noFiltro}, dos mais recentes. Nada aqui entra no site sozinho: correções continuam pelo editor de conteúdo, com motivo na errata. Descartadas somem depois de 60 dias.</p>
</div>`);
};

exports.veiculos = (rows, o) => {
  /* <form> nao pode envolver <td>; cada linha aponta para um form fora da tabela */
  const linha = (v, i) => {
    const f = `fv${i}`;
    return `
  <tr>
    <td><input form="${f}" type="hidden" name="dominio" value="${esc(v.dominio)}"><input form="${f}" type="text" name="nome" value="${esc(v.nome)}"><div class="meta">${esc(v.dominio)}</div></td>
    <td><select form="${f}" name="grupo">${GRUPOS.map((g) => `<option ${g === v.grupo ? "selected" : ""}>${g}</option>`).join("")}</select></td>
    <td><input form="${f}" type="text" name="rss" value="${esc(v.rss || "")}" placeholder="sem RSS próprio"></td>
    <td style="text-align:center"><input form="${f}" type="checkbox" name="busca" value="1" ${v.busca ? "checked" : ""} aria-label="busca no Google News"></td>
    <td style="text-align:center"><input form="${f}" type="checkbox" name="ativo" value="1" ${v.ativo ? "checked" : ""} aria-label="ativo"></td>
    <td class="meta">${dataSP(v.ultima_coleta)}<br>${v.achadas} achada(s)${v.ultimo_erro ? `<div class="erro">${esc(v.ultimo_erro)}</div>` : ""}</td>
    <td><button form="${f}" type="submit">salvar</button></td>
  </tr>`;
  };
  const forms = rows.map((_, i) => `<form id="fv${i}" method="post" action="/admin/noticias/veiculo"></form>`).join("")
    + `<form id="fvnovo" method="post" action="/admin/noticias/veiculo"><input type="hidden" name="novo" value="1"></form>`;
  return pagina("Veículos — Feijoada do Master", `
<div class="wrap">
  ${topo("veículos monitorados", "veiculos")}
  ${o.msg ? `<div class="status"><b>${esc(o.msg)}</b></div>` : ""}
  <p class="meta" style="margin-bottom:12px">Busca = consulta ao Google News restrita ao domínio. RSS = feeds do próprio veículo, separados por espaço (use quando o Google News indexa mal o site). Desmarque "ativo" para parar de monitorar.</p>
  ${forms}
  <div class="tablewrap"><table>
    <thead><tr><th>Veículo</th><th>Grupo</th><th>RSS próprio</th><th>Busca</th><th>Ativo</th><th>Última coleta</th><th></th></tr></thead>
    <tbody>${rows.map(linha).join("")}
    <tr>
      <td><input form="fvnovo" type="text" name="nome" placeholder="nome" required><input form="fvnovo" type="text" name="dominio" placeholder="dominio.com.br" required style="margin-top:4px"></td>
      <td><select form="fvnovo" name="grupo">${GRUPOS.map((g) => `<option>${g}</option>`).join("")}</select></td>
      <td><input form="fvnovo" type="text" name="rss" placeholder="https://…/feed (opcional)"></td>
      <td style="text-align:center"><input form="fvnovo" type="checkbox" name="busca" value="1" checked></td>
      <td style="text-align:center"><input form="fvnovo" type="checkbox" name="ativo" value="1" checked></td>
      <td></td>
      <td><button form="fvnovo" class="pri" type="submit">incluir</button></td>
    </tr>
    </tbody>
  </table></div>
</div>`);
};
