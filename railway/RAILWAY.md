# Deploy no Railway

Um serviço só: um container Node serve o `index.html`, recebe as mensagens do formulário
(validando o Turnstile) e entrega o painel `/admin`. O Postgres é um segundo plugin do mesmo
projeto no Railway. Não há build de front — o HTML é servido como está.

## 1. Criar o serviço

railway.com › **New Project** › **Deploy from GitHub repo** › `acker241/feijoadaMaster`.
O `railway.json` manda usar o `Dockerfile` e configura healthcheck em `/healthz`.

## 2. Adicionar o Postgres

No projeto › **+ New** › **Database** › **Add PostgreSQL**. Depois, no serviço do site,
em **Variables**, crie `DATABASE_URL` com o valor de referência:

```
${{Postgres.DATABASE_URL}}
```

Referência, não valor copiado — assim a senha rotaciona sem quebrar o deploy.

## 3. Variáveis do serviço

| Variável | Para que serve | Como obter |
|---|---|---|
| `DATABASE_URL` | banco | referência ao plugin Postgres (acima) |
| `TURNSTILE_SITEKEY` | chave pública injetada no HTML | dash.cloudflare.com › Turnstile |
| `TURNSTILE_SECRET` | validação no servidor | mesmo painel — **nunca no repo** |
| `ADMIN_SENHA_HASH` | senha do `/admin` | `node server/hash-senha.js "sua senha longa"` |
| `SESSAO_SEGREDO` | assina o cookie de sessão | `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | aviso de mensagem nova (opcional) | @BotFather |
| `TELEGRAM_CHAT_ID` | destino do aviso (opcional) | @userinfobot |
| `SITE_URL` | link nos avisos e cookie `Secure` | `https://www.feijoadadomaster.com.br` |

Sem `TURNSTILE_SECRET` o servidor **aceita** mensagens sem validar e avisa no log — bom para
testar, ruim para deixar assim. Sem `ADMIN_SENHA_HASH` ou `SESSAO_SEGREDO`, `/admin` responde
que o painel não está configurado, em vez de abrir sem senha.

`PORT` é injetada pelo Railway; não crie.

## 4. Gerar a senha do admin

```powershell
node server/hash-senha.js "uma senha longa que você vá lembrar"
# saída: scrypt$<salt>$<hash>   → cole em ADMIN_SENHA_HASH
```

O hash é scrypt com salt aleatório. A senha em texto puro não vai para arquivo nenhum.

## 5. Domínio

Settings › Networking › **Generate Domain** e, depois, **Custom Domain**. Os registros do
`feijoadadomaster.com.br` estão em `railway/DNS.md`.

## Testar antes de subir

```powershell
$env:ADMIN_SENHA_HASH = node server/hash-senha.js "senha-de-teste-123"
docker compose -f compose-teste.yml up --build
# site:   http://localhost:8080
# painel: http://localhost:8080/admin
```

O compose sobe um Postgres efêmero. Sem `TURNSTILE_SECRET`, o envio passa sem captcha — é o
modo de teste. O schema é aplicado na subida, com até 12 tentativas enquanto o banco acorda.

## Rotas

| Rota | O que faz |
|---|---|
| `GET /` | site, com a sitekey do Turnstile injetada |
| `POST /api/mensagem` | recebe o formulário: valida tamanho, e-mail, isca anti-robô, rate limit (5 por IP a cada 10 min) e Turnstile; grava e avisa no Telegram |
| `GET /admin` | painel com senha: lista, filtra por status e tipo, marca lido/respondido/arquivado, nota interna |
| `GET /admin/export.csv` | todas as mensagens em CSV (com BOM, abre no Excel) |
| `GET /healthz` | usado pelo healthcheck do Railway; diz se sitekey e secret estão presentes |

## O que fica gravado

Tabela `mensagens`: tipo, nome, e-mail, referência, texto, autorização de publicação, status,
nota interna, **data/hora, IP e user-agent**. O IP e o horário existem por causa do registro de
ameaça prometido na seção 07 do site — trate a tabela como dado pessoal (ver `LICENCAS.md`).

Backup: o plugin Postgres do Railway tem snapshot próprio; para cópia local,
`railway connect Postgres` e `pg_dump`.

## Custo

App pequeno (~US$ 3–5/mês) + Postgres no tamanho mínimo (~US$ 5–8/mês) cabem no plano de
US$ 20. O Caddy saiu — quem serve o HTML e os cabeçalhos de segurança agora é o Node.
