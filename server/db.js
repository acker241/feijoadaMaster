const { Pool } = require("pg");
const fs = require("node:fs");
const path = require("node:path");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[db] DATABASE_URL ausente. Adicione o Postgres ao projeto no Railway.");
}

const pool = new Pool({
  connectionString: url,
  max: 5,
  idleTimeoutMillis: 30_000,
  ssl: /railway|amazonaws|render|supabase/.test(url || "") ? { rejectUnauthorized: false } : false,
});

pool.on("error", (e) => console.error("[db] erro no pool:", e.message));

async function migrar(tentativas = 12, esperaMs = 2500) {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query(sql);
      console.log("[db] schema aplicado");
      return true;
    } catch (e) {
      const ultima = i === tentativas;
      console.error(`[db] tentativa ${i}/${tentativas} falhou: ${e.message}${ultima ? "" : ` — nova tentativa em ${esperaMs / 1000}s`}`);
      if (ultima) return false;
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
  return false;
}

module.exports = { pool, migrar };
