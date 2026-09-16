/* Feijoada do Master — servidor unico: serve o site, recebe mensagens e
   entrega o painel /admin. Sem dependencia alem do driver do Postgres. */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pool, migrar } = require("./db");
const admin = require("./admin");
const conteudo = require("./conteudo");
const adminConteudo = require("./admin-conteudo");
const metricas = require("./metricas");
const adminStats = require("./admin-stats");
const noticias = require("./noticias");
const adminNoticias = require("./admin-noticias");

const PORTA = Number(process.env.PORT || 8080);
const SITEKEY = process.env.TURNSTILE_SITEKEY || "";
const SECRET = process.env.TURNSTILE_SECRET || "";
const SENHA_HASH = process.env.ADMIN_SENHA_HASH || "";
const SESSAO_SEGREDO = process.env.SESSAO_SEGREDO || "";
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || "";
const SITE_URL = process.env.SITE_URL || "";

const TIPOS = new Set([
  "Correção de informação",
  "Sugestão ou pauta que falta",
  "Comentário",
  "Direito de resposta (sou citado na página)",
  "Ameaça ou intimidação que quero registrar",
  "Pedido de remoção / questão jurídica",
  "Outro",
]);
const STATUS = new Set(["novo", "lido", "respondido", "arquivado"]);

/* ---------- pagina ---------- */
const HTML_PATH = path.join(__dirname, "public", "index.html");
let PAGINA = "";
function carregarPagina() {
  const bruto = fs.readFileSync(HTML_PATH, "utf8");
  PAGINA = bruto.replaceAll("__TURNSTILE_SITEKEY__", SITEKEY);
  console.log(`[site] index.html carregado (${PAGINA.length} bytes)` + (SITEKEY ? " com sitekey" : " SEM sitekey"));
}

/* ---------- utilidades ---------- */
const CSP_SITE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org https://commons.wikimedia.org https://pt.wikipedia.org",
  "connect-src 'self' https://pt.wikipedia.org https://commons.wikimedia.org",
  "frame-src https://challenges.cloudflare.com",
  "form-action 'self' mailto:",
  "frame-ancestors 'self'",
  "base-uri 'none'",
].join("; ");

const CSP_ADMIN = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

function cabecalhos(res, tipo, csp) {
  res.setHeader("Content-Type", tipo);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Content-Security-Policy", csp);
}
function enviar(res, codigo, corpo, tipo = "text/plain; charset=utf-8", csp = CSP_ADMIN) {
  cabecalhos(res, tipo, csp);
  res.statusCode = codigo;
  res.end(corpo);
}
function json(res, codigo, obj) {
  enviar(res, codigo, JSON.stringify(obj), "application/json; charset=utf-8");
}
function ipDe(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket.remoteAddress || "";
}
async function lerCorpo(req, limite = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > limite) { reject(new Error("corpo grande demais")); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
    req.on("error", reject);
  });
}

/* ---------- rate limit em memoria ---------- */
const janelas = new Map();
function limitar(chave, max, msJanela) {
  const agora = Date.now();
  const reg = janelas.get(chave);
  if (!reg || agora > reg.ate) { janelas.set(chave, { n: 1, ate: agora + msJanela }); return true; }
  if (reg.n >= max) return false;
  reg.n += 1;
  return true;
}
setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of janelas) if (agora > v.ate) janelas.delete(k);
}, 60_000).unref();

/* ---------- Turnstile ---------- */
async function turnstileOk(token, ip) {
  if (!SECRET) { console.warn("[turnstile] TURNSTILE_SECRET ausente — validação desligada"); return true; }
  if (!token) return false;
  try {
    const corpo = new URLSearchParams({ secret: SECRET, response: token, remoteip: ip });
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: corpo,
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    if (!j.success) console.warn("[turnstile] recusado:", JSON.stringify(j["error-codes"] || []));
    return !!j.success;
  } catch (e) {
    console.error("[turnstile] falha na verificação:", e.message);
    return false;
  }
}

/* ---------- Telegram ---------- */
async function avisarTelegram(m) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const linhas = [
    `*${m.tipo}*`,
    m.nome ? `de: ${m.nome}` : "sem nome",
    m.email ? `contato: ${m.email}` : "sem contato",
    m.referencia ? `ref: ${m.referencia}` : null,
    "",
    m.mensagem.slice(0, 900),
    "",
    SITE_URL ? `${SITE_URL}/admin` : "/admin",
  ].filter(Boolean).join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: linhas, parse_mode: "Markdown", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) { console.error("[telegram] falhou:", e.message); }
}

/* resumo do monitor de noticias: uma mensagem por coleta com novidade */
async function avisarNoticias(novas) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const texto = [
    `${novas.length} notícia(s) nova(s) sobre o caso`,
    "",
    ...novas.slice(0, 8).map((n) => `• ${n.veiculo}: ${n.titulo}`.slice(0, 220)),
    novas.length > 8 ? `… e mais ${novas.length - 8}` : null,
    "",
    SITE_URL ? `${SITE_URL}/admin/noticias` : "/admin/noticias",
  ].filter((l) => l !== null).join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: texto, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) { console.error("[telegram] aviso de noticias falhou:", e.message); }
}

/* ---------- sessao do admin ---------- */
function assinar(valor) {
  return crypto.createHmac("sha256", SESSAO_SEGREDO).update(valor).digest("base64url");
}
function criarSessao() {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const payload = String(exp);
  return `${payload}.${assinar(payload)}`;
}
function sessaoValida(cookie) {
  if (!SESSAO_SEGREDO || !cookie) return false;
  const m = /(?:^|;\s*)fm_sess=([^;]+)/.exec(cookie);
  if (!m) return false;
  const [payload, sig] = decodeURIComponent(m[1]).split(".");
  if (!payload || !sig) return false;
  const esperado = assinar(payload);
  if (sig.length !== esperado.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return false;
  return Number(payload) > Date.now();
}
function senhaCorreta(senha) {
  if (!SENHA_HASH) return false;
  const [algo, salt, hash] = SENHA_HASH.split("$");
  if (algo !== "scrypt" || !salt || !hash) { console.error("[admin] ADMIN_SENHA_HASH mal formatada"); return false; }
  const calc = crypto.scryptSync(senha, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  const a = Buffer.from(calc), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- rotas ---------- */
async function rotaMensagem(req, res) {
  const ip = ipDe(req);
  if (!limitar(`msg:${ip}`, 5, 10 * 60_000)) return json(res, 429, { erro: "Muitos envios deste endereço. Tente mais tarde." });

  let dados;
  try { dados = JSON.parse(await lerCorpo(req)); }
  catch { return json(res, 400, { erro: "Corpo inválido." }); }

  const tipo = TIPOS.has(dados.tipo) ? dados.tipo : "Outro";
  const nome = String(dados.nome || "").trim().slice(0, 120);
  const email = String(dados.email || "").trim().slice(0, 160);
  const referencia = String(dados.referencia || "").trim().slice(0, 200);
  const mensagem = String(dados.mensagem || "").trim().slice(0, 8000);
  const autoriza = !!dados.autorizaPublicacao;
  const isca = String(dados._gotcha || "").trim();

  if (isca) return json(res, 200, { ok: true });                  /* robo: finge sucesso */
  if (mensagem.length < 15) return json(res, 400, { erro: "Mensagem curta demais." });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { erro: "E-mail inválido." });

  if (!(await turnstileOk(dados.turnstileToken, ip))) {
    return json(res, 403, { erro: "Verificação anti-robô falhou. Recarregue a página e tente de novo." });
  }

  try {
    const q = await pool.query(
      `INSERT INTO mensagens (tipo,nome,email,referencia,mensagem,autoriza_pub,ip,user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, criado_em`,
      [tipo, nome || null, email || null, referencia || null, mensagem, autoriza, ip, String(req.headers["user-agent"] || "").slice(0, 300)]
    );
    avisarTelegram({ tipo, nome, email, referencia, mensagem });
    return json(res, 201, { ok: true, protocolo: q.rows[0].id });
  } catch (e) {
    console.error("[mensagem] falha ao gravar:", e.message);
    return json(res, 500, { erro: "Não foi possível gravar a mensagem agora." });
  }
}

async function rotaAdmin(req, res, url) {
  const autenticado = sessaoValida(req.headers.cookie);

  if (req.method === "POST" && url.pathname === "/admin/login") {
    const ip = ipDe(req);
    if (!limitar(`login:${ip}`, 8, 15 * 60_000)) return enviar(res, 429, "Muitas tentativas. Aguarde 15 minutos.");
    const corpo = new URLSearchParams(await lerCorpo(req, 4096));
    if (senhaCorreta(corpo.get("senha") || "")) {
      res.setHeader("Set-Cookie", `fm_sess=${criarSessao()}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=43200${SITE_URL.startsWith("https") ? "; Secure" : ""}`);
      res.statusCode = 302; res.setHeader("Location", "/admin"); return res.end();
    }
    return enviar(res, 401, admin.login("Senha incorreta."), "text/html; charset=utf-8", CSP_ADMIN);
  }

  if (url.pathname === "/admin/sair") {
    res.setHeader("Set-Cookie", "fm_sess=; HttpOnly; Path=/admin; Max-Age=0");
    res.statusCode = 302; res.setHeader("Location", "/admin"); return res.end();
  }

  if (!autenticado) {
    if (!SENHA_HASH || !SESSAO_SEGREDO) {
      return enviar(res, 503, admin.login("Painel ainda não configurado: faltam ADMIN_SENHA_HASH e SESSAO_SEGREDO."), "text/html; charset=utf-8", CSP_ADMIN);
    }
    return enviar(res, 200, admin.login(), "text/html; charset=utf-8", CSP_ADMIN);
  }

  if (req.method === "POST" && url.pathname === "/admin/acao") {
    const corpo = new URLSearchParams(await lerCorpo(req, 8192));
    const id = Number(corpo.get("id"));
    const status = corpo.get("status");
    const nota = corpo.get("nota");
    if (!Number.isInteger(id)) return enviar(res, 400, "id inválido");
    if (status && STATUS.has(status)) {
      await pool.query("UPDATE mensagens SET status=$1, atualizado_em=now() WHERE id=$2", [status, id]);
    }
    if (nota !== null) {
      await pool.query("UPDATE mensagens SET nota_interna=$1, atualizado_em=now() WHERE id=$2", [String(nota).slice(0, 4000) || null, id]);
    }
    res.statusCode = 302; res.setHeader("Location", corpo.get("volta") || "/admin"); return res.end();
  }

  if (url.pathname.startsWith("/admin/conteudo")) {
    const ents = Object.keys(conteudo.TABELAS);
    if (req.method === "POST") {
      const corpo = new URLSearchParams(await lerCorpo(req, 64 * 1024));
      const ent = corpo.get("ent");
      if (!ents.includes(ent)) return enviar(res, 400, "entidade inválida");
      const chave = corpo.get("chave") || null;
      const motivo = corpo.get("motivo") || null;
      const entrada = {};
      for (const [k, v] of corpo) if (!["ent", "chave", "motivo"].includes(k)) entrada[k] = v;
      try {
        if (url.pathname.endsWith("/remover")) {
          if (!chave) return enviar(res, 400, "sem chave");
          const ok = await conteudo.remover(ent, chave, motivo);
          return enviar(res, 200, adminConteudo.recibo(ok ? `Removido. A errata registrou a exclusão.` : "Registro não encontrado.", `/admin/conteudo?ent=${ent}`), "text/html; charset=utf-8", CSP_ADMIN);
        }
        const r = await conteudo.salvar(ent, chave, entrada, motivo);
        return enviar(res, 200, adminConteudo.recibo(`${chave ? "Alterado" : "Incluído"}: ${r.rotulo || r.registro}. O site já serve a versão nova.`, `/admin/conteudo?ent=${ent}`), "text/html; charset=utf-8", CSP_ADMIN);
      } catch (e) {
        console.error("[conteudo] erro ao salvar:", e.message);
        return enviar(res, 400, adminConteudo.recibo(`Não deu: ${e.message}`, `/admin/conteudo?ent=${ent}`), "text/html; charset=utf-8", CSP_ADMIN);
      }
    }
    const ent = ents.includes(url.searchParams.get("ent")) ? url.searchParams.get("ent") : "verbete";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const [linhas, opcoes] = await Promise.all([conteudo.listar(ent), conteudo.opcoes()]);
    const filtradas = q
      ? linhas.filter((r) => JSON.stringify(Object.values(r)).toLowerCase().includes(q))
      : linhas;
    const contagens = {};
    for (const e of ents) contagens[e] = (await pool.query(`SELECT count(*)::int AS n FROM ${conteudo.TABELAS[e].tabela}`)).rows[0].n;
    const err = (await pool.query("SELECT * FROM errata ORDER BY criado_em DESC LIMIT 12")).rows;
    return enviar(res, 200, adminConteudo.conteudo(ent, filtradas, opcoes, contagens, q, err), "text/html; charset=utf-8", CSP_ADMIN);
  }

  if (url.pathname.startsWith("/admin/noticias")) return await rotaNoticias(req, res, url);

  if (url.pathname === "/admin/stats") {
    const d = Number(url.searchParams.get("dias"));
    const dias = [7, 30, 90, 365].includes(d) ? d : 30;
    const r = await metricas.resumo(dias);
    return enviar(res, 200, adminStats.stats(r), "text/html; charset=utf-8", CSP_ADMIN);
  }

  if (url.pathname === "/admin/export.csv") {
    const { rows } = await pool.query("SELECT id,criado_em,tipo,nome,email,referencia,mensagem,autoriza_pub,status,ip,nota_interna FROM mensagens ORDER BY criado_em DESC");
    const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = ["id,criado_em,tipo,nome,email,referencia,mensagem,autoriza_pub,status,ip,nota_interna"]
      .concat(rows.map((r) => [r.id, r.criado_em.toISOString(), r.tipo, r.nome, r.email, r.referencia, r.mensagem, r.autoriza_pub, r.status, r.ip, r.nota_interna].map(esc).join(",")))
      .join("\n");
    res.setHeader("Content-Disposition", `attachment; filename="mensagens-${new Date().toISOString().slice(0, 10)}.csv"`);
    return enviar(res, 200, "﻿" + csv, "text/csv; charset=utf-8");
  }

  /* lista */
  const filtroStatus = STATUS.has(url.searchParams.get("status")) ? url.searchParams.get("status") : null;
  const filtroTipo = url.searchParams.get("tipo") && TIPOS.has(url.searchParams.get("tipo")) ? url.searchParams.get("tipo") : null;
  const cond = [], vals = [];
  if (filtroStatus) { vals.push(filtroStatus); cond.push(`status=$${vals.length}`); }
  if (filtroTipo) { vals.push(filtroTipo); cond.push(`tipo=$${vals.length}`); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const { rows } = await pool.query(`SELECT * FROM mensagens ${where} ORDER BY criado_em DESC LIMIT 200`, vals);
  const cont = await pool.query("SELECT status, count(*)::int AS n FROM mensagens GROUP BY status");
  return enviar(res, 200, admin.lista(rows, cont.rows, { status: filtroStatus, tipo: filtroTipo }, [...TIPOS]), "text/html; charset=utf-8", CSP_ADMIN);
}

/* ---------- monitor de noticias (painel) ---------- */
const STATUS_NOTICIA = new Set(["novo", "relevante", "usado", "descartado"]);
const GRUPOS_VEICULO = new Set(["grande", "independente", "especializado", "regional", "outros"]);

/* filtro da fila, a partir da querystring; serve para listar e para descartar em lote */
function filtroNoticias(params) {
  const st = params.get("status");
  const filtro = {
    status: STATUS_NOTICIA.has(st) || st === "todas" ? st : "novo",
    pessoa: params.get("pessoa") || "",
    grupo: GRUPOS_VEICULO.has(params.get("grupo")) ? params.get("grupo") : "",
    veiculo: params.get("veiculo") || "",
    q: (params.get("q") || "").trim().slice(0, 100),
  };
  const cond = [], vals = [];
  const add = (sql, v) => { vals.push(v); cond.push(sql.replace("?", "$" + vals.length)); };
  if (filtro.status !== "todas") add("n.status = ?", filtro.status);
  if (filtro.pessoa) add("? = ANY(n.pessoas)", filtro.pessoa);
  if (filtro.veiculo) add("n.dominio = ?", filtro.veiculo);
  if (filtro.grupo) add("v.grupo = ?", filtro.grupo);
  if (filtro.q) add("n.titulo ILIKE ?", "%" + filtro.q.replace(/[%_\\]/g, "\\$&") + "%");
  return { filtro, where: cond.length ? "WHERE " + cond.join(" AND ") : "", vals };
}

async function rotaNoticias(req, res, url) {
  const html = (corpo) => enviar(res, 200, corpo, "text/html; charset=utf-8", CSP_ADMIN);
  const redirecionar = (destino) => { res.statusCode = 302; res.setHeader("Location", destino); return res.end(); };

  if (req.method === "POST" && url.pathname === "/admin/noticias/acao") {
    const corpo = new URLSearchParams(await lerCorpo(req, 64 * 1024));
    const ids = String(corpo.get("ids") || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
    const status = corpo.get("status");
    const nota = corpo.get("nota");
    if (ids.length && STATUS_NOTICIA.has(status)) await pool.query("UPDATE noticias SET status=$1 WHERE id = ANY($2::bigint[])", [status, ids]);
    if (ids.length && nota !== null) await pool.query("UPDATE noticias SET nota=$1 WHERE id = ANY($2::bigint[])", [nota.slice(0, 2000) || null, ids]);
    const volta = corpo.get("volta") || "";
    if (corpo.get("lote") === "filtro" && STATUS_NOTICIA.has(status) && volta.startsWith("/admin/noticias")) {
      const { filtro, where, vals } = filtroNoticias(new URL(volta, "http://painel").searchParams);
      if (filtro.status === "novo") {
        await pool.query(`UPDATE noticias SET status=$${vals.length + 1}
          WHERE id IN (SELECT n.id FROM noticias n LEFT JOIN veiculos v ON v.dominio = n.dominio ${where})`, [...vals, status]);
      }
    }
    return redirecionar(volta.startsWith("/admin/noticias") ? volta : "/admin/noticias");
  }

  if (req.method === "POST" && url.pathname === "/admin/noticias/coletar") {
    if (!noticias.estaRodando()) {
      noticias.coletar({ pessoasTambem: true, motivo: "manual" })
        .then((r) => { if (r.novas && r.novas.length) avisarNoticias(r.novas); })
        .catch((e) => console.error("[noticias] coleta manual:", e.message));
    }
    return redirecionar("/admin/noticias?msg=" + encodeURIComponent("Coleta iniciada. Leva alguns minutos; recarregue a página depois."));
  }

  if (req.method === "POST" && url.pathname === "/admin/noticias/veiculo") {
    const c = new URLSearchParams(await lerCorpo(req, 16 * 1024));
    const dominio = String(c.get("dominio") || "").trim().toLowerCase()
      .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const nome = String(c.get("nome") || "").trim().slice(0, 80);
    const grupo = GRUPOS_VEICULO.has(c.get("grupo")) ? c.get("grupo") : "outros";
    const rss = String(c.get("rss") || "").split(/\s+/).filter((u) => /^https?:\/\/\S+$/i.test(u)).join(" ") || null;
    const busca = c.get("busca") === "1", ativo = c.get("ativo") === "1";
    let msg;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio) || !nome) msg = "Domínio ou nome inválido.";
    else if (c.get("novo")) {
      const r = await pool.query("INSERT INTO veiculos (dominio,nome,grupo,rss,busca,ativo) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dominio) DO NOTHING",
        [dominio, nome, grupo, rss, busca, ativo]);
      msg = r.rowCount ? `${nome} incluído.` : `${dominio} já estava cadastrado.`;
    } else {
      await pool.query("UPDATE veiculos SET nome=$2, grupo=$3, rss=$4, busca=$5, ativo=$6 WHERE dominio=$1", [dominio, nome, grupo, rss, busca, ativo]);
      msg = `${nome} salvo.`;
    }
    return redirecionar("/admin/noticias/veiculos?msg=" + encodeURIComponent(msg));
  }

  if (url.pathname === "/admin/noticias/veiculos") {
    const { rows } = await pool.query("SELECT * FROM veiculos ORDER BY ativo DESC, grupo, nome");
    return html(adminNoticias.veiculos(rows, { msg: url.searchParams.get("msg") }));
  }

  /* fila */
  const LIMITE = 150;
  const { filtro, where, vals } = filtroNoticias(url.searchParams);

  const [lista, cont, noFiltro, pessoas, veiculos, nomes, fontes, ultima] = await Promise.all([
    pool.query(`SELECT n.* FROM noticias n LEFT JOIN veiculos v ON v.dominio = n.dominio ${where}
                ORDER BY coalesce(n.publicado_em, n.encontrado_em) DESC LIMIT ${LIMITE}`, vals),
    pool.query("SELECT status, count(*)::int AS n FROM noticias GROUP BY status"),
    pool.query(`SELECT count(*)::int AS n FROM noticias n LEFT JOIN veiculos v ON v.dominio = n.dominio ${where}`, vals),
    pool.query(`SELECT p AS id, count(*)::int AS n FROM noticias, unnest(pessoas) p
                WHERE $1::text IS NULL OR status = $1 GROUP BY p ORDER BY n DESC LIMIT 80`,
      [filtro.status === "todas" ? null : filtro.status]),
    pool.query("SELECT dominio, nome FROM veiculos ORDER BY nome"),
    pool.query("SELECT id, nome FROM verbetes"),
    pool.query("SELECT url FROM fontes"),
    pool.query("SELECT valor FROM meta WHERE chave='noticias_ultima'"),
  ]);
  const contagens = Object.fromEntries(cont.rows.map((r) => [r.status, r.n]));
  contagens.todas = cont.rows.reduce((a, r) => a + r.n, 0);
  const fontesSite = new Set(fontes.rows.map((f) => {
    try { return new URL(f.url).hostname.replace(/^www\d*\./, ""); } catch { return null; }
  }).filter(Boolean));
  let ultimaColeta = null;
  try { ultimaColeta = ultima.rows[0] ? JSON.parse(ultima.rows[0].valor) : null; } catch { /* registro corrompido: mostra como sem coleta */ }

  return html(adminNoticias.fila(lista.rows, {
    filtro, contagens, noFiltro: noFiltro.rows[0].n, pessoas: pessoas.rows, veiculos: veiculos.rows, limite: LIMITE,
    nomes: Object.fromEntries(nomes.rows.map((r) => [r.id, r.nome])),
    fontesSite, ultima: ultimaColeta, rodando: noticias.estaRodando(),
    horas: Math.max(1, Number(process.env.NOTICIAS_HORAS || 6)), msg: url.searchParams.get("msg"),
  }));
}

/* ---------- servidor ---------- */
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/healthz") return json(res, 200, { ok: true, sitekey: !!SITEKEY, turnstile: !!SECRET });
    if (url.pathname === "/api/mensagem") {
      if (req.method !== "POST") return json(res, 405, { erro: "use POST" });
      return await rotaMensagem(req, res);
    }
    if (url.pathname === "/api/ev") {
      if (req.method !== "POST") return json(res, 405, { erro: "use POST" });
      res.statusCode = 204;
      if (!limitar(`ev:${ipDe(req)}`, 120, 10 * 60_000)) return res.end();
      try {
        await metricas.registrar(await lerCorpo(req, 8192), ipDe(req), req.headers["user-agent"] || "", req.headers.host);
      } catch (e) { console.error("[metricas] falhou:", e.message); }
      return res.end();
    }
    if (url.pathname === "/api/config") return json(res, 200, { sitekey: SITEKEY });
    if (url.pathname === "/api/dados") {
      try {
        const { corpo, etag } = await conteudo.dados();
        if (req.headers["if-none-match"] === etag) { res.statusCode = 304; return res.end(); }
        cabecalhos(res, "application/json; charset=utf-8", CSP_SITE);
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "public, max-age=60, must-revalidate");
        res.statusCode = 200;
        return res.end(corpo);
      } catch (e) {
        console.error("[api/dados] falhou:", e.message);
        return json(res, 503, { erro: "conteúdo indisponível" });
      }
    }
    if (url.pathname.startsWith("/admin")) return await rotaAdmin(req, res, url);
    if (req.method === "GET" || req.method === "HEAD") {
      cabecalhos(res, "text/html; charset=utf-8", CSP_SITE);
      res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
      res.statusCode = 200;
      return res.end(req.method === "HEAD" ? undefined : PAGINA);
    }
    return json(res, 405, { erro: "método não suportado" });
  } catch (e) {
    console.error("[erro]", url.pathname, e.message);
    return json(res, 500, { erro: "erro interno" });
  }
});

(async () => {
  carregarPagina();
  servidor.listen(PORTA, () => console.log(`[servidor] ouvindo em :${PORTA}`));
  const ok = await migrar();
  if (!ok) { console.error("[db] banco inacessível — o site serve o snapshot embutido e não grava mensagens"); return; }
  try { await conteudo.semear(); } catch (e) { console.error("[conteudo] semeadura falhou:", e.message); }
  metricas.limpar();
  try { await noticias.semear(); noticias.agendar(avisarNoticias); } catch (e) { console.error("[noticias] nao iniciou:", e.message); }
  setInterval(metricas.limpar, 24 * 60 * 60_000).unref();
})();
