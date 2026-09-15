# Feijoada do Master

Página única (agregador) sobre o caso Banco Master: escala do dano, linha do tempo em 5 fases,
rede de 90 nomes e verbetes "quem é quem". Dados consolidados em 15/09/2026.

## Arquivos

- `index.html` — o site inteiro, autocontido. Publicar é só subir este arquivo.
- `README.md` — este arquivo.
- `FONTES.md` — todas as fontes, com endereço e o que cada uma sustenta, mais as fontes de imagem.
- `LICENCAS.md` — licenças de fotos, textos, fontes tipográficas e código, e o que é obrigatório manter.

## Como publicar

Qualquer hospedagem estática serve, sem build:

- **Railway** (em uso): `Dockerfile` + `Caddyfile` na raiz servem o `index.html` pelo Caddy na
  porta `$PORT`. Passo a passo, cabeçalhos e CSP em `railway/RAILWAY.md`.
- **GitHub Pages**: Settings › Pages › branch `main` / root.
- **Netlify / Cloudflare Pages**: conectar o repo ou arrastar a pasta.
- **Hospedagem própria**: copiar `index.html` para a raiz do domínio.

Os arquivos de deploy ficam na raiz porque o Railway procura o `Dockerfile` ali; `railway/RAILWAY.md`
é só documentação.

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

Os dados ficam em blocos JavaScript no fim do `index.html`:

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

## Configurar a caixa de mensagens

No `index.html`, procure `const CONTATO=` (fica no começo do bloco de script) e preencha:

```js
const CONTATO={ endpoint:"", formato:"formspree", email:"" };
```

Três cenários:

1. **Só e-mail, sem serviço nenhum** — deixe `endpoint` vazio e ponha seu e-mail em `email`.
   O formulário monta a mensagem formatada e abre o programa de e-mail do visitante. Funciona em
   qualquer hospedagem, sem conta em serviço nenhum. Desvantagem: expõe o e-mail e depende do
   cliente de e-mail do visitante. O botão "Copiar texto" é a saída para quem não tem um.

2. **Formspree** (ou similar) — crie um formulário, copie o ID e use:

   ```js
   const CONTATO={ endpoint:"https://formspree.io/f/SEU_ID", formato:"formspree", email:"seu@email" };
   ```

   O `email` continua servindo de plano B se o envio falhar. O campo-isca `_gotcha` já está no
   formulário e o Formspree o reconhece como anti-spam.

3. **Endpoint próprio** (Google Apps Script, Cloudflare Worker, sua API) — use
   `formato:"json"` e a URL do endpoint; a página faz `POST` com JSON:
   `{tipo, nome, email, referencia, mensagem, autorizaPublicacao}`. O endpoint precisa
   responder com CORS liberado para o domínio do site.

**Netlify Forms**: além de configurar acima, adicione ao `<form id="msgform">` os atributos
`data-netlify="true"` e um `<input type="hidden" name="form-name" value="msgform">` — a Netlify só
detecta o formulário se ele estiver no HTML estático.

Proteções já embutidas: campo-isca invisível, bloqueio de envio nos primeiros 3 segundos, mínimo de
15 caracteres, validação de e-mail e rascunho salvo em `localStorage` para o visitante não perder o
texto se o envio falhar. Para volume alto de spam, ponha um Turnstile/hCaptcha na frente do endpoint.

## Avisos que precisam continuar na página

O bloco de disclaimer da seção 05 é parte do conteúdo, não enfeite: diz que a página é
agregadora, que foi organizada com auxílio de IA, que isso não isenta as fontes nem o
proprietário do site quanto à réplica das notícias, que o site não é opinativo e que
nenhuma acusação reunida ali foi julgada. Se o texto mudar, mantenha esses pontos.
