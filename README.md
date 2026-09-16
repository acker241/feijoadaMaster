# Feijoada do Master

Página única (agregador) sobre o caso Banco Master: escala do dano, caminho do dinheiro, linha do
tempo, rede de relações e verbetes "quem é quem", com glossário e errata. O conteúdo fica no banco
e é editado pelo painel `/admin`. Contexto técnico completo para quem mantém o código: `CLAUDE.md`.

## Arquivos

- `index.html` — o site inteiro (HTML, CSS, JS e dados numa página).
- `server/` — backend Node: `server.js` (site + API + painel), `conteudo.js` + `seed.json`
  (conteúdo no banco e semeadura inicial), `admin*.js` (telas do `/admin`), `metricas.js`
  (visitas anônimas), `noticias.js` + `triagem.js` + `embeddings.js` (monitor de notícias),
  `db.js`, `schema.sql`, `hash-senha.js`. Dependências: `pg`, `@anthropic-ai/sdk`,
  `@huggingface/transformers`.
- `CLAUDE.md` — arquitetura, decisões, testes locais e pendências.
- `Dockerfile`, `railway.json`, `compose-teste.yml`, `.env.example` — deploy e teste local.
- `README.md` — este arquivo.
- `FONTES.md` — todas as fontes, com endereço e o que cada uma sustenta, mais as fontes de imagem.
- `LICENCAS.md` — licenças de fotos, textos, fontes tipográficas e código, e o que é obrigatório manter.

## Como publicar

Qualquer hospedagem estática serve, sem build:

- **Railway** (em uso): container Node serve o site, recebe as mensagens e entrega o `/admin`;
  Postgres como plugin do mesmo projeto. Variáveis, senha do painel e rotas em
  `railway/RAILWAY.md`.
- **GitHub Pages**: Settings › Pages › branch `main` / root.
- **Netlify / Cloudflare Pages**: conectar o repo ou arrastar a pasta.
- **Hospedagem própria**: copiar `index.html` para a raiz do domínio.

As três últimas opções servem o site, mas **não** a caixa de mensagens nem o painel — essas
precisam do backend.

## Dependências externas em runtime

O arquivo é autocontido, mas busca três coisas na rede quando alguém abre a página:

1. `cdnjs.cloudflare.com` — biblioteca D3 v7.9.0 (desenha o grafo).
2. `fonts.googleapis.com` / `fonts.gstatic.com` — fontes IBM Plex.
3. `pt.wikipedia.org/api/rest_v1/page/summary/...` — foto e resumo biográfico de cada pessoa
   ou instituição que tem verbete. A chamada acontece no navegador do leitor, o resultado
   fica em `localStorage`, e quem não tem verbete aparece com monograma.

Se preferir não depender da Wikipédia em runtime (mais rápido e mais previsível),
baixe as imagens que interessam, guarde em `assets/` e troque `PHOTO`/`fetchWiki` por um
objeto fixo `{id:{img:"assets/xxx.jpg",ext:"...",url:"..."}}`. **Antes disso verifique a
licença de cada foto** na página do arquivo no Wikimedia Commons — a maioria é CC-BY e exige
crédito ao autor, algumas não permitem uso comercial.

## Editar conteúdo

O conteúdo publicado vem do banco, pelo painel `/admin/conteudo`: cada alteração pede um motivo e
entra na errata pública. O `server/seed.json` só preenche tabelas vazias e nunca sobrescreve edição
feita no painel. O snapshot abaixo, embutido no `index.html`, só aparece quando a API de dados não
responde.

Os blocos do snapshot, no fim do `index.html`:

- `BARS` — barras da escala do dano.
- `PHASES` — fases e eventos da linha do tempo.
- `N` — nós da rede (id, nome, sigla, papel, categoria `c`, anel `t`, texto `info`, fontes `ls`).
- `E` — ligações `[origem, destino, tipo, "o que liga", [fontes]]`; tipo: `f` financeiro,
  `i` institucional, `v` investigação, `p` político.
- `L` — catálogo de fontes (rótulo + URL) referenciado por `ls`.
- `WIKI` — id do nó → título na Wikipédia em português.

Acrescentar alguém = uma linha em `N` + as ligações em `E` (+ o título em `WIKI`, se houver verbete).

## Seções da página

`01` Escala do dano · `02` Linha do tempo · `03` Rede de relações · `04` Quem é quem ·
`05` Fontes e avisos · `06` Imagens e licenças (tabela montada em tempo de execução com autor e
licença de cada foto, lida da API do Wikimedia Commons) · `07` Fale com o site (caixa de mensagens).

## Caixa de mensagens

O formulário posta em `/api/mensagem`, no próprio backend — `const CONTATO=` no `index.html` só
guarda essa URL e um e-mail opcional de plano B. A sitekey do Turnstile **não** está no arquivo:
o servidor injeta `__TURNSTILE_SITEKEY__` a partir da variável de ambiente, e sem ela o widget
nem aparece.

Proteções em camadas: widget Turnstile validado no servidor pelo `siteverify`, campo-isca
invisível, bloqueio nos 3 primeiros segundos, mínimo de 15 caracteres, validação de e-mail,
limite de 5 envios por IP a cada 10 minutos e rascunho salvo em `localStorage` para o visitante
não perder o texto.

Ler as mensagens: `/admin`, com a senha de `ADMIN_SENHA_HASH`. Filtro por status e tipo, nota
interna, marcação de respondido e export CSV. Detalhes em `railway/RAILWAY.md`.

## Avisos que precisam continuar na página

O bloco de disclaimer da seção 05 é parte do conteúdo, não enfeite: diz que a página é
agregadora, que foi organizada com auxílio de IA, que isso não isenta as fontes nem o
proprietário do site quanto à réplica das notícias, que o site não é opinativo e que
nenhuma acusação reunida ali foi julgada. Se o texto mudar, mantenha esses pontos.
