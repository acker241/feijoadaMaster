/* Conteudo do site no banco: semeadura, leitura para /api/dados e CRUD do painel.
   Toda alteracao vinda do painel grava uma linha em `errata`. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pool } = require("./db");

/* ---------- semeadura ---------- */
async function semear() {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"));
  const c = await pool.connect();
  const feito = [];
  const vazia = async (t) => (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n === 0;
  try {
    await c.query("BEGIN");

    /* catalogos: idempotentes, entram novos itens sem apagar os existentes */
    for (const f of seed.fontes) await c.query("INSERT INTO fontes (id,rotulo,url) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [f.id, f.rotulo, f.url]);
    for (const k of seed.categorias) await c.query("INSERT INTO categorias (id,nome,cor,ordem) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", [k.id, k.nome, k.cor, k.ordem]);
    for (const a of seed.aneis) await c.query("INSERT INTO aneis (nivel,nome) VALUES ($1,$2) ON CONFLICT (nivel) DO NOTHING", [a.nivel, a.nome]);
    for (const t of seed.tipos_vinculo) await c.query("INSERT INTO tipos_vinculo (id,nome,cor) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [t.id, t.nome, t.cor]);

    /* tabelas de conteudo: so semeia a que estiver vazia, para nao duplicar
       nem sobrescrever o que foi editado pelo painel */
    if (await vazia("fases")) {
      for (const f of seed.fases) await c.query("INSERT INTO fases (ordem,tag,titulo,subtitulo) VALUES ($1,$2,$3,$4) ON CONFLICT (ordem) DO NOTHING", [f.ordem, f.tag, f.titulo, f.subtitulo]);
      feito.push(`${seed.fases.length} fases`);
    }
    if (await vazia("eventos")) {
      for (const e of seed.eventos) await c.query("INSERT INTO eventos (fase,ordem,data_txt,categoria,quem,texto) VALUES ($1,$2,$3,$4,$5,$6)", [e.fase, e.ordem, e.data_txt, e.categoria, e.quem, e.texto]);
      feito.push(`${seed.eventos.length} eventos`);
    }
    /* verbetes e vinculos entram por identidade: o que ja existe fica como esta
       (inclusive o que foi editado no painel), o que e novo no seed aparece */
    let verNovos = 0;
    for (const v of seed.verbetes) {
      const r = await c.query("INSERT INTO verbetes (id,nome,sigla,papel,categoria,anel,info,fontes,wiki,ordem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING", [v.id, v.nome, v.sigla, v.papel, v.categoria, v.anel, v.info, v.fontes, v.wiki, v.ordem]);
      verNovos += r.rowCount;
    }
    if (verNovos) feito.push(`${verNovos} verbetes`);

    let vinNovos = 0;
    for (const l of seed.vinculos) {
      const r = await c.query(
        `INSERT INTO vinculos (origem,destino,tipo,info,fontes,ordem)
         SELECT $1,$2,$3,$4,$5,$6
         WHERE NOT EXISTS (SELECT 1 FROM vinculos WHERE (origem=$1 AND destino=$2) OR (origem=$2 AND destino=$1))`,
        [l.origem, l.destino, l.tipo, l.info, l.fontes, l.ordem]);
      vinNovos += r.rowCount;
    }
    if (vinNovos) feito.push(`${vinNovos} vínculos`);
    if (await vazia("barras")) {
      for (const b of seed.barras) await c.query("INSERT INTO barras (rotulo,valor,nota,ordem) VALUES ($1,$2,$3,$4)", [b.rotulo, b.valor, b.nota, b.ordem]);
      feito.push(`${seed.barras.length} barras`);
    }
    /* glossario funciona como catalogo: termos novos do seed entram sempre,
       sem tocar nos que ja existem (o painel continua manda no texto) */
    let glosNovos = 0;
    for (const g of seed.glossario || []) {
      const r = await c.query("INSERT INTO glossario (id,termo,variantes,definicao,verbete,ordem) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING", [g.id, g.termo, g.variantes || [], g.definicao, g.verbete, g.ordem || 0]);
      glosNovos += r.rowCount;
    }
    if (glosNovos) feito.push(`${glosNovos} termos de glossário`);
    /* trilhas de dinheiro: entram por id, como o glossario */
    let trNovos = 0, pasNovos = 0;
    for (const t of seed.trilhas || []) {
      const r = await c.query("INSERT INTO trilhas (id,nome,resumo,fontes,ordem) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING", [t.id, t.nome, t.resumo, t.fontes || [], t.ordem || 0]);
      trNovos += r.rowCount;
    }
    for (const p of seed.passos || []) {
      const r = await c.query("INSERT INTO passos (id,trilha,ordem,de,de_ref,para,para_ref,valor,data_txt,info,status,fontes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING",
        [p.id, p.trilha, p.ordem || 0, p.de, p.de_ref || null, p.para, p.para_ref || null, p.valor || null, p.data_txt || null, p.info, p.status || "apuracao", p.fontes || []]);
      pasNovos += r.rowCount;
    }
    if (trNovos) feito.push(`${trNovos} trilhas`);
    if (pasNovos) feito.push(`${pasNovos} passos de trilha`);

    if (await vazia("respostas")) {
      for (const r of seed.respostas || []) await c.query("INSERT INTO respostas (verbete,autor,tipo,data_txt,texto,fonte,url,prioridade,ordem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [r.verbete, r.autor, r.tipo, r.data_txt, r.texto, r.fonte, r.url, r.prioridade !== false, r.ordem || 0]);
      feito.push(`${(seed.respostas || []).length} respostas`);
    }

    await c.query("COMMIT");
    invalidar();
    console.log(feito.length ? `[conteudo] semeado: ${feito.join(", ")}` : "[conteudo] nada a semear (catálogos conferidos)");
    return feito.length > 0;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally { c.release(); }
}

/* ---------- leitura para o site ---------- */
let cache = null;
function invalidar() { cache = null; }

/* "Atualizado em" do site: data da ultima mudanca real no conteudo publicado.
   As tabelas nao tem data de alteracao e a semeadura nao grava errata, entao
   guarda em meta um hash do conteudo; quando o hash muda, a data vira agora.
   Na primeira vez, usa a errata publica mais recente como ponto de partida. */
async function marcaConteudo(saida) {
  const { atualizado, ...conteudo } = saida;
  const hash = require("node:crypto").createHash("sha1").update(JSON.stringify(conteudo)).digest("hex");
  const r = await pool.query("SELECT chave, valor FROM meta WHERE chave IN ('conteudo_hash','conteudo_em')");
  const m = Object.fromEntries(r.rows.map((x) => [x.chave, x.valor]));
  if (m.conteudo_hash === hash && m.conteudo_em) return m.conteudo_em;
  let em = new Date();
  if (!m.conteudo_hash) {
    const e = await pool.query("SELECT max(criado_em) AS em FROM errata WHERE publico AND coalesce(campo,'') <> 'ordem'");
    if (e.rows[0].em) em = e.rows[0].em;
  }
  em = new Date(em).toISOString();
  for (const [chave, valor] of [["conteudo_hash", hash], ["conteudo_em", em]])
    await pool.query("INSERT INTO meta (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor", [chave, valor]);
  return em;
}

async function dados() {
  if (cache) return cache;
  const [fon, cat, ane, tip, bar, fas, eve, ver, vin, err, resp, glo, tri, pas] = await Promise.all([
    pool.query("SELECT * FROM fontes ORDER BY id"),
    pool.query("SELECT * FROM categorias ORDER BY ordem"),
    pool.query("SELECT * FROM aneis ORDER BY nivel"),
    pool.query("SELECT * FROM tipos_vinculo ORDER BY id"),
    pool.query("SELECT * FROM barras ORDER BY ordem, id"),
    pool.query("SELECT * FROM fases ORDER BY ordem"),
    pool.query("SELECT * FROM eventos ORDER BY fase, ordem, id"),
    pool.query("SELECT * FROM verbetes ORDER BY ordem, id"),
    pool.query("SELECT * FROM vinculos ORDER BY ordem, id"),
    pool.query("SELECT criado_em, entidade, rotulo, acao, campo, antes, depois, motivo FROM errata WHERE publico ORDER BY criado_em DESC LIMIT 60"),
    pool.query("SELECT * FROM respostas ORDER BY verbete, ordem, id"),
    pool.query("SELECT * FROM glossario ORDER BY ordem, termo"),
    pool.query("SELECT * FROM trilhas ORDER BY ordem, id"),
    pool.query("SELECT * FROM passos ORDER BY trilha, ordem, id"),
  ]);
  const saida = {
    L: Object.fromEntries(fon.rows.map((f) => [f.id, [f.rotulo, f.url]])),
    CATG: Object.fromEntries(cat.rows.map((k) => [k.id, { n: k.nome, c: k.cor }])),
    RING: ane.rows.map((a) => a.nome),
    RTYPE: Object.fromEntries(tip.rows.map((t) => [t.id, [t.nome, t.cor]])),
    BARS: bar.rows.map((b) => ({ l: b.rotulo, v: Number(b.valor), n: b.nota || "" })),
    PHASES: fas.rows.map((f) => ({
      t: f.tag, h: f.titulo, s: f.subtitulo || "",
      ev: eve.rows.filter((e) => e.fase === f.ordem).map((e) => ({ d: e.data_txt, c: e.categoria, w: e.quem, x: e.texto })),
    })),
    N: ver.rows.map((v) => ({ id: v.id, n: v.nome, ab: v.sigla, r: v.papel, c: v.categoria, t: v.anel, info: v.info, ls: v.fontes })),
    E: vin.rows.map((l) => [l.origem, l.destino, l.tipo, l.info, l.fontes]),
    WIKI: Object.fromEntries(ver.rows.filter((v) => v.wiki).map((v) => [v.id, v.wiki])),
    ERRATA: err.rows.map((e) => ({
      em: e.criado_em, entidade: e.entidade, rotulo: e.rotulo, acao: e.acao,
      campo: e.campo, antes: e.antes, depois: e.depois, motivo: e.motivo,
    })),
    RESP: resp.rows.reduce((acc, r) => {
      (acc[r.verbete] = acc[r.verbete] || []).push({
        autor: r.autor, tipo: r.tipo, data: r.data_txt, texto: r.texto,
        fonte: r.fonte, url: r.url, prio: r.prioridade,
      });
      return acc;
    }, {}),
    GLOS: glo.rows.map((g) => ({
      id: g.id, termo: g.termo, vars: g.variantes || [], def: g.definicao, verbete: g.verbete,
    })),
    TRILHAS: tri.rows.map((t) => ({
      id: t.id, nome: t.nome, resumo: t.resumo, ls: t.fontes || [],
      passos: pas.rows.filter((p) => p.trilha === t.id).map((p) => ({
        de: p.de, deRef: p.de_ref, para: p.para, paraRef: p.para_ref,
        valor: p.valor || "", data: p.data_txt || "", info: p.info,
        status: p.status, ls: p.fontes || [],
      })),
    })),
    atualizado: new Date().toISOString(),
  };
  saida.conteudoEm = await marcaConteudo(saida);
  const corpo = JSON.stringify(saida);
  cache = { corpo, etag: '"' + require("node:crypto").createHash("sha1").update(corpo).digest("hex").slice(0, 16) + '"' };
  return cache;
}

/* ---------- errata ---------- */
async function registrarErrata(cli, { entidade, registro, rotulo, acao, campo, antes, depois, motivo, publico = true }) {
  await cli.query(
    `INSERT INTO errata (entidade,registro,rotulo,acao,campo,antes,depois,motivo,publico)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [entidade, String(registro), rotulo || null, acao, campo || null,
     antes === undefined || antes === null ? null : String(antes),
     depois === undefined || depois === null ? null : String(depois),
     motivo || null, publico]
  );
}

/* ---------- CRUD ---------- */
const TABELAS = {
  verbete: { tabela: "verbetes", chave: "id", rotuloCampo: "nome",
    campos: ["id", "nome", "sigla", "papel", "categoria", "anel", "info", "fontes", "wiki", "ordem"],
    numericos: ["anel", "ordem"], arrays: ["fontes"] },
  vinculo: { tabela: "vinculos", chave: "id", rotuloCampo: "info",
    campos: ["origem", "destino", "tipo", "info", "fontes", "ordem"],
    numericos: ["ordem"], arrays: ["fontes"] },
  evento: { tabela: "eventos", chave: "id", rotuloCampo: "data_txt",
    campos: ["fase", "ordem", "data_txt", "categoria", "quem", "texto"],
    numericos: ["fase", "ordem"], arrays: [] },
  fase: { tabela: "fases", chave: "ordem", rotuloCampo: "titulo",
    campos: ["ordem", "tag", "titulo", "subtitulo"], numericos: ["ordem"], arrays: [] },
  fonte: { tabela: "fontes", chave: "id", rotuloCampo: "rotulo",
    campos: ["id", "rotulo", "url"], numericos: [], arrays: [] },
  barra: { tabela: "barras", chave: "id", rotuloCampo: "rotulo",
    campos: ["rotulo", "valor", "nota", "ordem"], numericos: ["valor", "ordem"], arrays: [] },
  glossario: { tabela: "glossario", chave: "id", rotuloCampo: "termo",
    campos: ["id", "termo", "variantes", "definicao", "verbete", "ordem"],
    numericos: ["ordem"], arrays: ["variantes"], arraysTexto: ["variantes"] },
  trilha: { tabela: "trilhas", chave: "id", rotuloCampo: "nome",
    campos: ["id", "nome", "resumo", "fontes", "ordem"],
    numericos: ["ordem"], arrays: ["fontes"] },
  passo: { tabela: "passos", chave: "id", rotuloCampo: "info",
    campos: ["id", "trilha", "ordem", "de", "de_ref", "para", "para_ref", "valor", "data_txt", "info", "status", "fontes"],
    numericos: ["ordem"], arrays: ["fontes"] },
  resposta: { tabela: "respostas", chave: "id", rotuloCampo: "autor",
    campos: ["verbete", "autor", "tipo", "data_txt", "texto", "fonte", "url", "prioridade", "ordem"],
    numericos: ["ordem"], arrays: [], booleanos: ["prioridade"] },
};

function normaliza(def, entrada) {
  const out = {};
  for (const b of def.booleanos || []) if (!(b in entrada)) entrada[b] = "0";
  for (const c of def.campos) {
    if (!(c in entrada)) continue;
    let v = entrada[c];
    if (def.arrays.includes(c)) {
      // campos de texto (ex.: variantes do glossario) aceitam termos com espaco;
      // listas de ids continuam separadas por espaco ou virgula
      const sep = (def.arraysTexto || []).includes(c) ? /[,;\n]+/ : /[,\s]+/;
      out[c] = String(v || "").split(sep).map((s) => s.trim()).filter(Boolean);
    } else if ((def.booleanos || []).includes(c)) {
      out[c] = v === "1" || v === "on" || v === "true" || v === true;
    } else if (def.numericos.includes(c)) {
      const n = Number(String(v).replace(",", "."));
      out[c] = Number.isFinite(n) ? n : 0;
    } else {
      out[c] = String(v ?? "").trim() || null;
    }
  }
  return out;
}

async function listar(entidade) {
  const def = TABELAS[entidade];
  const ordem = def.tabela === "eventos" ? "fase, ordem, id"
    : def.tabela === "fases" ? "ordem"
    : def.tabela === "respostas" ? "verbete, ordem, id"
    : "ordem, " + def.chave;
  const { rows } = await pool.query(`SELECT * FROM ${def.tabela} ORDER BY ${ordem}`);
  return rows;
}

async function salvar(entidade, chaveValor, entrada, motivo) {
  const def = TABELAS[entidade];
  const dadosNovos = normaliza(def, entrada);
  const cli = await pool.connect();
  try {
    await cli.query("BEGIN");
    let antes = null;
    if (chaveValor) {
      const r = await cli.query(`SELECT * FROM ${def.tabela} WHERE ${def.chave}=$1`, [chaveValor]);
      antes = r.rows[0] || null;
    }
    let registro, rotulo;
    if (antes) {
      const campos = Object.keys(dadosNovos).filter((c) => c !== def.chave);
      const sets = campos.map((c, i) => `${c}=$${i + 1}`);
      const vals = campos.map((c) => dadosNovos[c]);
      vals.push(chaveValor);
      await cli.query(`UPDATE ${def.tabela} SET ${sets.join(",")} WHERE ${def.chave}=$${vals.length}`, vals);
      registro = chaveValor;
      rotulo = dadosNovos[def.rotuloCampo] || antes[def.rotuloCampo];
      for (const c of campos) {
        const a = Array.isArray(antes[c]) ? antes[c].join(" ") : antes[c];
        const d = Array.isArray(dadosNovos[c]) ? dadosNovos[c].join(" ") : dadosNovos[c];
        if (String(a ?? "") !== String(d ?? "")) {
          await registrarErrata(cli, { entidade, registro, rotulo, acao: "alterado", campo: c, antes: a, depois: d, motivo });
        }
      }
    } else {
      const campos = Object.keys(dadosNovos);
      const marc = campos.map((_, i) => `$${i + 1}`);
      const r = await cli.query(
        `INSERT INTO ${def.tabela} (${campos.join(",")}) VALUES (${marc.join(",")}) RETURNING ${def.chave}`,
        campos.map((c) => dadosNovos[c])
      );
      registro = r.rows[0][def.chave];
      rotulo = dadosNovos[def.rotuloCampo];
      await registrarErrata(cli, { entidade, registro, rotulo, acao: "incluído", motivo });
    }
    await cli.query("COMMIT");
    invalidar();
    return { registro, rotulo };
  } catch (e) {
    await cli.query("ROLLBACK");
    throw e;
  } finally { cli.release(); }
}

async function remover(entidade, chaveValor, motivo) {
  const def = TABELAS[entidade];
  const cli = await pool.connect();
  try {
    await cli.query("BEGIN");
    const r = await cli.query(`SELECT * FROM ${def.tabela} WHERE ${def.chave}=$1`, [chaveValor]);
    if (!r.rows[0]) { await cli.query("ROLLBACK"); return false; }
    const rotulo = r.rows[0][def.rotuloCampo];
    if (entidade === "verbete") {
      const v = await cli.query("DELETE FROM vinculos WHERE origem=$1 OR destino=$1 RETURNING id", [chaveValor]);
      if (v.rowCount) await registrarErrata(cli, { entidade: "vinculo", registro: chaveValor, rotulo, acao: "removido", campo: "em cascata", depois: `${v.rowCount} vínculo(s)`, motivo });
    }
    await cli.query(`DELETE FROM ${def.tabela} WHERE ${def.chave}=$1`, [chaveValor]);
    await registrarErrata(cli, { entidade, registro: chaveValor, rotulo, acao: "removido", motivo });
    await cli.query("COMMIT");
    invalidar();
    return true;
  } catch (e) {
    await cli.query("ROLLBACK");
    throw e;
  } finally { cli.release(); }
}

async function opcoes() {
  const [cat, ane, tip, fon, fas, ver, tri] = await Promise.all([
    pool.query("SELECT id,nome FROM categorias ORDER BY ordem"),
    pool.query("SELECT nivel,nome FROM aneis ORDER BY nivel"),
    pool.query("SELECT id,nome FROM tipos_vinculo ORDER BY id"),
    pool.query("SELECT id,rotulo FROM fontes ORDER BY id"),
    pool.query("SELECT ordem,titulo FROM fases ORDER BY ordem"),
    pool.query("SELECT id,nome FROM verbetes ORDER BY nome"),
    pool.query("SELECT id,nome FROM trilhas ORDER BY ordem, id"),
  ]);
  return { categorias: cat.rows, aneis: ane.rows, tipos: tip.rows, fontes: fon.rows, fases: fas.rows, verbetes: ver.rows, trilhas: tri.rows };
}

module.exports = { semear, dados, invalidar, listar, salvar, remover, opcoes, TABELAS };
