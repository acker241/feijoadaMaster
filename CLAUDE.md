# Feijoada do Master — contexto para sessões do Claude Code

Site de apuração sobre o caso Banco Master / Daniel Vorcaro, em produção em
https://www.feijoadadomaster.com.br (Railway, deploy automático a cada push na `main`).
Tudo em português do Brasil: textos, commits, logs e mensagens ao usuário.

## Arquitetura

Um serviço Node (sem framework) + Postgres no Railway.

- `index.html` — o site inteiro (HTML, CSS, JS). Busca o conteúdo em `/api/dados`; se a API
  falhar, renderiza o snapshot embutido.
- `server/server.js` — rotas do site, APIs e painel `/admin`.
- `server/conteudo.js` + `server/seed.json` — conteúdo no banco (verbetes, vínculos, eventos,
  fases, fontes, trilhas, passos, glossário, respostas). A semeadura só insere o que falta:
  edição feita pelo painel nunca é sobrescrita pelo seed. Toda alteração grava a tabela `errata`.
- `server/admin*.js` — telas do painel: `admin.js` (login e mensagens), `admin-conteudo.js`
  (editor de conteúdo), `admin-stats.js` (estatísticas), `admin-noticias.js` (monitor de notícias).
- `server/metricas.js` — estatísticas de visita anônimas (sem cookie, sem IP; visitante = hash
  diário).
- `server/noticias.js` — coleta de notícias; `server/triagem.js` — agrupamento e classificação;
  `server/embeddings.js` — modelo local de embeddings.
- `server/schema.sql` — aplicado inteiro a cada subida; tudo com `IF NOT EXISTS`.

## Rotas

| Rota | O que faz |
|---|---|
| `GET /` | site |
| `GET /api/dados` | conteúdo do banco (ETag, cache 60s) |
| `POST /api/mensagem` | formulário "Fale com o site" (Turnstile, rate limit) |
| `POST /api/ev` | eventos de visita anônimos (sendBeacon) |
| `/admin` | mensagens recebidas |
| `/admin/conteudo` | editor de conteúdo com errata (`/salvar`, `/remover`) |
| `/admin/stats` | estatísticas de visita (7/30/90/365 dias) |
| `/admin/noticias` | fila de notícias; `/acao`, `/coletar`, `/triar`, `/retriar`, `/veiculos`, `/veiculo`, `/export.json` |
| `/healthz` | healthcheck do Railway; `versao` traz o commit que está no ar |

## Monitor de notícias (`/admin/noticias`)

**Coleta** (`noticias.js`), às 07:00, 12:00 e 18:00 de Brasília (`NOTICIAS_HORARIOS`):
- Google News geral + Google News `site:` por veículo + RSS próprio (47 veículos na tabela
  `veiculos`, editável no painel).
- Busca por pessoa (anéis 0–2 da rede) uma vez por dia.
- Marca as pessoas citadas (`noticias.pessoas`). Deduplica por título normalizado + domínio.

**Triagem** (`triagem.js`), logo depois de cada coleta:
1. Embeddings dos títulos com `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (q8, 384 dim), rodando
   no servidor. O vetor fica em `noticias.vetor`. O modelo ocupa ~400 MB e é liberado ao fim da rodada.
2. **História** = mesmo fato: aglomerativo por ligação média (produto dos centroides) com
   similaridade ≥ 0,78, janela de 3 dias. Resultado em `noticias.grupo` (id da notícia líder).
3. **Assunto** = tema: mesmo método com ≥ 0,6. Resultado em `noticias.assunto`.
4. **Classificação** pelo Claude Haiku 4.5 (`claude-haiku-4-5`) via Batch API, só para grupos sem
   categoria: `fato_novo`, `desdobramento`, `declaracao`, `analise`, `campanha`, `fora` + `no_site`
   (`sim`/`parcial`/`nao`) + motivo. Usa as fichas e a linha do tempo como contexto, com cache.

Regras:
- Juntar grupos nunca apaga nada. O destino é quem já tem decisão tomada, senão o maior; a notícia
  que entra herda status e classificação.
- A IA só rotula e ordena. Descartar é sempre ação humana.
- A fila filtra por período (campos "de" e "até", horário de Brasília, sobre `publicado_em` com queda
  para `encontrado_em`); o mesmo filtro vale para as ações em lote e para `/admin/noticias/export.json`,
  que baixa as notícias do recorte para análise fora do painel.
- Na fila, cada card é uma história, com as ações valendo para o grupo inteiro. Mostra veículos e
  grandes, "em alta" (3+ veículos em 24h), "exclusivo" (fato novo publicado por um veículo só), link
  para o assunto e ordenação por repercussão (peso: grande 3, independente/especializado 2, resto 1).
  Depois de cada ação, a âncora volta para o mesmo ponto da página.

**Decisões já testadas — não repetir sem motivo novo:**
- Agrupar por palavras (Jaccard, radicais, âncora por pessoa) formava cadeias ("Moraes", "STF") ou
  perdia paráfrases.
- Pedir ao Haiku que juntasse histórias falhou três vezes: com lista longa ele deixa passar; em
  blocos e em "hotspots" ele junta etapas diferentes da mesma novela ("Zanin pede acesso" com "PF
  entrega dados"). Por isso a IA não junta.
- Limites calibrados em ~2.900 títulos reais: 0,73 já juntava "Zanin pede acesso" com "Zanin recebe
  a íntegra"; 0,78 deu grupos de um fato só. O modelo `multilingual-e5-small` junta demais.
  Ajuste fino via `TRIAGEM_LIM_HISTORIA` / `TRIAGEM_LIM_ASSUNTO`, sem mexer no código.
- Custo do Haiku em lote: a classificação inicial de ~2.000 histórias custou ~US$ 0,40–0,90.

## Variáveis de ambiente (Railway)

Base: `DATABASE_URL`, `TURNSTILE_SITEKEY`, `TURNSTILE_SECRET`, `ADMIN_SENHA_HASH`, `SESSAO_SEGREDO`,
`SITE_URL`, `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (hoje não configuradas: nenhum aviso é enviado).

Notícias e triagem: `ANTHROPIC_API_KEY` (chave do workspace Default), `ANTHROPIC_WORKSPACE_ID` (só
para chave sem workspace), `NOTICIAS_ATIVO=0` desliga o monitor, `NOTICIAS_HORARIOS`,
`TRIAGEM_LIM_HISTORIA`, `TRIAGEM_LIM_ASSUNTO`, `TRIAGEM_MAX_GRUPOS` (limita o lote, útil em teste).

Para ler variáveis sem expor segredos: `railway variables --kv` e mascarar o valor. Para rodar um
script local com as variáveis de produção: `railway run node script.js`. Atenção: isso injeta também
o `DATABASE_URL` de produção; para usar banco local, sobrescreva dentro do comando.

## Testar localmente

- Postgres de desenvolvimento: container `pg-dev` na porta 5433 (usuário `postgres`, senha `dev`).
  Crie um banco descartável por teste (`CREATE DATABASE fm_x_teste`) e apague no fim.
- O servidor lê `server/public/index.html`: copie `index.html` para lá antes de subir e apague depois
  (a pasta não é ignorada pelo git).
- Senha de teste: `ADMIN_SENHA_HASH=$(node server/hash-senha.js teste-local-123)`.
- Imagem Docker (Debian slim, ~2 GB, já com o modelo): `docker build -t feijoada-teste .` e
  `docker run` com `DATABASE_URL=postgres://postgres:dev@host.docker.internal:5433/<banco>`.
- Teste de interação no navegador: Chrome headless com `--remote-debugging-port` e script CDP
  em Node. Navegue antes para `about:blank`, porque trocar só o `#hash` não recarrega a página.
- Antes de publicar: `node --check` em cada `server/*.js` e `git diff --check`.

## Armadilhas desta máquina (Windows + Git Bash)

- A ferramenta Write troca escapes Unicode (barra invertida + u + 4 digitos hexadecimais) pelo
  caractere literal. Para regex de acentos, grave o escape por script (`chr(92)`) e confira com `od -c`.
- Heredoc no Bash com aspas simples e crases misturadas às vezes quebra
  ("unexpected EOF"): grave o script num arquivo no scratchpad e execute.
- Em `String.prototype.replace`, `$&` no texto novo vira "o trecho encontrado". Para trocar código
  que contém `$&` ou `${...}`, use `split(a).join(b)`.
- `server/node_modules` tem 139 arquivos versionados por engano. O `.dockerignore` exclui a pasta;
  nunca faça `git add` nela.

## Pendências conhecidas

- Trocar a senha do painel e a chave secreta do Turnstile: as duas apareceram em conversa.
- Formulário público: em sessão anterior o Turnstile retornava erro 110200 (domínio). Conferir.
- Apagar no console da Anthropic a chave de API antiga, criada sem workspace (a atual é do workspace Default).
- Telegram não configurado (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`).
- Ficha de Fernando Haddad ainda diz "Ministro da Fazenda"; em set/2026 ele é ex-ministro e candidato.
- Motivos de errata gravados sem acento (16/09/2026 sobre Zettel e os de 17/09/2026): rodar
  `railway run node server/corrige-motivos.js --aplicar`. Ao gravar pelo painel, escrever o motivo com acento.
- Mesmo fato às vezes fica em duas histórias (limite 0,78 é conservador); o link do assunto junta.
- Imagem Docker grande (~2 GB); dá para enxugar dependências não usadas do transformers.js.
- Notícias em inglês do mesmo fato não se juntam às em português com o modelo atual.

## Regras editoriais

- Nunca publicar acusação sem fonte verificável; distinguir fato documentado, investigação e
  especulação. "Investigado não é condenado" fica na página.
- Toda mudança de conteúdo vai pelo painel (ou pelas rotas do painel) com motivo, para entrar na
  errata. A errata pública não mostra nomes nem códigos de fonte (só a contagem) nem mudanças de
  `ordem`.
- Mudança pública (push, conteúdo no ar): confirmar com o usuário antes, salvo pedido explícito.
