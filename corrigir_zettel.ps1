# Corrige no ar a ficha de Fabiano Zettel e o vinculo com Vorcaro, registrando errata.
# Uso:  $env:FM_SENHA="<senha do painel>"; .\corrigir_zettel.ps1
$ErrorActionPreference="Stop"
$base="https://www.feijoadadomaster.com.br"
if(-not $env:FM_SENHA){ throw "defina FM_SENHA antes de rodar" }
$ses=$null
Invoke-WebRequest "$base/admin/login" -Method POST -Body @{senha=$env:FM_SENHA} -UseBasicParsing -SessionVariable ses -MaximumRedirection 0 -ErrorAction SilentlyContinue | Out-Null
function Salvar($corpo){ $r = Invoke-WebRequest "$base/admin/conteudo/salvar" -Method POST -Body $corpo -UseBasicParsing -WebSession $ses; if($r.Content -match "N(a|ã)o deu"){ "FALHOU: " + $corpo["ent"] } }

$motivo='correcao: os R$ 57,1 mi sao movimentacao da conta da igreja apontada pelo Coaf (dez/2024 a dez/2025), nao doacao de campanha de 2022; doacoes ao TSE somam R$ 5,01 mi'

Salvar @{ ent='verbete'; chave='cunhado'; id='cunhado'; nome='Fabiano Zettel'; sigla='FZ'; papel='Cunhado de Vorcaro'; categoria='mkt'; anel='1'; ordem='0';
  info='Cunhado de Vorcaro, preso em fase da operação junto com o banqueiro. Declarou ao TSE R$ 5,01 mi em doações em 2022 — R$ 3 mi à campanha de Bolsonaro e R$ 2 mi à de Tarcísio de Freitas. Segundo relatório do Coaf citado pela imprensa, a conta da Igreja Batista da Lagoinha unidade Belvedere, que ele geria, movimentou R$ 57,1 mi entre dez/2024 e dez/2025, com R$ 19,2 mi transferidos por ele. A defesa afirma que tem atividades empresariais lícitas, sem relação com a gestão do banco.';
  fontes='ap3 apzet cnnzet itaig nd wen'; wiki=''; motivo=$motivo }

"pronto. confira a ficha em $base/#c-cunhado e a errata em $base/#errata-sec"
"obs.: o vinculo Vorcaro-Zettel tem id proprio; ajuste o texto dele pelo painel em /admin/conteudo?ent=vinculo (busque por Zettel)."
