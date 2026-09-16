/* Metricas de visita anonimas. A pagina manda eventos por sendBeacon; aqui
   eles viram linhas em `metricas`. Nao ha cookie e o IP nao e gravado: o
   visitante e um hash de (segredo + dia + ip + navegador), que troca todo dia. */
"use strict";

const crypto = require("node:crypto");
const { pool } = require("./db");

const SAL = process.env.SESSAO_SEGREDO || crypto.randomBytes(32).toString("hex");
const TIPOS = new Set(["view", "sec", "no", "ligacao", "trilha", "busca", "ref", "fonte", "copiar", "msg_ok", "tempo"]);
const ROBO = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|java\/|go-http|facebookexternalhit|whatsapp|telegram/i;
const RETENCAO_DIAS = 400;

function diaSP(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function limpaAlvo(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).slice(0, 80).replace(/[^\w:./@+~-]/g, "");
  return s || null;
}

function hostExterno(ref, hostProprio) {
  try {
    const h = new URL(String(ref)).hostname.replace(/^www\./, "").toLowerCase();
    if (!h || h === hostProprio) return null;
    return h.slice(0, 80);
  } catch { return null; }
}

/* corpo: {r: referrer, d: "m"|"d", e: [{t, a}]} */
async function registrar(corpoTxt, ip, ua, host) {
  if (!ua || ROBO.test(ua)) return 0;
  let corpo;
  try { corpo = JSON.parse(corpoTxt); } catch { return 0; }
  if (!corpo || !Array.isArray(corpo.e)) return 0;
  const dia = diaSP();
  const visitante = crypto.createHash("sha256").update(`${SAL}|${dia}|${ip}|${ua}`).digest("base64url").slice(0, 16);
  const disp = corpo.d === "m" ? "celular" : corpo.d === "d" ? "computador" : null;
  const proprio = String(host || "").split(":")[0].replace(/^www\./, "").toLowerCase();
  const ref = hostExterno(corpo.r, proprio);

  const linhas = [];
  for (const ev of corpo.e.slice(0, 40)) {
    if (!ev || !TIPOS.has(ev.t)) continue;
    let alvo = limpaAlvo(ev.a);
    if (ev.t === "tempo") {
      const s = Math.round(Number(ev.a));
      if (!Number.isFinite(s) || s <= 0) continue;
      alvo = String(Math.min(s, 1800));
    }
    linhas.push([visitante, ev.t, alvo, ev.t === "view" ? ref : null, ev.t === "view" ? disp : null]);
  }
  if (!linhas.length) return 0;
  const vals = [], marcas = [];
  linhas.forEach((l, i) => {
    marcas.push(`($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`);
    vals.push(...l);
  });
  await pool.query(`INSERT INTO metricas (visitante,tipo,alvo,ref,disp) VALUES ${marcas.join(",")}`, vals);
  return linhas.length;
}

async function limpar() {
  try {
    const r = await pool.query(`DELETE FROM metricas WHERE dia < current_date - ${RETENCAO_DIAS}`);
    if (r.rowCount) console.log(`[metricas] ${r.rowCount} evento(s) antigos removidos`);
  } catch (e) { console.error("[metricas] limpeza falhou:", e.message); }
}

/* Numeros do painel para os ultimos `dias` (hoje incluso). Uma "visita" e um
   visitante num dia; por isso somas de periodo contam visitas, nao pessoas. */
async function resumo(dias) {
  const desde = `(now() AT TIME ZONE 'America/Sao_Paulo')::date - ${dias - 1}`;
  const q = (sql) => pool.query(sql).then((r) => r.rows);
  const topo = (tipo, lim = 15) => q(`
    SELECT alvo, count(DISTINCT (dia, visitante))::int AS n
      FROM metricas WHERE dia >= ${desde} AND tipo='${tipo}' AND alvo IS NOT NULL
     GROUP BY alvo ORDER BY n DESC, alvo LIMIT ${lim}`);

  const [diario, visitas, secoes, nos, ligacoes, trilhas, buscas, refs, fontes, origens, disps, tempo, acoes, nomes, nomesTr, termos] = await Promise.all([
    q(`SELECT to_char(dia,'YYYY-MM-DD') AS dia,
              count(DISTINCT visitante) FILTER (WHERE tipo='view')::int AS visitantes,
              count(*) FILTER (WHERE tipo='view')::int AS views
         FROM metricas WHERE dia >= ${desde} GROUP BY dia ORDER BY dia`),
    q(`SELECT count(DISTINCT (dia, visitante))::int AS n FROM metricas WHERE dia >= ${desde} AND tipo='view'`),
    topo("sec", 30),
    topo("no"),
    topo("ligacao", 10),
    topo("trilha", 10),
    topo("busca", 10),
    topo("ref", 15),
    topo("fonte", 15),
    q(`SELECT coalesce(ref,'(direto ou sem origem)') AS alvo, count(DISTINCT (dia, visitante))::int AS n
         FROM metricas WHERE dia >= ${desde} AND tipo='view' GROUP BY 1 ORDER BY n DESC LIMIT 15`),
    q(`SELECT coalesce(disp,'?') AS alvo, count(DISTINCT (dia, visitante))::int AS n
         FROM metricas WHERE dia >= ${desde} AND tipo='view' GROUP BY 1 ORDER BY n DESC`),
    q(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s)::int AS mediana, avg(s)::int AS media
         FROM (SELECT sum(alvo::int) AS s FROM metricas WHERE dia >= ${desde} AND tipo='tempo'
               GROUP BY dia, visitante) t`),
    q(`SELECT tipo AS alvo, count(*)::int AS n FROM metricas WHERE dia >= ${desde} AND tipo IN ('msg_ok','copiar') GROUP BY tipo`),
    q(`SELECT id, nome FROM verbetes`).catch(() => []),
    q(`SELECT id, nome FROM trilhas`).catch(() => []),
    q(`SELECT id, termo FROM glossario`).catch(() => []),
  ]);

  return { dias, diario, visitas: visitas[0]?.n || 0, secoes, nos, ligacoes, trilhas, buscas, refs, fontes, origens, disps,
    tempo: tempo[0] || {}, acoes, nomes: Object.fromEntries(nomes.map((r) => [r.id, r.nome])),
    nomesTr: Object.fromEntries(nomesTr.map((r) => [r.id, r.nome])),
    termos: Object.fromEntries(termos.map((r) => [r.id, r.termo])), hoje: diaSP() };
}

module.exports = { registrar, limpar, resumo, diaSP };
