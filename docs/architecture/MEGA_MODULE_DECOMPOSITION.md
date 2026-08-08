# Plano de decomposicao dos modulos grandes

## Regra de contencao

`npm run test:module-size` impede que os quatro maiores arquivos crescam.
Reduzir o limite e obrigatorio sempre que uma extracao for concluida.

## Ordem de extracao

1. `server/bff.mjs`: dominios puros de dinheiro, caixa, delivery, estoque e
   fechamento; depois servicos com transacoes explicitas.
2. `src/views/admin/AdminView.tsx`: uma tela por dominio administrativo.
3. `src/views/pdv/PDVView.tsx`: mapa de mesas, conta e venda de balcao.
4. `src/store.ts`: slices por dominio e seletores tipados.

## Primeira entrega

Conversao monetaria, formatacao e assinatura canonica de pagamentos foram
movidas para `server/domain/money.mjs` e cobertas por teste de regressao.

## Criterio

Cada extracao deve preservar a API publica, ter teste de caracterizacao e
reduzir a linha-base. Nao sera feita uma reescrita geral durante a operacao.
