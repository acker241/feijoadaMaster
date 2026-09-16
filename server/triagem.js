/* Triagem da fila de noticias.
   1. agrupar(): a mesma historia publicada por varios veiculos vira um grupo
      (sem IA, por semelhanca de titulo). Noticia nova de grupo ja triado herda
      status e classificacao.
   2. classificar(): manda os grupos ainda sem categoria para o Claude Haiku pela
      Batch API (metade do preco, resultado em minutos) e grava categoria,
      se o fato ja esta no site e o motivo. A IA so rotula: descartar continua
      sendo decisao humana no painel. */
"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { pool } = require("./db");

const MODELO = "claude-haiku-4-5";
const GRUPOS_POR_PEDIDO = 20;
const MAX_GRUPOS_POR_LOTE = Math.max(1, Number(process.env.TRIAGEM_MAX_GRUPOS || 2000));
const JANELA_DIAS = 3;

const CATEGORIAS = ["fato_novo", "desdobramento", "declaracao", "analise", "campanha", "fora"];
const NO_SITE = ["sim", "parcial", "nao"];

/* ---------- agrupamento ---------- */
const VAZIAS = new Set(("vorcaro daniel banco master caso sobre apos para pelo pela pelos pelas como mais contra entre "
  + "diz dizem afirma veja entenda apura pode deve quer tera seria sera esta estao foram onde quando porque "
  + "ministro ministra ex-ministro presidente governo stf pf").split(" "));
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const palavras = (t) => new Set(norm(t).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !VAZIAS.has(w)));

function parecidos(a, b) {
  let comum = 0;
  for (const w of a) if (b.has(w)) comum++;
  /* Jaccard >= 0,5: com o minimo das duas listas, etapas diferentes da mesma novela viravam um grupo so */
  return comum >= 3 && comum / (a.size + b.size - comum) >= 0.5;
}

async function agrupar() {
  const soltas = (await pool.query(
    `SELECT id, titulo, coalesce(publicado_em, encontrado_em) AS quando
       FROM noticias WHERE grupo IS NULL ORDER BY quando, id`)).rows;
  if (!soltas.length) return 0;
  const desde = new Date(Math.min(...soltas.map((s) => new Date(s.quando).getTime())) - JANELA_DIAS * 86400000);
  const reps = (await pool.query(
    `SELECT id, titulo, coalesce(publicado_em, encontrado_em) AS quando, status, categoria, no_site, motivo_ia, classificado_em
       FROM noticias WHERE grupo = id AND coalesce(publicado_em, encontrado_em) >= $1 ORDER BY quando, id`, [desde])).rows
    .map((r) => ({ ...r, p: palavras(r.titulo), t: new Date(r.quando).getTime() }));

  const ids = [], grupos = [];
  for (const s of soltas) {
    const p = palavras(s.titulo), t = new Date(s.quando).getTime();
    const rep = p.size >= 3 && reps.find((r) => Math.abs(r.t - t) <= JANELA_DIAS * 86400000 && parecidos(p, r.p));
    if (rep) { ids.push(s.id); grupos.push(rep.id); }
    else { ids.push(s.id); grupos.push(s.id); reps.push({ id: s.id, p, t }); }
  }
  await pool.query("UPDATE noticias n SET grupo = u.g FROM unnest($1::bigint[], $2::bigint[]) AS u(i, g) WHERE n.id = u.i", [ids, grupos]);
  /* quem entrou num grupo ja triado herda a decisao e a classificacao */
  await pool.query(`
    UPDATE noticias n SET
      status = CASE WHEN n.status = 'novo' THEN r.status ELSE n.status END,
      categoria = coalesce(n.categoria, r.categoria), no_site = coalesce(n.no_site, r.no_site),
      motivo_ia = coalesce(n.motivo_ia, r.motivo_ia), classificado_em = coalesce(n.classificado_em, r.classificado_em)
    FROM noticias r
    WHERE n.id = ANY($1::bigint[]) AND n.grupo = r.id AND r.id <> n.id`, [ids]);
  return soltas.length;
}

/* ---------- classificacao por IA ---------- */
function cliente() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const opcoes = {};
  /* chave criada fora de um workspace exige o id do workspace em cada chamada */
  if (process.env.ANTHROPIC_WORKSPACE_ID) opcoes.defaultHeaders = { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID };
  return new Anthropic(opcoes);
}

const INSTRUCOES = `Você faz a triagem de notícias para o editor do "Feijoada do Master", site de apuração sobre o caso Banco Master / Daniel Vorcaro. O editor só quer gastar tempo com o que pode mudar o conteúdo do site: fatos novos e verificáveis. Muita cobertura é repetição, fala política ou opinião, e isso deve ficar separado.

Para cada grupo de notícias (a mesma história em um ou mais veículos), escolha UMA categoria:
- fato_novo: fato verificável que ainda não era público — operação ou busca, prisão, indiciamento, denúncia, decisão judicial, documento, relatório oficial, mensagem apreendida divulgada pela primeira vez, depoimento formal, bloqueio de bens, valores ou pagamentos revelados, admissão de fato por um envolvido (ex.: "admite encontro").
- desdobramento: andamento de um fato já conhecido — sessão marcada, prazo, pedido formal a um órgão, voto, adiamento, sigilo levantado, resposta oficial a uma apuração.
- declaracao: fala, crítica, acusação, cobrança ou defesa sem fato novo documentado (ex.: "Fulano diz que Beltrano tem que pagar", "X nega", "Y cobra investigação").
- analise: opinião, coluna, editorial, análise, explicativo ("entenda", "o que acontece agora"), bastidor especulativo, vídeo, podcast, debate de comentaristas.
- campanha: uso do caso na disputa eleitoral — propaganda, ataques entre candidatos, pesquisas, sabatinas e debates de candidatos.
- fora: não trata do caso Master/Vorcaro.

Em caso de dúvida entre fato_novo e desdobramento, prefira desdobramento. Uma negativa ou resposta de envolvido a uma acusação concreta é desdobramento só se trouxer informação nova; senão é declaracao.

Diga também se o fato central já está no site, comparando com o CONTEÚDO DO SITE abaixo:
- sim: o site já traz esse fato;
- parcial: a pessoa ou o episódio está no site, mas este fato específico não;
- nao: nada disso está no site.

motivo: uma frase curta em português (até 20 palavras) justificando a categoria, citando o fato concreto quando houver.
Responda para todos os grupos recebidos, usando exatamente os ids informados.`;

async function contextoDoSite() {
  const [ver, eve] = await Promise.all([
    pool.query("SELECT nome, papel, info FROM verbetes ORDER BY anel, ordem, id"),
    pool.query("SELECT data_txt, quem, texto FROM eventos ORDER BY fase, ordem, id"),
  ]);
  const corta = (t, n) => { t = String(t || "").replace(/\s+/g, " "); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  return "CONTEÚDO DO SITE\n\nFichas (nome — papel: resumo):\n"
    + ver.rows.map((v) => `- ${v.nome} — ${v.papel}: ${corta(v.info, 220)}`).join("\n")
    + "\n\nLinha do tempo:\n"
    + eve.rows.map((e) => `- ${e.data_txt} · ${e.quem}: ${corta(e.texto, 180)}`).join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          categoria: { type: "string", enum: CATEGORIAS },
          no_site: { type: "string", enum: NO_SITE },
          motivo: { type: "string" },
        },
        required: ["id", "categoria", "no_site", "motivo"],
        additionalProperties: false,
      },
    },
  },
  required: ["itens"],
  additionalProperties: false,
};

async function gruposPendentes() {
  const { rows } = await pool.query(`
    SELECT r.id, r.titulo, r.resumo,
           array_agg(DISTINCT m.veiculo) FILTER (WHERE m.veiculo IS NOT NULL) AS veiculos,
           (array_agg(m.titulo ORDER BY m.id))[1:4] AS titulos
      FROM noticias r JOIN noticias m ON m.grupo = r.id
     WHERE r.grupo = r.id AND r.categoria IS NULL AND r.status = 'novo'
     GROUP BY r.id
     ORDER BY max(coalesce(m.publicado_em, m.encontrado_em)) DESC
     LIMIT ${MAX_GRUPOS_POR_LOTE}`);
  return rows;
}

let loteEmAndamento = false;

/* cria um lote na Batch API; o id fica em meta para ser conferido depois */
async function classificar() {
  const api = cliente();
  if (!api || loteEmAndamento) return { pulado: true };
  const aberto = await pool.query("SELECT valor FROM meta WHERE chave='triagem_lote'");
  if (aberto.rows.length) return { pendente: JSON.parse(aberto.rows[0].valor).id };
  loteEmAndamento = true;
  try {
    const grupos = await gruposPendentes();
    if (!grupos.length) return { nada: true };
    const sistema = [
      { type: "text", text: INSTRUCOES },
      { type: "text", text: await contextoDoSite(), cache_control: { type: "ephemeral" } },
    ];
    const pedidos = [];
    for (let i = 0; i < grupos.length; i += GRUPOS_POR_PEDIDO) {
      const bloco = grupos.slice(i, i + GRUPOS_POR_PEDIDO).map((g) => ({
        id: Number(g.id),
        titulos: [...new Set([g.titulo, ...(g.titulos || [])])].slice(0, 4),
        veiculos: (g.veiculos || []).slice(0, 8),
        resumo: g.resumo ? String(g.resumo).slice(0, 300) : undefined,
      }));
      pedidos.push({
        custom_id: `bloco-${i / GRUPOS_POR_PEDIDO}`,
        params: {
          model: MODELO,
          max_tokens: 4000,
          system: sistema,
          messages: [{ role: "user", content: "Grupos de notícias para classificar:\n" + JSON.stringify(bloco) }],
          output_config: { format: { type: "json_schema", schema: SCHEMA } },
        },
      });
    }
    const lote = await api.messages.batches.create({ requests: pedidos });
    await pool.query("INSERT INTO meta (chave,valor) VALUES ('triagem_lote',$1) ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor",
      [JSON.stringify({ id: lote.id, criado: new Date().toISOString(), grupos: grupos.length, pedidos: pedidos.length })]);
    console.log(`[triagem] lote ${lote.id} criado: ${grupos.length} grupo(s) em ${pedidos.length} pedido(s)`);
    return { criado: lote.id, grupos: grupos.length };
  } catch (e) {
    console.error("[triagem] criar lote falhou:", e.status || "", e.message);
    return { erro: e.message };
  } finally {
    loteEmAndamento = false;
  }
}

/* confere o lote aberto; quando termina, grava as classificacoes no grupo todo */
async function conferirLote() {
  const api = cliente();
  if (!api) return { pulado: true };
  const aberto = await pool.query("SELECT valor FROM meta WHERE chave='triagem_lote'");
  if (!aberto.rows.length) return { nada: true };
  const info = JSON.parse(aberto.rows[0].valor);
  try {
    const lote = await api.messages.batches.retrieve(info.id);
    if (lote.processing_status !== "ended") return { andamento: lote.processing_status, contagem: lote.request_counts };
    let gravados = 0, falhas = 0;
    const uso = { entrada: 0, saida: 0, cache: 0 };
    for await (const r of await api.messages.batches.results(info.id)) {
      if (r.result.type !== "succeeded") { falhas++; continue; }
      const msg = r.result.message;
      uso.entrada += msg.usage.input_tokens || 0;
      uso.saida += msg.usage.output_tokens || 0;
      uso.cache += msg.usage.cache_read_input_tokens || 0;
      const texto = msg.content.find((b) => b.type === "text");
      if (msg.stop_reason !== "end_turn" || !texto) { falhas++; continue; }
      let itens;
      try { itens = JSON.parse(texto.text).itens || []; } catch { falhas++; continue; }
      const ok = itens.filter((it) => Number.isInteger(it.id) && CATEGORIAS.includes(it.categoria) && NO_SITE.includes(it.no_site));
      if (!ok.length) continue;
      await pool.query(`
        UPDATE noticias n SET categoria = u.c, no_site = u.s, motivo_ia = left(u.m, 300), classificado_em = now()
          FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[]) AS u(g, c, s, m)
         WHERE n.grupo = u.g AND n.categoria IS NULL`,
        [ok.map((i) => i.id), ok.map((i) => i.categoria), ok.map((i) => i.no_site), ok.map((i) => String(i.motivo || ""))]);
      gravados += ok.length;
    }
    await pool.query("DELETE FROM meta WHERE chave='triagem_lote'");
    const resumo = { quando: new Date().toISOString(), lote: info.id, grupos: gravados, falhas, uso };
    await pool.query("INSERT INTO meta (chave,valor) VALUES ('triagem_ultima',$1) ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor", [JSON.stringify(resumo)]);
    console.log(`[triagem] lote ${info.id} terminou: ${gravados} grupo(s) classificados, ${falhas} pedido(s) com falha; tokens entrada=${uso.entrada} cache=${uso.cache} saida=${uso.saida}`);
    return resumo;
  } catch (e) {
    console.error("[triagem] conferir lote falhou:", e.status || "", e.message);
    /* lote que a API nao reconhece mais (expirado/cancelado) nao pode travar a fila */
    if (e.status === 404) await pool.query("DELETE FROM meta WHERE chave='triagem_lote'");
    return { erro: e.message };
  }
}

async function situacao() {
  const r = await pool.query("SELECT chave, valor FROM meta WHERE chave IN ('triagem_lote','triagem_ultima')");
  const m = Object.fromEntries(r.rows.map((x) => { try { return [x.chave, JSON.parse(x.valor)]; } catch { return [x.chave, null]; } }));
  return { ativa: !!process.env.ANTHROPIC_API_KEY, lote: m.triagem_lote || null, ultima: m.triagem_ultima || null };
}

/* depois de cada coleta: agrupa, fecha lote pronto e abre lote novo; entre coletas confere o lote a cada 5 min */
async function rodar() {
  try {
    const n = await agrupar();
    if (n) console.log(`[triagem] ${n} notícia(s) agrupadas`);
    await conferirLote();
    await classificar();
  } catch (e) { console.error("[triagem] falhou:", e.message); }
}
function agendar() {
  setInterval(async () => {
    try { const r = await conferirLote(); if (r && r.lote) await classificar(); } catch { /* registrado dentro */ }
  }, 5 * 60_000).unref();
}

module.exports = { agrupar, classificar, conferirLote, rodar, agendar, situacao, CATEGORIAS, palavras, parecidos };
