/* Triagem da fila de noticias, em quatro passos por rodada:
   1. embeddings: cada titulo vira um vetor de significado (modelo local, sem custo);
   2. historias: grupos cuja similaridade media passa de LIM_HISTORIA se juntam
      (mesmo fato contado com outras palavras), em janela de 3 dias;
   3. assuntos: historias com similaridade media acima de LIM_ASSUNTO formam um
      assunto (tema), usado para mostrar repercussao no painel;
   4. classificacao: grupos sem categoria vao para o Claude Haiku pela Batch API.
   A IA nao junta historias: nos testes o Haiku juntava etapas diferentes da mesma
   novela ("Zanin pede acesso" com "PF entrega dados"), e os embeddings nao.
   Juntar nunca apaga nada, e o grupo resultante mantem a decisao ja tomada.
   A IA so rotula: descartar continua sendo decisao humana no painel. */
"use strict";

const Anthropic = require("@anthropic-ai/sdk");
const { pool } = require("./db");
const embeddings = require("./embeddings");

const MODELO = "claude-haiku-4-5";
const GRUPOS_POR_PEDIDO = 20;
const MAX_GRUPOS_POR_LOTE = Math.max(1, Number(process.env.TRIAGEM_MAX_GRUPOS || 2000));

/* calibrados em ~2.900 titulos reais: 0,78 junta so o mesmo fato (0,73 ja juntava
   "Zanin pede acesso" com "Zanin recebe a integra"); 0,6 junta o tema */
const LIM_HISTORIA = Number(process.env.TRIAGEM_LIM_HISTORIA || 0.78);
const LIM_ASSUNTO = Number(process.env.TRIAGEM_LIM_ASSUNTO || 0.6);
const JANELA_MS = 3 * 86400000;

const CATEGORIAS = ["fato_novo", "desdobramento", "declaracao", "analise", "campanha", "fora"];
const NO_SITE = ["sim", "parcial", "nao"];

function cliente() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const opcoes = {};
  /* chave criada fora de um workspace exige o id do workspace em cada chamada */
  if (process.env.ANTHROPIC_WORKSPACE_ID) opcoes.defaultHeaders = { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID };
  return new Anthropic(opcoes);
}

async function gravarMeta(chave, valor) {
  await pool.query("INSERT INTO meta (chave,valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor", [chave, JSON.stringify(valor)]);
}
async function lerMeta(chave) {
  const r = await pool.query("SELECT valor FROM meta WHERE chave=$1", [chave]);
  try { return r.rows.length ? JSON.parse(r.rows[0].valor) : null; } catch { return null; }
}

/* ---------- fusao de grupos ---------- */

/* junta o grupo origem no destino; o destino manda na classificacao e na decisao ja tomada */
async function fundir(origem, destino) {
  const r = await pool.query(
    "SELECT id, grupo, status, categoria, no_site, motivo_ia FROM noticias WHERE id = ANY($1::bigint[])", [[origem, destino]]);
  const o = r.rows.find((x) => Number(x.id) === origem), d = r.rows.find((x) => Number(x.id) === destino);
  if (!o || !d || Number(o.grupo) !== origem || Number(d.grupo) !== destino) return false;
  const cli = await pool.connect();
  try {
    await cli.query("BEGIN");
    await cli.query("UPDATE noticias SET grupo = $1 WHERE grupo = $2", [destino, origem]);
    if (d.categoria) {
      await cli.query("UPDATE noticias SET categoria=$2, no_site=$3, motivo_ia=$4, classificado_em=now() WHERE grupo=$1",
        [destino, d.categoria, d.no_site, d.motivo_ia]);
    } else if (o.categoria) {
      await cli.query("UPDATE noticias SET categoria=$2, no_site=$3, motivo_ia=$4, classificado_em=now() WHERE grupo=$1",
        [destino, o.categoria, o.no_site, o.motivo_ia]);
    }
    if (d.status !== "novo") await cli.query("UPDATE noticias SET status=$2 WHERE grupo=$1 AND status='novo'", [destino, d.status]);
    await cli.query("COMMIT");
    return true;
  } catch (e) {
    await cli.query("ROLLBACK");
    throw e;
  } finally { cli.release(); }
}

/* junta um conjunto de grupos; destino: quem ja tem decisao tomada, senao o maior */
async function juntarConjunto(ids) {
  const { rows } = await pool.query(`
    SELECT r.id, r.status, count(m.id)::int AS qtd FROM noticias r JOIN noticias m ON m.grupo = r.id
     WHERE r.id = ANY($1::bigint[]) AND r.grupo = r.id GROUP BY r.id`, [ids]);
  if (rows.length < 2) return 0;
  rows.sort((a, b) => (a.status === "novo") - (b.status === "novo") || b.qtd - a.qtd || Number(a.id) - Number(b.id));
  const destino = Number(rows[0].id);
  let n = 0;
  for (const o of rows.slice(1)) if (await fundir(Number(o.id), destino)) n++;
  return n;
}

/* ---------- embeddings e agrupamento ---------- */

const produto = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function vetorizarPendentes() {
  await pool.query("UPDATE noticias SET grupo = id WHERE grupo IS NULL");
  let total = 0;
  for (;;) {
    const { rows } = await pool.query("SELECT id, titulo FROM noticias WHERE vetor IS NULL ORDER BY id LIMIT 512");
    if (!rows.length) break;
    const vetores = await embeddings.vetorizar(rows.map((r) => r.titulo));
    await pool.query("UPDATE noticias n SET vetor = u.v::real[] FROM unnest($1::bigint[], $2::text[]) AS u(id, v) WHERE n.id = u.id",
      [rows.map((r) => r.id), vetores.map((v) => "{" + v.map((x) => x.toFixed(5)).join(",") + "}")]);
    total += rows.length;
  }
  return total;
}

/* grupos ativos na janela, com o centroide (media dos vetores das materias) */
async function carregarGrupos(dias) {
  const { rows } = await pool.query(`
    SELECT n.grupo, n.vetor, coalesce(n.publicado_em, n.encontrado_em) AS quando
      FROM noticias n
     WHERE n.vetor IS NOT NULL AND n.grupo IN (
       SELECT grupo FROM noticias GROUP BY grupo
       HAVING max(coalesce(publicado_em, encontrado_em)) >= now() - make_interval(days => $1))`, [dias]);
  const grupos = new Map();
  for (const r of rows) {
    const id = Number(r.grupo);
    let g = grupos.get(id);
    if (!g) { g = { id, soma: new Float64Array(r.vetor.length), n: 0, t: 0 }; grupos.set(id, g); }
    for (let i = 0; i < r.vetor.length; i++) g.soma[i] += r.vetor[i];
    g.n++;
    g.t = Math.max(g.t, new Date(r.quando).getTime());
  }
  return [...grupos.values()];
}

/* aglomerativo por ligacao media: a media das similaridades entre dois grupos e o
   produto escalar dos centroides. Unir dois grupos nunca cria par novo acima do
   limite, entao basta a lista inicial de pares. Devolve os conjuntos com 2+ grupos. */
function aglomerar(grupos, limite) {
  const itens = grupos.map((g) => ({ ids: [g.id], soma: Float64Array.from(g.soma), n: g.n, t: g.t }));
  itens.sort((a, b) => a.t - b.t);
  const media = (x) => x.soma.map((v) => v / x.n);
  const centro = itens.map(media);
  const pares = [];
  for (let a = 0; a < itens.length; a++) {
    for (let b = a + 1; b < itens.length; b++) {
      if (itens[b].t - itens[a].t > JANELA_MS) break;
      const s = produto(centro[a], centro[b]);
      if (s >= limite) pares.push([s, a, b]);
    }
  }
  pares.sort((x, y) => y[0] - x[0]);
  const pai = itens.map((_, i) => i);
  const raiz = (i) => { while (pai[i] !== i) { pai[i] = pai[pai[i]]; i = pai[i]; } return i; };
  for (const [, a, b] of pares) {
    const ra = raiz(a), rb = raiz(b);
    if (ra === rb) continue;
    const A = itens[ra], B = itens[rb];
    if (produto(A.soma, B.soma) / (A.n * B.n) < limite) continue;
    for (let i = 0; i < A.soma.length; i++) A.soma[i] += B.soma[i];
    A.n += B.n; A.t = Math.max(A.t, B.t); A.ids = A.ids.concat(B.ids);
    pai[rb] = ra;
  }
  return itens.filter((x, i) => raiz(i) === i && x.ids.length > 1).map((x) => x.ids);
}

async function agruparHistorias(dias) {
  const conjuntos = aglomerar(await carregarGrupos(dias), LIM_HISTORIA);
  let juntadas = 0;
  for (const ids of conjuntos) {
    try { juntadas += await juntarConjunto(ids); } catch (e) { console.error("[triagem] juntar falhou:", e.message); }
  }
  return juntadas;
}

async function marcarAssuntos(dias) {
  const grupos = await carregarGrupos(dias);
  const conjuntos = aglomerar(grupos, LIM_ASSUNTO);
  /* assunto = id do grupo com mais materias; grupo sozinho e o proprio assunto */
  const porId = new Map(grupos.map((g) => [g.id, g]));
  const gs = [], as = [];
  const emConjunto = new Set();
  for (const ids of conjuntos) {
    const lider = ids.reduce((m, id) => (porId.get(id).n > porId.get(m).n ? id : m), ids[0]);
    for (const id of ids) { gs.push(id); as.push(lider); emConjunto.add(id); }
  }
  for (const g of grupos) if (!emConjunto.has(g.id)) { gs.push(g.id); as.push(g.id); }
  if (gs.length) {
    await pool.query("UPDATE noticias n SET assunto = u.a FROM unnest($1::bigint[], $2::bigint[]) AS u(g, a) WHERE n.grupo = u.g",
      [gs, as]);
  }
  return conjuntos.length;
}

/* ---------- classificacao por IA (Batch API) ---------- */

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

/* cria um lote na Batch API; o id fica em meta para ser conferido depois */
async function classificar() {
  const api = cliente();
  if (!api) return { pulado: true };
  if (await lerMeta("triagem_lote")) return { pendente: true };
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
    await gravarMeta("triagem_lote", { id: lote.id, criado: new Date().toISOString(), grupos: grupos.length, pedidos: pedidos.length });
    console.log(`[triagem] lote ${lote.id} criado: ${grupos.length} grupo(s) em ${pedidos.length} pedido(s)`);
    return { criado: lote.id, grupos: grupos.length };
  } catch (e) {
    console.error("[triagem] criar lote falhou:", e.status || "", e.message);
    return { erro: e.message };
  }
}

/* confere o lote aberto; quando termina, grava as classificacoes no grupo todo */
async function conferirLote() {
  const api = cliente();
  if (!api) return { pulado: true };
  const info = await lerMeta("triagem_lote");
  if (!info) return { nada: true };
  try {
    const lote = await api.messages.batches.retrieve(info.id);
    if (lote.processing_status !== "ended") return { andamento: lote.processing_status };
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
    await gravarMeta("triagem_ultima", resumo);
    console.log(`[triagem] lote ${info.id} terminou: ${gravados} grupo(s) classificados, ${falhas} pedido(s) com falha; tokens entrada=${uso.entrada} cache=${uso.cache} saida=${uso.saida}`);
    return resumo;
  } catch (e) {
    console.error("[triagem] conferir lote falhou:", e.status || "", e.message);
    /* lote que a API nao reconhece mais (expirado/cancelado) nao pode travar a fila */
    if (e.status === 404) await pool.query("DELETE FROM meta WHERE chave='triagem_lote'");
    return { erro: e.message };
  }
}

async function refazerAbertas() {
  const r = await pool.query("UPDATE noticias SET categoria=NULL, no_site=NULL, motivo_ia=NULL, classificado_em=NULL WHERE status='novo' AND categoria IS NOT NULL");
  return r.rowCount;
}

async function situacao() {
  const [lote, ultima, agrupamento] = await Promise.all([lerMeta("triagem_lote"), lerMeta("triagem_ultima"), lerMeta("triagem_agrupamento")]);
  return { ativa: !!process.env.ANTHROPIC_API_KEY, lote, ultima, agrupamento, rodando };
}

/* ---------- rodada ---------- */

let rodando = false;

async function rodar() {
  if (rodando) return { ocupado: true };
  rodando = true;
  const inicio = Date.now();
  try {
    /* a primeira rodada com embeddings desfaz os grupos das versoes anteriores (palavras
       e juntas feitas pela IA) e reagrupa do zero; status e nota ficam em cada noticia */
    const primeira = !(await lerMeta("triagem_agrupamento"));
    if (primeira) await pool.query("UPDATE noticias SET grupo = id, assunto = NULL");
    const dias = primeira ? 15 : 5;
    let vetorizadas = 0, juntadas = 0, assuntos = 0;
    try {
      vetorizadas = await vetorizarPendentes();
      juntadas = await agruparHistorias(dias);
      assuntos = await marcarAssuntos(dias);
    } finally {
      await embeddings.liberar();
    }
    const resumo = { quando: new Date().toISOString(), dias, vetorizadas, juntadas, assuntos, segundos: Math.round((Date.now() - inicio) / 1000) };
    await gravarMeta("triagem_agrupamento", resumo);
    console.log(`[triagem] agrupamento: ${vetorizadas} vetorizada(s), ${juntadas} história(s) juntadas por semelhança, ${assuntos} assunto(s) com 2+ histórias, em ${resumo.segundos}s`);
    await conferirLote();
    await classificar();
    return resumo;
  } catch (e) {
    console.error("[triagem] falhou:", e.message);
    return { erro: e.message };
  } finally {
    rodando = false;
  }
}

/* entre rodadas, so confere o lote de classificacao (nao carrega o modelo) */
function agendar() {
  setInterval(async () => {
    try { const r = await conferirLote(); if (r && r.lote) await classificar(); } catch { /* registrado dentro */ }
  }, 5 * 60_000).unref();
}

module.exports = { rodar, agendar, situacao, refazerAbertas, classificar, conferirLote, aglomerar, CATEGORIAS, LIM_HISTORIA, LIM_ASSUNTO };
