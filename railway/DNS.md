# DNS — feijoadadomaster.com.br → Railway

Valores que o Railway pediu no painel (Custom Domain), anotados em 15/09/2026.

| Tipo  | Nome                 | Valor                                        |
|-------|----------------------|----------------------------------------------|
| CNAME | `www`                | `jbb56krw.up.railway.app`                    |
| TXT   | `_railway-verify.www`| `railway-verify=5f3668b0a9e8b73df485a6910e9e60…` |

> **O TXT está incompleto.** O painel cortou o valor com "…" na tela que eu vi. Antes de
> cadastrar, abra o Railway › Settings › Networking › o domínio › e copie o valor inteiro
> (o botão de copiar pega tudo). Um TXT truncado falha na verificação sem dizer por quê.

## Como cadastrar

No painel do seu provedor de DNS (Registro.br, Cloudflare, etc.), na zona
`feijoadadomaster.com.br`:

1. **CNAME** — host `www`, valor `jbb56krw.up.railway.app`, TTL padrão.
   Sem ponto final se o painel já completar o domínio; com ponto final se ele exigir FQDN.
2. **TXT** — host `_railway-verify.www`, valor completo copiado do Railway.
3. Volte ao Railway e espere os dois avisos amarelos virarem verdes. Propagação costuma levar
   de minutos a algumas horas; o certificado TLS sai automático depois da verificação.

## O domínio sem www

`feijoadadomaster.com.br` (apex) não aceita CNAME pela regra do DNS. Três saídas:

- **Redirecionamento no registrador** — o Registro.br e a maioria dos provedores oferecem
  "redirecionamento de domínio" do apex para `https://www.feijoadadomaster.com.br`. Mais simples.
- **Cloudflare na frente** — mover os nameservers para a Cloudflare e usar um CNAME flattening
  no apex apontando para `jbb56krw.up.railway.app`. Ganha cache e proteção de graça.
- **Só www** — publicar apenas `www.` e divulgar esse endereço.

Escolhido o caminho, o `www` continua sendo o endereço canônico — mantenha os links do site e
das redes apontando para ele.

## Conferir se está de pé

```powershell
nslookup -type=CNAME www.feijoadadomaster.com.br
nslookup -type=TXT _railway-verify.www.feijoadadomaster.com.br
curl -I https://www.feijoadadomaster.com.br
```

O `curl -I` deve responder `200` e trazer os cabeçalhos do Caddy (`content-security-policy`,
`cache-control: public, must-revalidate, max-age=300`).
