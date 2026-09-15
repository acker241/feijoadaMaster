/* Gera o hash da senha do admin. Uso:  node hash-senha.js "sua senha"
   Cole a saida na variavel ADMIN_SENHA_HASH do Railway. A senha em texto
   puro nao e gravada em lugar nenhum. */
const { scryptSync, randomBytes } = require("node:crypto");
const senha = process.argv[2];
if (!senha || senha.length < 10) {
  console.error("Passe a senha como argumento, com 10 caracteres ou mais.");
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(senha, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
console.log(`scrypt$${salt}$${hash}`);
