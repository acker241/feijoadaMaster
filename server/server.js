/* Feijoada do Master — servidor unico: serve o site, recebe mensagens e
   entrega o painel /admin. Sem dependencia alem do driver do Postgres. */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pool, migrar } = require("./db");
const admin = require("./admin");

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

/* ---------- servidor ---------- */
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/healthz") return json(res, 200, { ok: true, sitekey: !!SITEKEY, turnstile: !!SECRET });
    if (url.pathname === "/api/mensagem") {
      if (req.method !== "POST") return json(res, 405, { erro: "use POST" });
      return await rotaMensagem(req, res);
    }
    if (url.pathname === "/api/config") return json(res, 200, { sitekey: SITEKEY });
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
  if (!ok) console.error("[db] banco inacessível — o site continua servindo, mas mensagens não serão gravadas");
})();
