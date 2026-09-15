/* Corrige texto gravado com acento corrompido (UTF-8 lido como CP1252).
   Uso:  railway run node corrige_acentos.js [--aplicar]
   Sem --aplicar, só mostra o que mudaria. */
"use strict";
const { Client } = require("pg");

const CP1252 = {0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,
0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,
0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,
0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};

function consertar(txt) {
  if (typeof txt !== "string" || !/[ÃÂ]|â€/.test(txt)) return null;
  const bytes = [];
  for (const ch of txt) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF) bytes.push(cp);
    else if (CP1252[cp] !== undefined) bytes.push(CP1252[cp]);
    else return null;                     /* fora do mapa: não arrisca */
  }
  const saida = Buffer.from(bytes).toString("utf8");
  if (saida.includes("�")) return null;   /* decodificação inválida */
  return saida === txt ? null : saida;
}

const ALVOS = [
  { tabela: "fontes",    chave: "id", colunas: ["rotulo"] },
  { tabela: "verbetes",  chave: "id", colunas: ["nome", "papel", "info"] },
  { tabela: "vinculos",  chave: "id", colunas: ["info"] },
  { tabela: "eventos",   chave: "id", colunas: ["quem", "texto"] },
  { tabela: "respostas", chave: "id", colunas: ["autor", "tipo", "texto"] },
  { tabela: "glossario", chave: "id", colunas: ["termo", "definicao"] },
  { tabela: "errata",    chave: "id", colunas: ["rotulo", "antes", "depois", "motivo"] },
];

(async () => {
  const aplicar = process.argv.includes("--aplicar");
  const cli = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await cli.connect();
  let total = 0, amostras = [];
  for (const alvo of ALVOS) {
    const { rows } = await cli.query(`SELECT ${alvo.chave}, ${alvo.colunas.join(",")} FROM ${alvo.tabela}`);
    for (const r of rows) {
      const troca = {};
      for (const c of alvo.colunas) {
        const novo = consertar(r[c]);
        if (novo !== null) troca[c] = novo;
      }
      const campos = Object.keys(troca);
      if (!campos.length) continue;
      total += campos.length;
      if (amostras.length < 6) amostras.push(`${alvo.tabela}#${r[alvo.chave]} ${campos[0]}: ${String(troca[campos[0]]).slice(0, 70)}`);
      if (aplicar) {
        const sets = campos.map((c, i) => `${c}=$${i + 1}`);
        await cli.query(`UPDATE ${alvo.tabela} SET ${sets.join(",")} WHERE ${alvo.chave}=$${campos.length + 1}`,
          [...campos.map((c) => troca[c]), r[alvo.chave]]);
      }
    }
  }
  console.log(`${aplicar ? "corrigidos" : "a corrigir"}: ${total} campos`);
  amostras.forEach((a) => console.log("  " + a));
  await cli.end();
})();
