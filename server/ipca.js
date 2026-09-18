/* IPCA mensal do Banco Central (SGS, série 433), usado para corrigir os valores
   da comparação de golpes na Escala. Busca uma vez por dia e guarda em `meta`;
   se a API do BC falhar, o site segue com a última série gravada. */
const { pool } = require("./db");

const URL_SERIE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=01/01/1995";
const UM_DIA = 24 * 60 * 60 * 1000;

async function ler() {
  const r = await pool.query("SELECT valor FROM meta WHERE chave = 'ipca'");
  if (!r.rows[0]) return null;
  try { return JSON.parse(r.rows[0].valor); } catch { return null; }
}

/* devolve true quando a série gravada mudou */
async function atualizar() {
  const resp = await fetch(URL_SERIE, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error("BC respondeu " + resp.status);
  const dados = await resp.json();
  const serie = dados.map((x) => {
    const [, mm, aa] = x.data.split("/");
    return [aa + "-" + mm, Number(x.valor)];
  }).filter(([, v]) => Number.isFinite(v));
  if (serie.length < 300) throw new Error("série curta demais: " + serie.length);
  const novo = JSON.stringify(serie);
  const atual = await pool.query("SELECT valor FROM meta WHERE chave = 'ipca'");
  if (atual.rows[0] && atual.rows[0].valor === novo) return false;
  await pool.query("INSERT INTO meta (chave, valor) VALUES ('ipca', $1) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor", [novo]);
  console.log(`[ipca] série atualizada até ${serie[serie.length - 1][0]}`);
  return true;
}

function agendar(aoMudar) {
  const rodar = async () => {
    try { if (await atualizar()) aoMudar(); }
    catch (e) { console.error("[ipca] não atualizou:", e.message); }
  };
  rodar();
  setInterval(rodar, UM_DIA).unref();
}

module.exports = { ler, atualizar, agendar };
