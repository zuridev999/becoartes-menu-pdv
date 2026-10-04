# Fechamento do caixa por cédulas e moedas

## Regra operacional

No PDV, o operador informa as quantidades de cédulas de R$ 2, 5, 10, 20, 50, 100 e 200, e moedas de R$ 0,05, 0,10, 0,25, 0,50 e 1. A moeda de R$ 0,01 não entra. O total é calculado em centavos inteiros; o servidor recalcula e rejeita divergência com o total enviado pelo navegador.

O único valor de fechamento para `caixa_diario.valor_caixa_final` (ou `pdv_cash_sandbox` no sandbox) é esse total em espécie. Portanto, o Controle de Dinheiro do OS continua lendo o mesmo campo, sem mudança de contrato. A diferença continua sendo `total contado − total esperado`; falta acima de R$ 1 exige confirmação do superadministrador, como antes.

## Histórico

A migration aditiva `20261004_0001_cash_closure_counts` cria `pdv_cash_closure_counts`. Cada fechamento com contagem grava um evento imutável com dia do caixa, instante real do fechamento, quantidades, total, esperado, diferença, responsável e observação. Se o mesmo caixa for reaberto e fechado outra vez no mesmo dia, ficam dois eventos distintos. Não alteramos fechamentos antigos; eles não têm discriminação retrospectiva confiável.

O endpoint autenticado `GET /api/cash/closure-counts` lista até 100 eventos por período e exige `viewSalesTotals`. A aba administrativa “Fechamentos” mostra até 30 eventos do período filtrado e expande a composição por denominação. Dados de sandbox ficam separados dos de produção.

## Salvaguardas e limites

- Atualização do caixa, snapshot da contagem e auditoria `cash_closed` são uma transação: se um passo falha, tudo reverte.
- O `UPDATE` exige que o caixa ainda esteja aberto. Duas tentativas simultâneas no mesmo processo são serializadas; uma segunda tentativa é recusada. O estado do banco continua sendo a trava entre processos.
- Cliente antigo sem `cashCount` ainda pode fechar, mas não fabrica uma contagem histórica. Uma versão anterior com moeda de 1 centavo zerada é tolerada; valor não zero é recusado.
- A contagem diária ajuda a conferir composição e diferenças no fechamento, mas **não registra cada troco dado durante uma venda**. Para essa trilha individual seria necessária uma operação adicional por transação.
- Antes de publicar: validar migration na versão vigente, rodar `npm run validate`, conferir release/tag/commit/saúde conforme `DEPLOY_RULES.md` e verificar o histórico com um fechamento controlado em sandbox. Não fazer fechamento real só para testar.
