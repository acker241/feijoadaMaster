# Deploy no Railway

O site e um `index.html` estatico. O Railway serve isso com o Caddy, via `Dockerfile` — nada de
Node, build ou dependencia. O Caddy le a porta de `$PORT`, que o Railway injeta.

## Caminho 1 — pelo painel, ligado ao GitHub (recomendado)

1. railway.com › **New Project** › **Deploy from GitHub repo** › `acker241/feijoadaMaster`.
2. O Railway detecta o `Dockerfile` na raiz e faz o build sozinho. Nenhuma variavel e necessaria.
3. Em **Settings › Networking › Public Networking**, clique em **Generate Domain**.
   Sai algo como `feijoadamaster-production.up.railway.app`.
4. Dominio proprio: mesma tela, **Custom Domain**, e um CNAME no seu DNS apontando para o host
   que o Railway mostrar.

Cada `git push` na branch `main` redeploya. E o modo mais pratico: voce edita no GitHub e o site
atualiza sozinho.

## Caminho 2 — pela CLI, da pasta local

```powershell
cd C:\pyproj\FeijoadaMaster
railway init            # cria o projeto e o servico
railway up              # sobe o conteudo da pasta e builda o Dockerfile
railway domain          # gera o dominio publico
railway logs            # acompanha
```

`railway up` envia a pasta como ela esta no disco, sem passar pelo GitHub — bom para testar antes
de comitar, ruim como rotina (o repo e o painel saem de sincronia).

## Testar o container antes de subir

```powershell
docker build -t feijoada .
docker run --rm -p 8080:8080 -e PORT=8080 feijoada
# abre http://localhost:8080
```

## O que o Caddyfile faz

- serve `/srv/index.html` em `$PORT`, com gzip e zstd;
- `try_files` devolve a pagina unica para qualquer rota, entao `/rede` ou `/fontes` nao dao 404;
- `Cache-Control` de 5 minutos — correcao no conteudo aparece rapido;
- cabecalhos de seguranca: `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`;
- **CSP** liberando apenas o que a pagina usa: script do cdnjs, CSS do Google Fonts, fontes do
  gstatic, imagens do Wikimedia e chamadas a `pt.wikipedia.org` e `commons.wikimedia.org`.

> **Ao configurar a caixa de mensagens**, acrescente o host do endpoint em `connect-src`.
> Sem isso o navegador bloqueia o envio e o formulario cai no plano B de e-mail.
> Ex.: `connect-src 'self' https://pt.wikipedia.org https://commons.wikimedia.org https://formspree.io;`

## Custo

O plano gratuito do Railway da creditos mensais e hiberna servico parado. Um container Caddy
servindo HTML estatico consome quase nada, mas se o site pegar trafego de verdade, o Pages do
GitHub ou o Cloudflare Pages saem de graca — vale comparar antes de deixar o Railway como
hospedagem definitiva.
