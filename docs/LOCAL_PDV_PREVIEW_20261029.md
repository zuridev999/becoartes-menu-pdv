# Prévia local PDV e QR — 29/10/2026

Status: registro da prévia local usada para validar a release `v1.30.0` antes da publicação.

## Acessos da prévia

- PDV: http://127.0.0.1:18445/pdv
- Catálogo: http://127.0.0.1:18445/admin/menu
- QR: http://127.0.0.1:18445/mesa/6

A prévia usa banco temporário separado e simulador de pagamento. Os testes descritos abaixo não movimentaram dinheiro.

## Orientação para a equipe

1. Abra uma mesa em atendimento e toque no lápis abaixo do número. Digite o nome ou apelido e salve. O número permanece; o apelido aparece na lista e na pesquisa. No modo comanda, o nome do cliente também permanece visível. O apelido é removido ao liberar a mesa.
2. No catálogo, edite o produto e abra Adicionais. Expanda o grupo para ver fotos e alternar Visível/Oculto. Revise e salve as alterações do grupo. A tela informa quais produtos compartilham as opções.
3. Caipirinha, Caipiroska e Saquerinha compartilham sabores. Ocultar uma fruta afeta todos os produtos vinculados. Pastel tem seu próprio grupo. Criar grupos é permitido somente ao superadministrador.
4. No QR, o cliente escolhe o idioma e encontra em Minha conta: pagamento pelo celular, pedir conta ou pedir maquininha.
5. Pedir maquininha gera solicitação para a equipe, aviso no canto e destaque vermelho/amarelo na mesa. Isso não registra pagamento. Use o atendimento da solicitação para dar ciência; recolher o aviso não resolve a solicitação.
6. Pagamento online confirmado e suficiente para quitar a conta destaca a mesa em verde. A equipe abre a conferência e dá baixa; não deve cobrar novamente. Pagamento parcial não representa conta quitada.

## Verificação realizada

- Build concluído e diff sem erros de whitespace.
- Testes de backend, autorização, apelido, grupos compartilhados, edição administrativa, pagamentos QR e conferência online passaram.
- Traduções: 197 chaves de interface e 327 campos de catálogo verificados em inglês, espanhol e francês.
- Editor visualmente conferido a 390 px, sem overflow horizontal; medida adicional a 320 px também sem overflow. QR de sabores e recheios conferido a 390 px com miniaturas carregadas.
- Fluxo simulado Pix → voltar/trocar por cartão → confirmação → conferência do PDV verificado. O simulador não comprova aceitação real do PagBank.
- Apelido salvo, pesquisável e limpo após liberação da mesa, verificado na prévia.

## Antes da publicação

- Executar o teste real autorizado de Pix e cartão, incluindo retorno do provedor e conferência no PDV. Apple Pay não está habilitado/confirmado.
- Aplicar a migração de schema de apelido e revisar os scripts de consolidação de sabores e reparo de imagens contra o catálogo atual. Esses scripts foram aplicados somente na cópia local; não sincronizar o banco de demonstração com produção.
- Seguir DEPLOY_RULES.md e verificar versão real antes de uma publicação autorizada.

As novas fotos são ilustrativas; visibilidades e preços existentes foram preservados. Este documento registra a validação anterior ao deploy e não substitui a conferência da produção.
