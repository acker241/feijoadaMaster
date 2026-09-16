/* Embeddings de titulo com um modelo pequeno rodando no proprio servidor
   (paraphrase-multilingual-MiniLM, 384 dimensoes). Sem API e sem custo por uso.
   O modelo ocupa ~400 MB de memoria: carrega so durante a triagem e e liberado
   em seguida. No build do Docker ele ja vem baixado (node embeddings.js). */
"use strict";

const path = require("node:path");

const MODELO = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const DIR = path.join(__dirname, ".modelos");
const LOTE = 64;

let extrator = null;

async function carregar() {
  if (extrator) return extrator;
  const { pipeline, env } = require("@huggingface/transformers");
  env.cacheDir = DIR;
  extrator = await pipeline("feature-extraction", MODELO, { dtype: "q8" });
  return extrator;
}

/* vetores normalizados: produto escalar = similaridade de cosseno */
async function vetorizar(textos) {
  const ex = await carregar();
  const saida = [];
  for (let i = 0; i < textos.length; i += LOTE) {
    const t = await ex(textos.slice(i, i + LOTE), { pooling: "mean", normalize: true });
    saida.push(...t.tolist());
  }
  return saida;
}

async function liberar() {
  if (!extrator) return;
  try { await extrator.dispose(); } catch { /* ja liberado */ }
  extrator = null;
}

module.exports = { vetorizar, liberar };

if (require.main === module) {
  vetorizar(["teste de carga do modelo"])
    .then((v) => { console.log(`[embeddings] modelo pronto em ${DIR} (${v[0].length} dimensões)`); return liberar(); })
    .catch((e) => { console.error("[embeddings] falhou:", e.message); process.exit(1); });
}
