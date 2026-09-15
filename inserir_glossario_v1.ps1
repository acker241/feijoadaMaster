$ErrorActionPreference="Stop"
$base="https://www.feijoadadomaster.com.br"
$ses=$null
if(-not $env:FM_SENHA){ throw "defina FM_SENHA antes de rodar" }
Invoke-WebRequest "$base/admin/login" -Method POST -Body @{senha=$env:FM_SENHA} -UseBasicParsing -SessionVariable ses -MaximumRedirection 0 -ErrorAction SilentlyContinue | Out-Null
function Salvar($corpo){ $r = Invoke-WebRequest "$base/admin/conteudo/salvar" -Method POST -Body $corpo -UseBasicParsing -WebSession $ses; if($r.Content -match "N(a|ã)o deu"){ "FALHOU: " + $corpo["id"] } }

Salvar @{ ent='glossario'; id='bacen'; termo='Banco Central'; variantes='BC, Bacen, Banco Central do Brasil'; verbete='bc'; ordem='21'; definicao='Autoridade que autoriza o funcionamento de um banco, fiscaliza suas contas e pode decretar o fim dele. No caso Master fez as duas pontas: barrou a compra do banco pelo BRB em setembro de 2025 e, em 18/11/2025, decretou a liquidação extrajudicial. O TCU apura se a supervisão falhou antes disso.'; motivo='novo termo de glossario pedido pelo dono do site' }
Salvar @{ ent='glossario'; id='cade'; termo='CADE'; variantes='Cade, Conselho Administrativo de Defesa Econômica'; verbete=''; ordem='22'; definicao='Conselho Administrativo de Defesa Econômica: o órgão antitruste. Olha se uma fusão ou compra concentra mercado demais, e não se o banco comprado é sólido. Aprovou a compra do Master pelo BRB pelo lado da concorrência — a autorização que faltava era a do Banco Central, que barrou a operação.'; motivo='novo termo de glossario pedido pelo dono do site' }
Salvar @{ ent='glossario'; id='cldf'; termo='CLDF'; variantes='Câmara Legislativa do DF, Câmara Legislativa do Distrito Federal, Câmara Legislativa'; verbete=''; ordem='23'; definicao='Câmara Legislativa do Distrito Federal: o legislativo do DF, que fiscaliza o governo local e o BRB, banco público controlado por ele. Deu o aval legislativo à compra do Master pelo BRB, etapa vencida antes de o Banco Central barrar a operação em setembro de 2025.'; motivo='novo termo de glossario pedido pelo dono do site' }
"ok: 3 termos"
