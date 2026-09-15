/* Paineis HTML do /admin, no mesmo visual do site (paleta feijoada). */
"use strict";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CSS = `
:root{--paper:#FAF4E8;--surface:#FFFBF3;--surface-2:#F3E9D8;--ink:#241B14;--ink-2:#564636;--ink-3:#897463;
--rule:#E5D9C4;--rule-strong:#C8B69A;--laranja:#C2601A;--vinho:#A62449;--verde:#5A8A24;--azul:#3355A8;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#16120F;--surface:#1E1813;--surface-2:#2A221B;--ink:#F7F0E2;
--ink-2:#D5C5AE;--ink-3:#9E8C77;--rule:#342A22;--rule-strong:#4D4033;--laranja:#D4762B;--vinho:#C94A6B;
--verde:#719C31;--azul:#5C7FD0;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 Karla,system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:1020px;margin:0 auto;padding:26px 20px 70px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.02em}
h1 span{color:var(--laranja)}
.sub{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
a{color:inherit;text-decoration-color:var(--rule-strong);text-underline-offset:3px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:22px 0 18px;padding-bottom:14px;border-bottom:1px solid var(--rule-strong)}
.pill{font-size:13px;font-weight:700;border:1px solid var(--rule-strong);border-radius:999px;padding:5px 11px;
  text-decoration:none;color:var(--ink-3)}
.pill.on{background:var(--surface-2);color:var(--ink);border-color:var(--ink-3)}
.pill b{font-family:ui-monospace,monospace;font-weight:500;color:var(--laranja)}
.sp{flex:1}
.msg{border:1px solid var(--rule);background:var(--surface);padding:16px 18px;margin-bottom:14px;border-left:3px solid var(--k)}
.msg header{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
.msg .tipo{font-weight:800;font-size:15px}
.msg .meta{font-family:ui-monospace,monospace;font-size:11px;color:var(--ink-3)}
.msg .texto{white-space:pre-wrap;font-size:14.5px;color:var(--ink-2);margin:10px 0 0}
.msg .quem{font-size:13.5px;color:var(--ink-2);margin-top:8px}
.msg .quem b{color:var(--ink)}
.flag{font-family:ui-monospace,monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;
  border:1px solid currentColor;padding:2px 6px;border-radius:2px}
.acoes{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--rule)}
.acoes button{font:600 12.5px Karla,sans-serif;background:none;border:1px solid var(--rule-strong);color:var(--ink-2);
  padding:6px 11px;border-radius:2px;cursor:pointer}
.acoes button:hover{color:var(--ink);border-color:var(--ink-3)}
.acoes input[type=text]{flex:1;min-width:180px;font:14px Karla,sans-serif;padding:7px 10px;border:1px solid var(--rule-strong);
  background:var(--paper);color:var(--ink);border-radius:2px}
form.inline{display:contents}
.vazio{color:var(--ink-3);font-size:14.5px;padding:30px 0}
.login{max-width:380px;margin:12vh auto;padding:0 20px}
.login form{display:grid;gap:12px;margin-top:20px}
.login input{font:15px Karla,sans-serif;padding:11px 13px;border:1px solid var(--rule-strong);background:var(--surface);
  color:var(--ink);border-radius:2px}
.login button{font:800 15px Karla,sans-serif;background:var(--ink);color:var(--paper);border:0;padding:12px;cursor:pointer;border-radius:2px}
.erro{font-size:13.5px;color:var(--vinho);border-left:3px solid var(--vinho);padding:8px 12px;background:var(--surface-2)}
.nota{font-size:13px;color:var(--ink-3);margin-top:8px;font-style:italic}
`;

function pagina(titulo, corpo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)}</title><style>${CSS}</style></head><body>${corpo}</body></html>`;
}

exports.login = (erro) => pagina("Painel — Feijoada do Master", `
<div class="login">
  <p class="sub">Painel restrito</p>
  <h1>Feijoada <span>do Master</span></h1>
  ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}
  <form method="post" action="/admin/login">
    <input type="password" name="senha" placeholder="senha" autocomplete="current-password" required autofocus>
    <button type="submit">Entrar</button>
  </form>
</div>`);

const COR = {
  "Correção de informação": "var(--laranja)",
  "Sugestão ou pauta que falta": "var(--verde)",
  "Comentário": "var(--ink-3)",
  "Direito de resposta (sou citado na página)": "var(--azul)",
  "Ameaça ou intimidação que quero registrar": "var(--vinho)",
  "Pedido de remoção / questão jurídica": "var(--vinho)",
  "Outro": "var(--ink-3)",
};

exports.lista = (rows, contagens, filtro, tipos) => {
  const total = contagens.reduce((a, c) => a + c.n, 0);
  const porStatus = Object.fromEntries(contagens.map((c) => [c.status, c.n]));
  const qs = (o) => {
    const p = new URLSearchParams();
    const f = { ...filtro, ...o };
    if (f.status) p.set("status", f.status);
    if (f.tipo) p.set("tipo", f.tipo);
    const s = p.toString();
    return "/admin" + (s ? "?" + s : "");
  };
  const volta = qs({});
  const chips = [
    `<a class="pill ${!filtro.status ? "on" : ""}" href="${qs({ status: null })}">tudo <b>${total}</b></a>`,
    ...["novo", "lido", "respondido", "arquivado"].map((s) =>
      `<a class="pill ${filtro.status === s ? "on" : ""}" href="${qs({ status: s })}">${s} <b>${porStatus[s] || 0}</b></a>`),
  ].join("");
  const chipsTipo = tipos.map((t) =>
    `<a class="pill ${filtro.tipo === t ? "on" : ""}" href="${qs({ tipo: filtro.tipo === t ? null : t })}">${esc(t.split(" ")[0])}</a>`).join("");

  const itens = rows.length ? rows.map((r) => {
    const data = new Date(r.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return `<article class="msg" style="--k:${COR[r.tipo] || "var(--ink-3)"}">
  <header>
    <span class="tipo">${esc(r.tipo)}</span>
    <span class="meta">#${r.id} · ${esc(data)} · ${esc(r.status)}</span>
    ${r.autoriza_pub ? `<span class="flag" style="color:var(--verde)">autoriza publicar</span>` : `<span class="flag" style="color:var(--ink-3)">sem autorização</span>`}
  </header>
  <p class="quem"><b>${esc(r.nome || "sem nome")}</b>${r.email ? ` · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : " · sem contato"}${r.referencia ? ` · ref: ${esc(r.referencia)}` : ""}</p>
  <p class="texto">${esc(r.mensagem)}</p>
  ${r.nota_interna ? `<p class="nota">nota: ${esc(r.nota_interna)}</p>` : ""}
  <div class="acoes">
    ${["lido", "respondido", "arquivado"].filter((s) => s !== r.status).map((s) => `
    <form class="inline" method="post" action="/admin/acao">
      <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="status" value="${s}">
      <input type="hidden" name="volta" value="${esc(volta)}">
      <button type="submit">marcar ${s}</button>
    </form>`).join("")}
    <form class="inline" method="post" action="/admin/acao">
      <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="volta" value="${esc(volta)}">
      <input type="text" name="nota" placeholder="nota interna" value="${esc(r.nota_interna || "")}">
      <button type="submit">salvar nota</button>
    </form>
  </div>
  <p class="meta" style="margin-top:8px">ip ${esc(r.ip || "?")}</p>
</article>`;
  }).join("") : `<p class="vazio">Nenhuma mensagem com esse filtro.</p>`;

  return pagina("Mensagens — Feijoada do Master", `
<div class="wrap">
  <p class="sub">Painel · mensagens recebidas</p>
  <h1>Feijoada <span>do Master</span></h1>
  <div class="bar">${chips}<span class="sp"></span><a class="pill" href="/admin/conteudo">editar conteúdo</a><a class="pill" href="/admin/export.csv">baixar CSV</a><a class="pill" href="/admin/sair">sair</a></div>
  <div class="bar" style="margin-top:-6px;border:0;padding:0">${chipsTipo}</div>
  ${itens}
  <p class="sub" style="margin-top:26px">Mensagem com ameaça é preservada com data, hora e IP — não use "arquivado" como exclusão.</p>
</div>`);
};
