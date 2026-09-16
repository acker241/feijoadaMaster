# Corrige no ar a ficha de Fabiano Zettel e o vinculo com Vorcaro, registrando errata.
# Uso:  $env:FM_SENHA="<senha do painel>"; .\corrigir_zettel.ps1
$ErrorActionPreference="Stop"
$base="https://www.feijoadadomaster.com.br"
if(-not $env:FM_SENHA){ throw "defina FM_SENHA antes de rodar" }
$ses=$null
$l = Invoke-WebRequest "$base/admin/login" -Method POST -Body @{senha=$env:FM_SENHA} -UseBasicParsing -SessionVariable ses -SkipHttpErrorCheck
if($l.StatusCode -ne 200 -or $l.Content -match 'name="senha"'){ throw "login falhou ($($l.StatusCode))" }
"login ok"
function Salvar($corpo){ $r = Invoke-WebRequest "$base/admin/conteudo/salvar" -Method POST -Body $corpo -UseBasicParsing -WebSession $ses -SkipHttpErrorCheck; if($r.StatusCode -ne 200 -or $r.Content -match "N(a|ã)o deu"){ "FALHOU ($($r.StatusCode)): " + $corpo["ent"]; $r.Content } else { "ok: " + $corpo["ent"] + " " + $corpo["chave"] } }

$motivo='correcao: os R$ 57,1 mi sao movimentacao da conta da igreja apontada pelo Coaf (dez/2024 a dez/2025), nao doacao de campanha de 2022; doacoes ao TSE somam R$ 5,01 mi'

Salvar @{ ent='verbete'; chave='cunhado'; id='cunhado'; nome='Fabiano Zettel'; sigla='FZ'; papel='Cunhado de Vorcaro'; categoria='mkt'; anel='1'; ordem='11';
  info='Cunhado de Vorcaro, preso em fase da operação junto com o banqueiro. Declarou ao TSE R$ 5,01 mi em doações em 2022 — R$ 3 mi à campanha de Bolsonaro e R$ 2 mi à de Tarcísio de Freitas. Segundo relatório do Coaf citado pela imprensa, a conta da Igreja Batista da Lagoinha unidade Belvedere, que ele geria, movimentou R$ 57,1 mi entre dez/2024 e dez/2025, com R$ 19,2 mi transferidos por ele. A defesa afirma que tem atividades empresariais lícitas, sem relação com a gestão do banco.';
  fontes='ap3 apzet cnnzet itaig nd wen'; wiki=''; motivo=$motivo }

Salvar @{ ent='vinculo'; chave='8'; origem='vorcaro'; destino='cunhado'; tipo='f'; ordem='7';
  info='Cunhado e operador financeiro apontado pela apuração. Doou R$ 5,01 mi a campanhas em 2022, segundo o TSE, e geria a conta de igreja em BH que movimentou R$ 57,1 mi entre dez/2024 e dez/2025, segundo o Coaf.';
  fontes='ap3 apzet itaig nd'; motivo=$motivo }

"pronto. confira a ficha em $base/#c-cunhado e a errata em $base/#errata-sec"
