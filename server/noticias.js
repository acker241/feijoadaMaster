/* Monitor de noticias: procura materias novas sobre o caso e sobre as pessoas
   da rede, e poe numa fila do painel para triagem. Nao altera o conteudo do
   site: o que entrar na pagina continua passando pela edicao manual.

   Tres caminhos, porque nenhum cobre tudo sozinho:
   - Google News geral (teto de ~100 itens por consulta);
   - Google News com site:dominio para cada veiculo (pega os grandes);
   - RSS proprio do veiculo (pega quem o Google News indexa mal: piaui, Ninja, ICL). */
"use strict";

const { pool } = require("./db");

const HORAS = Math.max(1, Number(process.env.NOTICIAS_HORAS || 6));
const ATIVO = process.env.NOTICIAS_ATIVO !== "0";
const UA = "Mozilla/5.0 (compatible; FeijoadaDoMaster-monitor/1.0; +https://www.feijoadadomaster.com.br)";
const PAUSA_GN_MS = 1500;
const TERMO = /vorcaro|\bmaster\b/i;
const TERMO_BUSCA = '(Vorcaro OR "Banco Master")';

/* [dominio, nome, grupo, rss (espaco separa varios), usar busca no Google News] */
const VEICULOS = [
  ["g1.globo.com", "G1", "grande", "https://g1.globo.com/rss/g1/politica/", true],
  ["oglobo.globo.com", "O Globo", "grande", null, true],
  ["folha.uol.com.br", "Folha de S.Paulo", "grande", "https://feeds.folha.uol.com.br/poder/rss091.xml https://feeds.folha.uol.com.br/mercado/rss091.xml", true],
  ["uol.com.br", "UOL", "grande", null, true],
  ["estadao.com.br", "Estadão", "grande", "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/", true],
  ["valor.globo.com", "Valor Econômico", "grande", "https://valor.globo.com/rss/valor", true],
  ["veja.abril.com.br", "Veja", "grande", "https://veja.abril.com.br/feed/", true],
  ["cnnbrasil.com.br", "CNN Brasil", "grande", "https://www.cnnbrasil.com.br/feed/", true],
  ["metropoles.com", "Metrópoles", "grande", "https://www.metropoles.com/feed", true],
  ["poder360.com.br", "Poder360", "grande", "https://www.poder360.com.br/feed/", true],
  ["correiobraziliense.com.br", "Correio Braziliense", "grande", null, true],
  ["gazetadopovo.com.br", "Gazeta do Povo", "grande", "https://www.gazetadopovo.com.br/feed/rss/republica.xml", true],
  ["exame.com", "Exame", "grande", null, true],
  ["infomoney.com.br", "InfoMoney", "grande", "https://www.infomoney.com.br/feed/", true],
  ["band.com.br", "Band", "grande", null, true],
  ["r7.com", "R7", "grande", null, true],
  ["istoe.com.br", "IstoÉ", "grande", null, true],
  ["cartacapital.com.br", "CartaCapital", "grande", "https://www.cartacapital.com.br/feed/", true],
  ["bbc.com", "BBC News Brasil", "grande", "https://feeds.bbci.co.uk/portuguese/rss.xml", true],
  ["agenciabrasil.ebc.com.br", "Agência Brasil", "grande", "https://agenciabrasil.ebc.com.br/rss/politica/feed.xml", true],
  ["piaui.uol.com.br", "revista piauí", "independente", "https://piaui.uol.com.br/feed/", true],
  ["apublica.org", "Agência Pública", "independente", "https://apublica.org/feed/", true],
  ["intercept.com.br", "Intercept Brasil", "independente", "https://www.intercept.com.br/feed/", true],
  ["midianinja.org", "Mídia Ninja", "independente", "https://midianinja.org/feed/", true],
  ["iclnoticias.com.br", "ICL Notícias", "independente", "https://iclnoticias.com.br/feed/", true],
  ["brasildefato.com.br", "Brasil de Fato", "independente", null, true],
  ["revistaforum.com.br", "Revista Fórum", "independente", null, true],
  ["brasil247.com", "Brasil 247", "independente", null, true],
  ["diariodocentrodomundo.com.br", "DCM", "independente", null, true],
  ["nexojornal.com.br", "Nexo", "independente", "https://www.nexojornal.com.br/rss.xml", true],
  ["aosfatos.org", "Aos Fatos", "independente", null, true],
  ["congressoemfoco.com.br", "Congresso em Foco", "independente", "https://www.congressoemfoco.com.br/feed", true],
  ["crusoe.com.br", "Crusoé", "independente", null, true],
  ["revistaoeste.com", "Revista Oeste", "independente", null, true],
  ["jota.info", "JOTA", "especializado", "https://www.jota.info/feed", true],
  ["conjur.com.br", "Conjur", "especializado", "https://www.conjur.com.br/rss.xml", true],
  ["migalhas.com.br", "Migalhas", "especializado", null, true],
  ["braziljournal.com", "Brazil Journal", "especializado", null, true],
  ["neofeed.com.br", "NeoFeed", "especializado", null, true],
  ["monitormercantil.com.br", "Monitor Mercantil", "especializado", null, true],
  ["timesbrasil.com.br", "Times Brasil", "especializado", null, true],
  ["jornaldebrasilia.com.br", "Jornal de Brasília", "regional", null, true],
  ["em.com.br", "Estado de Minas", "regional", null, true],
  ["otempo.com.br", "O Tempo", "regional", null, true],
  ["itatiaia.com.br", "Rádio Itatiaia", "regional", null, true],
  ["ndmais.com.br", "ND Mais", "regional", null, true],
  ["obrasilianista.com.br", "O Brasilianista", "regional", null, true],
];

async function semear() {
  for (const [dominio, nome, grupo, rss, busca] of VEICULOS) {
    await pool.query(
      "INSERT INTO veiculos (dominio,nome,grupo,rss,busca) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dominio) DO NOTHING",
      [dominio, nome, grupo, rss, busca]);
  }
}

/* ---------- leitura de feed sem dependencia ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodifica(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const semTags = (s) => decodifica(decodifica(s)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
function tag(bloco, nome) {
  const m = new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, "i").exec(bloco);
  return m ? m[1] : "";
}

function lerFeed(xml) {
  const itens = [];
  for (const [bloco] of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    let link = decodifica(tag(bloco, "link")).trim();
    if (!link) link = (/<link[^>]*href="([^"]+)"/i.exec(bloco) || [])[1] || "";
    const fonte = /<source[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i.exec(bloco);
    const data = tag(bloco, "pubDate") || tag(bloco, "published") || tag(bloco, "updated") || tag(bloco, "dc:date");
    const quando = data ? new Date(decodifica(data).trim()) : null;
    itens.push({
      titulo: semTags(tag(bloco, "title")),
      link: decodifica(link),
      resumo: semTags(tag(bloco, "description") || tag(bloco, "summary")).slice(0, 600),
      /* corpo inteiro so para achar o termo e as pessoas: muita materia cita o caso fora do titulo */
      corpo: semTags(tag(bloco, "content:encoded") || tag(bloco, "content")).slice(0, 20000),
      publicado: quando && !isNaN(quando) ? quando : null,
      fonteUrl: fonte ? decodifica(fonte[1]) : null,
      fonteNome: fonte ? semTags(fonte[2]) : null,
    });
  }
  return itens;
}

async function baixar(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(20000), redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const decl = /encoding="([^"]+)"/i.exec(buf.subarray(0, 200).toString("latin1"));
  const cs = (/charset=([^;]+)/i.exec(r.headers.get("content-type") || "") || [])[1] || (decl && decl[1]) || "utf-8";
  try { return new TextDecoder(cs.trim().toLowerCase()).decode(buf); } catch { return buf.toString("utf8"); }
}

const gnUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const hostDe = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\d*\./, ""); } catch { return null; } };

/* ---------- pessoas da rede ---------- */
async function carregarPessoas() {
  const { rows } = await pool.query("SELECT id, nome, anel FROM verbetes");
  return rows.map((v) => {
    const apelidos = v.nome.split(/[(),]/).map((x) => x.trim()).filter((x) => x.length >= 3);
    const re = apelidos.map((a) => new RegExp(`(^|[^a-z0-9])${norm(a).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`));
    return { id: v.id, nome: v.nome, anel: v.anel, re };
  });
}
/* Vorcaro e o Banco Master aparecem em quase toda materia; marcar os dois so faria ruido */
const SEM_MARCA = new Set(["vorcaro", "master"]);
const marcar = (texto, pessoas) => { const t = norm(texto); return pessoas.filter((p) => !SEM_MARCA.has(p.id) && p.re.some((r) => r.test(t))).map((p) => p.id); };

/* ---------- coleta ---------- */
let rodando = false;
let ultimoResumo = null;

async function coletar({ pessoasTambem = false, motivo = "agenda" } = {}) {
  if (rodando) return { ocupado: true };
  rodando = true;
  const inicio = Date.now();
  const novas = [];
  try {
    const veiculos = (await pool.query("SELECT * FROM veiculos WHERE ativo ORDER BY dominio")).rows;
    const pessoas = await carregarPessoas();
    /* dominio da materia -> veiculo cadastrado (sufixo mais longo: piaui antes de folha) */
    const porSufixo = [...veiculos].sort((a, b) => b.dominio.length - a.dominio.length);
    const veiculoDe = (host) => host && porSufixo.find((v) => host === v.dominio || host.endsWith("." + v.dominio));
    const contagem = new Map();

    async function guardar(item, via, exigeTermo, pessoaDaBusca) {
      if (!item.titulo || !/^https?:\/\//i.test(item.link)) return;
      let titulo = item.titulo;
      if (item.fonteNome && titulo.endsWith(" - " + item.fonteNome)) titulo = titulo.slice(0, -(item.fonteNome.length + 3));
      const texto = `${titulo} ${item.resumo} ${item.corpo || ""}`;
      if (exigeTermo && !TERMO.test(texto) && !(pessoaDaBusca && marcar(titulo, [pessoaDaBusca]).length)) return;
      if (item.publicado && Date.now() - item.publicado.getTime() > 30 * 86400000) return;
      const host = hostDe(item.fonteUrl) || hostDe(item.link);
      /* no RSS o dono do feed manda (piaui.uol.com.br nao pode virar UOL); na busca vale o dominio da materia */
      const v = via.rotulo === "rss" ? veiculoDe(via.dominio) : veiculoDe(host) || veiculoDe(via.dominio);
      const dominio = v ? v.dominio : host;
      const chave = norm(titulo).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 140) + "|" + dominio;
      const ps = marcar(texto, pessoas);
      const r = await pool.query(
        `INSERT INTO noticias (chave,titulo,url,dominio,veiculo,resumo,publicado_em,pessoas,via)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (chave) DO UPDATE SET
           url = CASE WHEN noticias.url LIKE 'https://news.google.com/%' AND EXCLUDED.url NOT LIKE 'https://news.google.com/%' THEN EXCLUDED.url ELSE noticias.url END,
           pessoas = ARRAY(SELECT DISTINCT unnest(noticias.pessoas || EXCLUDED.pessoas))
         RETURNING (xmax = 0) AS nova, id`,
        [chave, titulo.slice(0, 400), item.link.slice(0, 2000), dominio, v ? v.nome : item.fonteNome || host, item.resumo === titulo ? null : item.resumo || null,
          item.publicado, ps, via.rotulo]);
      if (r.rows[0].nova) {
        novas.push({ titulo, veiculo: v ? v.nome : item.fonteNome || host, pessoas: ps });
        if (v) contagem.set(v.dominio, (contagem.get(v.dominio) || 0) + 1);
      }
    }

    async function ler(url, via, exigeTermo, pessoa) {
      const itens = lerFeed(await baixar(url));
      for (const it of itens) await guardar(it, via, exigeTermo, pessoa);
      return itens.length;
    }

    /* 1. Google News geral */
    for (const q of ['"Vorcaro" when:2d', '"Banco Master" when:2d']) {
      try { await ler(gnUrl(q), { rotulo: "google news" }, true); } catch (e) { console.error("[noticias] google geral:", e.message); }
      await espera(PAUSA_GN_MS);
    }

    /* 2 e 3. por veiculo: busca com site: e RSS proprio */
    for (const v of veiculos) {
      const erros = [];
      if (v.busca) {
        try { await ler(gnUrl(`${TERMO_BUSCA} site:${v.dominio} when:7d`), { rotulo: "google news (site)", dominio: v.dominio }, true); }
        catch (e) { erros.push("busca: " + e.message); }
        await espera(PAUSA_GN_MS);
      }
      for (const feed of String(v.rss || "").split(/\s+/).filter(Boolean)) {
        try { await ler(feed, { rotulo: "rss", dominio: v.dominio }, true); }
        catch (e) { erros.push("rss: " + e.message); }
      }
      await pool.query("UPDATE veiculos SET ultima_coleta=now(), ultimo_erro=$2, achadas=achadas+$3 WHERE dominio=$1",
        [v.dominio, erros.length ? erros.join("; ").slice(0, 300) : null, contagem.get(v.dominio) || 0]);
    }

    /* 4. pessoas dos aneis de dentro, uma vez por dia */
    if (pessoasTambem) {
      const alvo = pessoas.filter((p) => p.anel <= 2 && !SEM_MARCA.has(p.id));
      for (const p of alvo) {
        const nome = p.nome.split(/[(,]/)[0].trim();
        try { await ler(gnUrl(`"${nome}" ${TERMO_BUSCA} when:7d`), { rotulo: "google news (pessoa)" }, true, p); }
        catch (e) { console.error(`[noticias] pessoa ${p.id}:`, e.message); }
        await espera(PAUSA_GN_MS);
      }
      await pool.query("INSERT INTO meta (chave,valor) VALUES ('noticias_pessoas',$1) ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor", [new Date().toISOString()]);
    }

    await pool.query("DELETE FROM noticias WHERE status='descartado' AND encontrado_em < now() - interval '60 days'");
    ultimoResumo = { quando: new Date(), novas: novas.length, segundos: Math.round((Date.now() - inicio) / 1000), motivo, pessoas: pessoasTambem };
    await pool.query("INSERT INTO meta (chave,valor) VALUES ('noticias_ultima',$1) ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor", [JSON.stringify(ultimoResumo)]);
    console.log(`[noticias] coleta (${motivo}) terminou: ${novas.length} nova(s) em ${ultimoResumo.segundos}s`);
    return { novas, resumo: ultimoResumo };
  } catch (e) {
    console.error("[noticias] coleta falhou:", e.message);
    return { erro: e.message };
  } finally {
    rodando = false;
  }
}

async function precisaPessoas() {
  const r = await pool.query("SELECT valor FROM meta WHERE chave='noticias_pessoas'");
  return !r.rows.length || Date.now() - new Date(r.rows[0].valor).getTime() > 20 * 3600000;
}

/* aviso: um resumo por coleta, so quando ha novidade */
function agendar(avisar) {
  if (!ATIVO) { console.log("[noticias] monitor desligado (NOTICIAS_ATIVO=0)"); return; }
  const rodada = async (motivo) => {
    const r = await coletar({ pessoasTambem: await precisaPessoas().catch(() => false), motivo });
    if (r.novas && r.novas.length && avisar) avisar(r.novas);
  };
  setTimeout(() => rodada("inicio"), 2 * 60_000).unref();
  setInterval(() => rodada("agenda"), HORAS * 3600_000).unref();
  console.log(`[noticias] monitor ligado: a cada ${HORAS}h`);
}

module.exports = { semear, coletar, agendar, estaRodando: () => rodando, lerFeed, VEICULOS };
