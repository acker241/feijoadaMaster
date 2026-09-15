/* Telas de edicao de conteudo do painel. */
"use strict";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CSS = `
:root{--paper:#FAF4E8;--surface:#FFFBF3;--surface-2:#F3E9D8;--ink:#241B14;--ink-2:#564636;--ink-3:#897463;
--rule:#E5D9C4;--rule-strong:#C8B69A;--dende:#9C7A16;--vinho:#A62449;--verde:#5A8A24;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#16120F;--surface:#1E1813;--surface-2:#2A221B;--ink:#F7F0E2;
--ink-2:#D5C5AE;--ink-3:#9E8C77;--rule:#342A22;--rule-strong:#4D4033;--dende:#C9A63A;--vinho:#C94A6B;--verde:#719C31;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 Karla,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:24px 18px 80px}
h1{font-size:24px;margin:0 0 2px;letter-spacing:-.02em}h1 span{color:var(--dende)}
.sub{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
a{color:inherit}
.tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:20px 0 6px;padding-bottom:12px;border-bottom:1px solid var(--rule-strong)}
.tab{font-size:13px;font-weight:700;text-decoration:none;color:var(--ink-3);border:1px solid var(--rule-strong);
  border-radius:999px;padding:5px 11px}
.tab.on{background:var(--surface-2);color:var(--ink);border-color:var(--ink-3)}
.tab b{font-family:ui-monospace,monospace;font-weight:500;color:var(--dende)}
.sp{flex:1}
.busca{display:flex;gap:8px;margin:14px 0 18px}
.busca input{flex:1;max-width:320px;font:14px Karla,sans-serif;padding:7px 11px;border:1px solid var(--rule-strong);
  background:var(--surface);color:var(--ink);border-radius:999px}
.aviso{font-size:13px;color:var(--ink-2);border-left:3px solid var(--dende);background:var(--surface);padding:10px 14px;margin-bottom:18px}
form.reg{border:1px solid var(--rule);background:var(--surface);padding:12px 14px;margin-bottom:10px;display:grid;gap:8px}
form.reg.novo{border-color:var(--verde);border-left:3px solid var(--verde)}
.linha{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
.campo{display:grid;gap:3px}
.campo label{font-family:ui-monospace,monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-3)}
.campo input,.campo select,.campo textarea{font:14px Karla,sans-serif;padding:6px 9px;border:1px solid var(--rule-strong);
  background:var(--paper);color:var(--ink);border-radius:2px;min-width:90px}
.campo textarea{min-height:60px;width:100%;resize:vertical;line-height:1.45}
.campo.larg{flex:1;min-width:240px}
.campo.full{grid-column:1/-1}
.acoes{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
button{font:700 12.5px Karla,sans-serif;background:none;border:1px solid var(--rule-strong);color:var(--ink-2);
  padding:6px 12px;border-radius:2px;cursor:pointer}
button:hover{color:var(--ink);border-color:var(--ink-3)}
button.pri{background:var(--ink);color:var(--paper);border-color:var(--ink)}
button.del{color:var(--vinho);border-color:var(--vinho)}
.id{font-family:ui-monospace,monospace;font-size:11px;color:var(--ink-3)}
.errata{border-top:1px solid var(--rule);padding:10px 0;font-size:13.5px;color:var(--ink-2)}
.errata .q{font-family:ui-monospace,monospace;font-size:11px;color:var(--ink-3)}
.errata .de{color:var(--vinho);text-decoration:line-through}
.errata .pa{color:var(--verde)}
`;

function pagina(titulo, corpo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)}</title><style>${CSS}</style></head><body><div class="wrap">${corpo}</div></body></html>`;
}

const ENTIDADES = [
  ["verbete", "verbetes"], ["vinculo", "vínculos"], ["evento", "eventos"],
  ["resposta", "respostas"], ["glossario", "glossário"], ["trilha", "trilhas"], ["passo", "passos"],
  ["fase", "fases"], ["fonte", "fontes"], ["barra", "barras"],
];
const TIPOS_RESPOSTA = ["Direito de resposta", "Nota oficial", "Manifestação da defesa",
  "Defesa apresentada ao STF", "Posição nos autos", "Recurso ao STF",
  "Decisão judicial a favor", "Retificação do veículo", "Nota pública de apoio"];

function sel(nome, valor, itens, chave, rotulo) {
  return `<select name="${nome}">` + itens.map((i) =>
    `<option value="${esc(i[chave])}"${String(i[chave]) === String(valor) ? " selected" : ""}>${esc(i[rotulo])}</option>`).join("") + `</select>`;
}

function campos(ent, r, o) {
  const v = (c) => (r ? r[c] : "");
  const arr = (c) => (r && Array.isArray(r[c]) ? r[c].join(" ") : "");
  if (ent === "verbete") return `
    <div class="linha">
      <div class="campo"><label>id</label><input name="id" value="${esc(v("id"))}" ${r ? "readonly" : "required"} size="12"></div>
      <div class="campo larg"><label>nome</label><input name="nome" value="${esc(v("nome"))}" required></div>
      <div class="campo"><label>sigla</label><input name="sigla" value="${esc(v("sigla"))}" size="4" required></div>
      <div class="campo larg"><label>papel</label><input name="papel" value="${esc(v("papel"))}" required></div>
      <div class="campo"><label>categoria</label>${sel("categoria", v("categoria"), o.categorias, "id", "nome")}</div>
      <div class="campo"><label>anel</label>${sel("anel", v("anel"), o.aneis, "nivel", "nome")}</div>
      <div class="campo"><label>ordem</label><input name="ordem" value="${esc(v("ordem"))}" size="4"></div>
    </div>
    <div class="campo full"><label>texto do verbete</label><textarea name="info" required>${esc(v("info"))}</textarea></div>
    <div class="linha">
      <div class="campo larg"><label>fontes (ids separados por espaço)</label><input name="fontes" value="${esc(arr("fontes"))}"></div>
      <div class="campo larg"><label>título na wikipédia (opcional)</label><input name="wiki" value="${esc(v("wiki"))}"></div>
    </div>`;
  if (ent === "vinculo") return `
    <div class="linha">
      <div class="campo"><label>origem</label>${sel("origem", v("origem"), o.verbetes, "id", "nome")}</div>
      <div class="campo"><label>destino</label>${sel("destino", v("destino"), o.verbetes, "id", "nome")}</div>
      <div class="campo"><label>tipo</label>${sel("tipo", v("tipo"), o.tipos, "id", "nome")}</div>
      <div class="campo"><label>ordem</label><input name="ordem" value="${esc(v("ordem"))}" size="4"></div>
    </div>
    <div class="campo full"><label>o que liga os dois</label><textarea name="info" required>${esc(v("info"))}</textarea></div>
    <div class="campo larg"><label>fontes</label><input name="fontes" value="${esc(arr("fontes"))}"></div>`;
  if (ent === "evento") return `
    <div class="linha">
      <div class="campo"><label>fase</label>${sel("fase", v("fase"), o.fases, "ordem", "titulo")}</div>
      <div class="campo"><label>data (texto)</label><input name="data_txt" value="${esc(v("data_txt"))}" required size="12"></div>
      <div class="campo"><label>categoria</label>${sel("categoria", v("categoria"), o.categorias, "id", "nome")}</div>
      <div class="campo larg"><label>quem</label><input name="quem" value="${esc(v("quem"))}" required></div>
      <div class="campo"><label>ordem</label><input name="ordem" value="${esc(v("ordem"))}" size="4"></div>
    </div>
    <div class="campo full"><label>texto (aceita &lt;b&gt;)</label><textarea name="texto" required>${esc(v("texto"))}</textarea></div>`;
  if (ent === "fase") return `
    <div class="linha">
      <div class="campo"><label>ordem</label><input name="ordem" value="${esc(v("ordem"))}" size="4" required></div>
      <div class="campo"><label>tag</label><input name="tag" value="${esc(v("tag"))}" size="8" required></div>
      <div class="campo larg"><label>título</label><input name="titulo" value="${esc(v("titulo"))}" required></div>
    </div>
    <div class="campo full"><label>subtítulo</label><textarea name="subtitulo">${esc(v("subtitulo"))}</textarea></div>`;
  if (ent === "resposta") return `
    <div class="linha">
      <div class="campo"><label>verbete citado</label>${sel("verbete", v("verbete"), o.verbetes, "id", "nome")}</div>
      <div class="campo larg"><label>quem responde</label><input name="autor" value="${esc(v("autor"))}" required></div>
      <div class="campo"><label>tipo</label><select name="tipo">${TIPOS_RESPOSTA.map((t) =>
        `<option${t === v("tipo") ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="campo"><label>data (texto)</label><input name="data_txt" value="${esc(v("data_txt"))}" required size="12"></div>
      <div class="campo"><label>ordem</label><input name="ordem" value="${esc(v("ordem"))}" size="4"></div>
    </div>
    <div class="campo full"><label>teor da resposta — como o citado contesta</label><textarea name="texto" required>${esc(v("texto"))}</textarea></div>
    <div class="linha">
      <div class="campo"><label>fonte (id)</label><input name="fonte" value="${esc(v("fonte"))}" size="8"></div>
      <div class="campo larg"><label>url da resposta</label><input name="url" value="${esc(v("url"))}"></div>
      <div class="campo"><label>destaque na página</label>
        <label style="font-family:Karla,sans-serif;font-size:13px;text-transform:none;letter-spacing:0;color:var(--ink-2)">
          <input type="checkbox" name="prioridade" value="1"${r ? (r.prioridade ? " checked" : "") : " checked"}> mostrar acima do texto
        </label></div>
    </div>`;
  if (ent === "glossario") return `
    <div class="linha">
      <div class="campo"><label>id</label><input name="id" value="${esc(v("id"))}" ${r ? "readonly" : "required"} size="10"></div>
      <div class="campo larg"><label>termo</label><input name="termo" value="${esc(v("termo"))}" required></div>
      <div class="campo larg"><label>variantes (separadas por vírgula, para o texto ser marcado)</label><input name="variantes" value="${esc((r && Array.isArray(r.variantes) ? r.variantes.join(", ") : ""))}"></div>
      <div class="campo"><label>verbete ligado</label><select name="verbete"><option value="">— nenhum —</option>${
        o.verbetes.map((x) => `<option value="${esc(x.id)}"${x.id === v("verbete") ? " selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></div>
      <div class="campo"><label>ordem</label><input name="ordem" value="${esc(v("ordem"))}" size="4"></div>
    </div>
    <div class="campo full"><label>definição em linguagem simples</label><textarea name="definicao" required>${esc(v("definicao"))}</textarea></div>`;
  if (ent === "trilha") return `
    <div class="linha">
      <div class="campo"><label>id</label><input name="id" value="${esc(v("id"))}" ${r ? "readonly" : "required"} size="10"></div>
      <div class="campo larg"><label>nome da trilha</label><input name="nome" value="${esc(v("nome"))}" required></div>
      <div class="campo"><label>ordem</label><input name="ordem" value="${esc(v("ordem"))}" size="4"></div>
    </div>
    <div class="campo full"><label>resumo da trilha</label><textarea name="resumo" required>${esc(v("resumo"))}</textarea></div>
    <div class="campo larg"><label>fontes (ids separados por espaço)</label><input name="fontes" value="${esc(arr("fontes"))}"></div>`;
  if (ent === "passo") return `
    <div class="linha">
      <div class="campo"><label>id</label><input name="id" value="${esc(v("id"))}" ${r ? "readonly" : "required"} size="12"></div>
      <div class="campo"><label>trilha</label>${sel("trilha", v("trilha"), o.trilhas || [], "id", "nome")}</div>
      <div class="campo"><label>ordem</label><input name="ordem" value="${esc(v("ordem"))}" size="4"></div>
      <div class="campo"><label>status</label><select name="status">${["apuracao", "decidido", "registro"].map((t) =>
        `<option${t === v("status") ? " selected" : ""}>${t}</option>`).join("")}</select></div>
    </div>
    <div class="linha">
      <div class="campo larg"><label>de (texto)</label><input name="de" value="${esc(v("de"))}" required></div>
      <div class="campo"><label>de — verbete ligado</label><select name="de_ref"><option value="">— nenhum —</option>${
        o.verbetes.map((x) => `<option value="${esc(x.id)}"${x.id === v("de_ref") ? " selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></div>
    </div>
    <div class="linha">
      <div class="campo larg"><label>para (texto)</label><input name="para" value="${esc(v("para"))}" required></div>
      <div class="campo"><label>para — verbete ligado</label><select name="para_ref"><option value="">— nenhum —</option>${
        o.verbetes.map((x) => `<option value="${esc(x.id)}"${x.id === v("para_ref") ? " selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></div>
    </div>
    <div class="linha">
      <div class="campo larg"><label>valor (texto, como publicado)</label><input name="valor" value="${esc(v("valor"))}"></div>
      <div class="campo larg"><label>data (texto)</label><input name="data_txt" value="${esc(v("data_txt"))}"></div>
    </div>
    <div class="campo full"><label>o que a fonte diz</label><textarea name="info" required>${esc(v("info"))}</textarea></div>
    <div class="campo larg"><label>fontes (ids separados por espaço)</label><input name="fontes" value="${esc(arr("fontes"))}"></div>`;
  if (ent === "fonte") return `
    <div class="linha">
      <div class="campo"><label>id</label><input name="id" value="${esc(v("id"))}" ${r ? "readonly" : "required"} size="8"></div>
      <div class="campo larg"><label>rótulo (Veículo — título)</label><input name="rotulo" value="${esc(v("rotulo"))}" required></div>
      <div class="campo larg"><label>url</label><input name="url" value="${esc(v("url"))}" required></div>
    </div>`;
  return `
    <div class="linha">
      <div class="campo larg"><label>rótulo</label><input name="rotulo" value="${esc(v("rotulo"))}" required></div>
      <div class="campo"><label>valor (R$ bi)</label><input name="valor" value="${esc(v("valor"))}" size="7" required></div>
      <div class="campo"><label>ordem</label><input name="ordem" value="${esc(v("ordem"))}" size="4"></div>
    </div>
    <div class="campo full"><label>nota (aparece no tooltip)</label><textarea name="nota">${esc(v("nota"))}</textarea></div>`;
}

exports.conteudo = (ent, rows, o, contagens, q, errata) => {
  const def = { verbete: "id", vinculo: "id", evento: "id", fase: "ordem", fonte: "id", barra: "id",
    trilha: "id", passo: "id", glossario: "id", resposta: "id" }[ent] || "id";
  const tabs = ENTIDADES.map(([e, rot]) =>
    `<a class="tab ${e === ent ? "on" : ""}" href="/admin/conteudo?ent=${e}">${rot} <b>${contagens[e] ?? "?"}</b></a>`).join("");
  const form = (r) => `
<form class="reg ${r ? "" : "novo"}" method="post" action="/admin/conteudo/salvar">
  <input type="hidden" name="ent" value="${ent}">
  ${r ? `<input type="hidden" name="chave" value="${esc(r[def])}">` : ""}
  ${campos(ent, r, o)}
  <div class="acoes">
    ${r ? `<span class="id">#${esc(r[def])}</span>` : ""}
    <div class="campo larg"><label>motivo da mudança (entra na errata)</label><input name="motivo" placeholder="ex.: correção apontada por leitor, com fonte"></div>
    <button class="pri" type="submit">${r ? "salvar" : "incluir"}</button>
    ${r ? `<button class="del" type="submit" formaction="/admin/conteudo/remover">remover</button>` : ""}
  </div>
</form>`;
  const eList = errata.slice(0, 12).map((e) => `
<div class="errata"><span class="q">${new Date(e.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · ${esc(e.entidade)} · ${esc(e.acao)}</span><br>
  <b>${esc(e.rotulo || e.registro)}</b>${e.campo ? ` — ${esc(e.campo)}: <span class="de">${esc((e.antes || "").slice(0, 90))}</span> → <span class="pa">${esc((e.depois || "").slice(0, 90))}</span>` : ""}
  ${e.motivo ? `<br><span class="q">motivo: ${esc(e.motivo)}</span>` : ""}</div>`).join("");

  return pagina(`Conteúdo — ${ent}`, `
  <p class="sub">Painel · conteúdo do site</p>
  <h1>Feijoada <span>do Master</span></h1>
  <div class="tabs">${tabs}<span class="sp"></span><a class="tab" href="/admin">mensagens</a><a class="tab" href="/admin/sair">sair</a></div>
  <p class="aviso">Em <b>respostas</b> ficam as manifestações de quem é citado — nota oficial, defesa, recurso, decisão judicial favorável, retificação de veículo. Marcadas como destaque, elas aparecem <b>acima</b> do texto do verbete, com selo próprio. Toda alteração daqui entra na <b>errata pública</b> da página, com campo, valor antigo, valor novo e o motivo que você escrever. Remoção de verbete apaga também os vínculos dele.</p>
  <form class="busca" method="get" action="/admin/conteudo">
    <input type="hidden" name="ent" value="${ent}">
    <input type="search" name="q" value="${esc(q || "")}" placeholder="filtrar por texto…">
    <button type="submit">filtrar</button>
    ${q ? `<a class="tab" href="/admin/conteudo?ent=${ent}">limpar</a>` : ""}
  </form>
  ${form(null)}
  ${rows.map((r) => form(r)).join("")}
  <h2 style="font-size:15px;margin:34px 0 6px">Últimas alterações registradas</h2>
  ${eList || `<p class="sub">nenhuma alteração ainda</p>`}
  `);
};

exports.recibo = (msg, volta) => pagina("Salvo", `
  <p class="sub">Painel</p><h1>Feijoada <span>do Master</span></h1>
  <p class="aviso">${esc(msg)}</p>
  <p><a class="tab" href="${esc(volta)}">voltar</a> <a class="tab" href="/">ver o site</a></p>`);
