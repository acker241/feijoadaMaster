# DNS — feijoadadomaster.com.br → Railway

Valores que o Railway pediu no painel (Custom Domain), anotados em 15/09/2026.

| Tipo  | Nome                 | Valor                                        |
|-------|----------------------|----------------------------------------------|
| CNAME | `www`                | `jbb56krw.up.railway.app`                    |
| TXT   | `_railway-verify.www`| `railway-verify=5f3668b0a9e8b73df485a6910e9e60eec74f9f16f684af2fc0614b42cb851b81` |

Valor completo do TXT confirmado no Registro.br em 15/09/2026:
`railway-verify=5f3668b0a9e8b73df485a6910e9e60eec74f9f16f684af2fc0614b42cb851b81`
(64 caracteres hexadecimais depois do `=`). No Registro.br ele aparece entre aspas duplas — o
painel adiciona as aspas sozinho; não digite outro par.

## Histórico

- **15/09/2026, primeira tentativa** — a zona apareceu vazia com "Domínio em transição. Por favor,
  aguarde alguns minutos e tente novamente". Registro recém-feito ou nameserver em alteração trava
  a zona para escrita; abre sozinha depois de alguns minutos.
- **15/09/2026, segunda tentativa** — modo avançado liberado, as duas entradas cadastradas com os
  nomes completos (`www.feijoadadomaster.com.br` e `_railway-verify.www.feijoadadomaster.com.br`),
  aguardando **Salvar alterações**.

O Registro.br avisa que, depois de entrar no modo avançado, o modo básico só volta a ficar
disponível em ~13 minutos. Não é problema: o avançado é o que permite CNAME e TXT.

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
