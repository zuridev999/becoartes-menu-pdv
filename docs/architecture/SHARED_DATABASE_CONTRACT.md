# Contrato do banco operacional compartilhado

Status: vigente a partir de 31/07/2026.

## Decisão

OS e PDV continuam no mesmo Turso durante a estabilização. A separação física não
será feita sem outbox, reconciliação e uma janela própria. O contrato executável
está em `config/shared-database-contract.json`.

Cada tabela possui exatamente um owner. Owner define schema e migrations; não
significa ser o único leitor. Escrita por mais de um sistema só é permitida quando
declarada no contrato.

## Compatibilidade N/N-1

1. Mudanças aditivas entram antes dos consumidores.
2. Coluna nova deve aceitar `NULL` ou possuir default no servidor.
3. Renomear exige expandir, ler/escrever nos dois formatos, backfill e só depois contrair.
4. Remoção e mudança de tipo são proibidas no mesmo deploy que atualiza os consumidores.
5. O writer owner sobe primeiro; leitores sobem depois; a contração fica para uma release posterior.
6. Toda migration compartilhada precisa de teste com a versão atual e a imediatamente anterior de OS e PDV.

## Ownership principal

| Domínio | Owner | Escritores adicionais |
|---|---|---|
| empresa, usuário e permissões | OS | nenhum |
| estoque e movimentos | OS | PDV, somente baixa/reconciliação de venda |
| ficha técnica e ingredientes | OS | nenhum |
| notificações | OS | PDV |
| cardápio, categorias e adicionais | PDV | nenhum |
| pedidos, contas e pagamentos de mesa | PDV | nenhum |
| Delivery | PDV | nenhum |

## Gate

`npm run test:shared-db-contract` valida formato, ownership único e presença das
tabelas críticas. Mudanças no contrato exigem atualização coordenada nos dois
repositórios e registro da ordem de deploy.

## Risco residual

O banco compartilhado continua ampliando o raio de falha. Este contrato reduz
drift e define responsabilidade, mas não substitui a futura separação por eventos.
