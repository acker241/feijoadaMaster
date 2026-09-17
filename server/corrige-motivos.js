/* Corrige acentos nos motivos da errata gravados sem acento.
   Uso:  railway run node server/corrige-motivos.js            (só mostra)
         railway run node server/corrige-motivos.js --aplicar  (grava)

   Só troca motivos idênticos aos da lista abaixo: nada é adivinhado. */
"use strict";

const { pool } = require("./db");

const APLICAR = process.argv.includes("--aplicar");
const PREFIXO_VELHO = "Atualizacao com fatos noticiados em 16-17/09/2026";
const PREFIXO_NOVO = "Atualização com fatos noticiados em 16–17/09/2026";

/* sufixo depois de ": " — o que não aparece aqui já estava certo */
const SUFIXOS = {
  "fonte da atualizacao": "fonte da atualização",
  "apreensao de dinheiro em especie nas buscas de maio": "apreensão de dinheiro em espécie nas buscas de maio",
  "decisao do TSE sobre video feito com IA": "decisão do TSE sobre vídeo feito com IA",
  "pedido de acesso aos autos por tres partidos": "pedido de acesso aos autos por três partidos",
  "comissao do GDF e clausula de privatizacao no acordo salarial": "comissão do GDF e cláusula de privatização no acordo salarial",
  "pedido para ouvir Vorcaro na prisao em 25/09": "pedido para ouvir Vorcaro na prisão em 25/09",
  "impedimento apontado por Dino e voto na questao de ordem": "impedimento apontado por Dino e voto na questão de ordem",
  "mensagens trocadas entre ministros antes da sessao": "mensagens trocadas entre ministros antes da sessão",
  "pedido de revogacao da prisao e de retomada do processo": "pedido de revogação da prisão e de retomada do processo",
};

function corrigir(motivo) {
  if (typeof motivo !== "string" || !motivo.startsWith(PREFIXO_VELHO)) return null;
  const resto = motivo.slice(PREFIXO_VELHO.length);
  if (!resto) return PREFIXO_NOVO;
  if (!resto.startsWith(": ")) return null;
  const sufixo = resto.slice(2);
  return PREFIXO_NOVO + ": " + (SUFIXOS[sufixo] || sufixo);
}

async function main() {
  const { rows } = await pool.query("SELECT id, motivo FROM errata WHERE motivo LIKE $1", [PREFIXO_VELHO + "%"]);
  const trocas = [];
  for (const r of rows) {
    const novo = corrigir(r.motivo);
    if (novo && novo !== r.motivo) trocas.push([r.id, novo]);
  }
  console.log(`${rows.length} linha(s) com o prefixo antigo, ${trocas.length} a corrigir`);
  const amostra = new Set(trocas.map(([, m]) => m));
  for (const m of amostra) console.log("  ->", m);
  if (!APLICAR) return console.log("\nnada gravado (rode com --aplicar)");
  for (const [id, motivo] of trocas) {
    await pool.query("UPDATE errata SET motivo=$1 WHERE id=$2", [motivo, id]);
  }
  console.log(`\n${trocas.length} motivo(s) corrigido(s)`);
}

main().then(() => pool.end()).catch((e) => { console.error("erro:", e.message); process.exit(1); });
