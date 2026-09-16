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

mesma_historia_que: o agrupamento automático só junta títulos quase iguais, então a mesma história costuma chegar repetida com outras palavras (ex.: "Conselho do MPF analisa menções de Vorcaro a Gonet" e "Conselho do MP analisará mensagens de Vorcaro que citam Gonet"). Se o grupo relata o MESMO fato ou episódio de um item de HISTÓRIAS JÁ NA FILA, ou de outro grupo deste mesmo envio, informe o id dele; senão, 0. Mesma pessoa ou mesmo tema não basta: precisa ser o mesmo acontecimento. Etapas diferentes (pedido, depois decisão, depois entrega) são histórias diferentes.

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
          mesma_historia_que: { type: "integer" },
        },
        required: ["id", "categoria", "no_site", "motivo", "mesma_historia_que"],
        additionalProperties: false,
      },
    },
  },
  required: ["itens"],
  additionalProperties: false,
};

async function gruposPendentes() {
  const { rows } = await pool.query(`
    SELECT r.id, r.titulo, r.resumo, max(coalesce(m.publicado_em, m.encontrado_em)) AS quando,
           array_agg(DISTINCT m.veiculo) FILTER (WHERE m.veiculo IS NOT NULL) AS veiculos,
           (array_agg(m.titulo ORDER BY m.id))[1:4] AS titulos
      FROM noticias r JOIN noticias m ON m.grupo = r.id
     WHERE r.grupo = r.id AND r.categoria IS NULL AND r.status = 'novo'
     GROUP BY r.id
     ORDER BY max(coalesce(m.publicado_em, m.encontrado_em)) DESC
     LIMIT ${MAX_GRUPOS_POR_LOTE}`);
  /* em ordem de data, para cada bloco cobrir um periodo curto e a lista de historias proximas ser pequena */
  return rows.reverse();
}

/* historias ja na fila perto das datas do bloco, para a IA apontar repeticao com outras palavras */
async function historiasProximas(bloco) {
  const t = bloco.map((g) => new Date(g.quando).getTime());
  const { rows } = await pool.query(`
    SELECT r.id, r.titulo FROM noticias r
     WHERE r.grupo = r.id AND NOT (r.id = ANY($1::bigint[]))
       AND coalesce(r.publicado_em, r.encontrado_em) BETWEEN $2 AND $3
     ORDER BY coalesce(r.publicado_em, r.encontrado_em) DESC LIMIT 350`,
    [bloco.map((g) => g.id), new Date(Math.min(...t) - 2 * 86400000), new Date(Math.max(...t) + 2 * 86400000)]);
  return rows;
}

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
      const originais = grupos.slice(i, i + GRUPOS_POR_PEDIDO);
      const proximas = await historiasProximas(originais);
      const bloco = originais.map((g) => ({
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
          messages: [{ role: "user", content:
            "HISTÓRIAS JÁ NA FILA (id: título):\n" + (proximas.map((h) => `${h.id}: ${h.titulo}`).join("\n") || "(nenhuma)")
            + "\n\nGrupos de notícias para classificar:\n" + JSON.stringify(bloco) }],
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
    const fusoes = [];
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
      for (const it of ok) {
        const alvo = Number(it.mesma_historia_que);
        if (Number.isInteger(alvo) && alvo > 0 && alvo !== it.id) fusoes.push([it.id, alvo]);
      }
    }
    /* fusoes depois de gravar tudo, para o destino ja ter classificacao quando existir */
    let fundidos = 0;
    for (const [origem, destino] of fusoes) {
      try { if (await fundir(origem, destino)) fundidos++; } catch (e) { console.error("[triagem] fusao falhou:", e.message); }
    }
    await pool.query("DELETE FROM meta WHERE chave='triagem_lote'");
    const resumo = { quando: new Date().toISOString(), lote: info.id, grupos: gravados, fundidos, falhas, uso };
    await pool.query("INSERT INTO meta (chave,valor) VALUES ('triagem_ultima',$1) ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor", [JSON.stringify(resumo)]);
    console.log(`[triagem] lote ${info.id} terminou: ${gravados} grupo(s) classificados, ${fundidos} juntado(s) a outra história, ${falhas} pedido(s) com falha; tokens entrada=${uso.entrada} cache=${uso.cache} saida=${uso.saida}`);
    return resumo;
  } catch (e) {
    console.error("[triagem] conferir lote falhou:", e.status || "", e.message);
    /* lote que a API nao reconhece mais (expirado/cancelado) nao pode travar a fila */
    if (e.status === 404) await pool.query("DELETE FROM meta WHERE chave='triagem_lote'");
    return { erro: e.message };
  }
}


/* ---------- consolidacao: segunda passada so para achar repeticao ----------
   A classificacao compara cada grupo com uma lista longa e deixa passar
   repeticoes. Aqui, sem IA, juntamos em blocos as historias que dividem ao menos
   a mesma pessoa citada (ou a mesma palavra rara); a IA ve cada bloco curto e
   responde so quais relatam o mesmo acontecimento. */
const JANELA_CONSOLIDAR_DIAS = 5;
const MAX_POR_BLOCO = 40;
const radicais = (t) => new Set([...palavras(t)].map((w) => w.slice(0, 5)));

const INSTRUCOES_CONSOLIDAR = `Você ajuda o editor do "Feijoada do Master" (caso Banco Master / Daniel Vorcaro) a limpar a fila de notícias: a mesma história chega repetida por vários veículos, com palavras diferentes.

Recebe uma lista de histórias (id · data · título). Junte as que relatam o MESMO acontecimento: o mesmo fato, decisão, declaração ou documento, mesmo que um título traga um detalhe a mais (ex.: "Conselho do MP analisará mensagens de Vorcaro que citam Gonet" e "Conselho Superior do MPF marca sessão para analisar mensagens de Vorcaro sobre Gonet").

Não junte etapas diferentes de uma novela (pedido, depois decisão, depois entrega), nem fatos distintos sobre a mesma pessoa. Na dúvida, não junte.

Responda só os conjuntos com 2 ou mais ids, usando exatamente os ids recebidos. Se nada se repete, devolva a lista vazia.`;

const SCHEMA_CONSOLIDAR = {
  type: "object",
  properties: {
    grupos: {
      type: "array",
      items: {
        type: "object",
        properties: { ids: { type: "array", items: { type: "integer" } } },
        required: ["ids"],
        additionalProperties: false,
      },
    },
  },
  required: ["grupos"],
  additionalProperties: false,
};

/* blocos por ancora: a pessoa citada (ja marcada na coleta) ou, sem pessoa, a palavra
   mais rara do titulo. Componentes por semelhanca encadeavam tudo via "Moraes"/"STF". */
const ANCORAS_GENERICAS = new Set(["stf", "pf", "bc", "master", "vorcaro"]);
/* sobrenomes que sao palavra comum ou nome muito frequente: formariam blocos sem sentido */
const SOBRENOME_COMUM = new Set(("central federal jesus maxima pleno escritorios ameacados maceio amapa silva souza costa ferreira "
  + "rocha soares martin vieira batista barros santana rodrigues castro faria coelho vinicius").split(" "));
async function blocosParaConsolidar(dias) {
  const { rows } = await pool.query(`
    SELECT r.id, r.titulo, r.status, max(coalesce(m.publicado_em, m.encontrado_em)) AS quando,
           (SELECT coalesce(array_agg(DISTINCT p), '{}') FROM noticias x, unnest(x.pessoas) p WHERE x.grupo = r.id) AS pessoas
      FROM noticias r JOIN noticias m ON m.grupo = r.id
     WHERE r.grupo = r.id
     GROUP BY r.id
    HAVING max(coalesce(m.publicado_em, m.encontrado_em)) >= now() - make_interval(days => $1)
     ORDER BY quando`, [dias]);
  /* titulo com so o sobrenome ("Gonet confirma...") nao recebe a marca da pessoa na coleta;
     aqui o sobrenome conta quando e exclusivo de uma pessoa da rede e nao e palavra comum */
  const ver = (await pool.query("SELECT id, nome FROM verbetes")).rows;
  const contaSobrenome = new Map();
  const sobrenomes = ver.map((v) => {
    const partes = norm(v.nome.split(/[(,]/)[0]).trim().split(/s+/);
    const sob = partes.length > 1 ? partes[partes.length - 1] : null;
    if (sob) contaSobrenome.set(sob, (contaSobrenome.get(sob) || 0) + 1);
    return [v.id, sob];
  }).filter(([, sob]) => sob && sob.length >= 5);
  const exclusivos = sobrenomes.filter(([, sob]) => contaSobrenome.get(sob) === 1 && !VAZIAS.has(sob) && !SOBRENOME_COMUM.has(sob) && /^[a-z]+$/.test(sob))
    .map(([id, sob]) => [id, new RegExp("(^|[^a-z])" + sob + "($|[^a-z])")]);
  const itens = rows.map((r) => {
    const t = norm(r.titulo);
    const pessoas = new Set([...(r.pessoas || []), ...exclusivos.filter(([, re]) => re.test(t)).map(([id]) => id)]);
    return { ...r, pessoas: [...pessoas], id: Number(r.id), r: radicais(r.titulo), t: new Date(r.quando).getTime() };
  });
  const df = new Map();
  for (const i of itens) for (const w of i.r) df.set(w, (df.get(w) || 0) + 1);
  const porAncora = new Map();
  const poe = (k, i) => { if (!porAncora.has(k)) porAncora.set(k, []); porAncora.get(k).push(i); };
  for (const i of itens) {
    const pessoas = (i.pessoas || []).filter((p) => !ANCORAS_GENERICAS.has(p));
    if (pessoas.length) { for (const p of pessoas) poe("p:" + p, i); continue; }
    const rara = [...i.r].filter((w) => df.get(w) >= 2).sort((a, b) => df.get(a) - df.get(b))[0];
    if (rara) poe("w:" + rara, i);
  }
  /* so interessa bloco com alguma historia ainda aberta; bloco grande vira fatias por data */
  const blocos = [];
  for (const lista of porAncora.values()) {
    if (lista.length < 2 || !lista.some((i) => i.status === "novo")) continue;
    for (let k = 0; k < lista.length; k += MAX_POR_BLOCO) {
      const fatia = lista.slice(k, k + MAX_POR_BLOCO);
      if (fatia.length >= 2 && fatia.some((i) => i.status === "novo")) blocos.push(fatia);
    }
  }
  return blocos;
}

async function consolidar(dias) {
  const api = cliente();
  if (!api) return { pulado: true };
  const aberto = await pool.query("SELECT valor FROM meta WHERE chave='triagem_consolidacao'");
  if (aberto.rows.length) return { pendente: JSON.parse(aberto.rows[0].valor).id };
  /* a primeira consolidacao cobre a fila acumulada; as seguintes, so os ultimos dias */
  if (!dias) dias = (await pool.query("SELECT 1 FROM meta WHERE chave='triagem_consolidada'")).rows.length ? JANELA_CONSOLIDAR_DIAS : 15;
  try {
    const blocos = await blocosParaConsolidar(dias);
    if (!blocos.length) return { nada: true };
    const dia = (t) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
    const pedidos = blocos.map((b, i) => ({
      custom_id: `bloco-${i}`,
      params: {
        model: MODELO,
        max_tokens: 3000,
        system: [{ type: "text", text: INSTRUCOES_CONSOLIDAR }],
        messages: [{ role: "user", content: b.map((h) => `${h.id} · ${dia(h.t)} · ${h.titulo}`).join("\n") }],
        output_config: { format: { type: "json_schema", schema: SCHEMA_CONSOLIDAR } },
      },
    }));
    const lote = await api.messages.batches.create({ requests: pedidos });
    const historias = blocos.reduce((a, b) => a + b.length, 0);
    await pool.query("INSERT INTO meta (chave,valor) VALUES ('triagem_consolidacao',$1) ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor",
      [JSON.stringify({ id: lote.id, criado: new Date().toISOString(), blocos: blocos.length, historias })]);
    console.log(`[triagem] consolidação ${lote.id} criada: ${historias} história(s) em ${blocos.length} bloco(s)`);
    return { criado: lote.id, blocos: blocos.length, historias };
  } catch (e) {
    console.error("[triagem] criar consolidação falhou:", e.status || "", e.message);
    return { erro: e.message };
  }
}

async function conferirConsolidacao() {
  const api = cliente();
  if (!api) return { pulado: true };
  const aberto = await pool.query("SELECT valor FROM meta WHERE chave='triagem_consolidacao'");
  if (!aberto.rows.length) return { nada: true };
  const info = JSON.parse(aberto.rows[0].valor);
  try {
    const lote = await api.messages.batches.retrieve(info.id);
    if (lote.processing_status !== "ended") return { andamento: lote.processing_status };
    let fundidos = 0, falhas = 0;
    for await (const r of await api.messages.batches.results(info.id)) {
      const msg = r.result.type === "succeeded" ? r.result.message : null;
      const texto = msg && msg.stop_reason === "end_turn" && msg.content.find((b) => b.type === "text");
      if (!texto) { falhas++; continue; }
      let grupos;
      try { grupos = JSON.parse(texto.text).grupos || []; } catch { falhas++; continue; }
      for (const g of grupos) {
        const ids = [...new Set((g.ids || []).filter(Number.isInteger))];
        if (ids.length < 2) continue;
        /* destino: quem ja tem decisao tomada; senao o grupo com mais materias */
        const { rows } = await pool.query(`
          SELECT r.id, r.status, count(m.id)::int AS qtd FROM noticias r JOIN noticias m ON m.grupo = r.id
           WHERE r.id = ANY($1::bigint[]) AND r.grupo = r.id GROUP BY r.id`, [ids]);
        if (rows.length < 2) continue;
        rows.sort((a, b) => (a.status === "novo") - (b.status === "novo") || b.qtd - a.qtd || Number(a.id) - Number(b.id));
        const destino = Number(rows[0].id);
        for (const o of rows.slice(1)) {
          try { if (await fundir(Number(o.id), destino)) fundidos++; } catch (e) { console.error("[triagem] fusão falhou:", e.message); }
        }
      }
    }
    await pool.query("DELETE FROM meta WHERE chave='triagem_consolidacao'");
    await pool.query("INSERT INTO meta (chave,valor) VALUES ('triagem_consolidada',$1) ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor",
      [JSON.stringify({ quando: new Date().toISOString(), lote: info.id, historias: info.historias, fundidos, falhas })]);
    console.log(`[triagem] consolidação ${info.id} terminou: ${fundidos} história(s) juntadas, ${falhas} bloco(s) com falha`);
    return { fundidos, falhas };
  } catch (e) {
    console.error("[triagem] conferir consolidação falhou:", e.status || "", e.message);
    if (e.status === 404) await pool.query("DELETE FROM meta WHERE chave='triagem_consolidacao'");
    return { erro: e.message };
  }
}

async function refazerAbertas() {
  const r = await pool.query("UPDATE noticias SET categoria=NULL, no_site=NULL, motivo_ia=NULL, classificado_em=NULL WHERE status='novo' AND categoria IS NOT NULL");
  return r.rowCount;
}

async function situacao() {
  const r = await pool.query("SELECT chave, valor FROM meta WHERE chave IN ('triagem_lote','triagem_ultima','triagem_consolidacao','triagem_consolidada')");
  const m = Object.fromEntries(r.rows.map((x) => { try { return [x.chave, JSON.parse(x.valor)]; } catch { return [x.chave, null]; } }));
  return { ativa: !!process.env.ANTHROPIC_API_KEY, lote: m.triagem_lote || null, ultima: m.triagem_ultima || null,
    consolidacao: m.triagem_consolidacao || null, consolidada: m.triagem_consolidada || null };
}

/* depois de cada coleta: agrupa, fecha lote pronto e abre lote novo; entre coletas confere o lote a cada 5 min */
/* ordem: agrupa por palavras -> fecha lotes prontos -> classifica o que falta ->
   quando nao ha mais nada para classificar, consolida as repeticoes */
async function rodar() {
  try {
    const n = await agrupar();
    if (n) console.log(`[triagem] ${n} notícia(s) agrupadas`);
    await conferirLote();
    await conferirConsolidacao();
    const c = await classificar();
    if (c.nada) await consolidar();
  } catch (e) { console.error("[triagem] falhou:", e.message); }
}
function agendar() {
  setInterval(async () => {
    try {
      const r = await conferirLote();
      if (r && r.lote) { const c = await classificar(); if (c.nada) await consolidar(); }
      await conferirConsolidacao();
    } catch { /* registrado dentro */ }
  }, 5 * 60_000).unref();
}

module.exports = { agrupar, classificar, conferirLote, consolidar, conferirConsolidacao, blocosParaConsolidar, rodar, agendar, situacao, refazerAbertas, CATEGORIAS, palavras, parecidos };
