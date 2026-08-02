# Changelog

## 1.7.2 - 2026-08-02

- Permite ao superadministrador autorizar o computador do PDV mesmo depois de uma troca do IP público da loja.
- Mantém o PIN individual de cada operador e registra a autorização do terminal na auditoria.
- Impede que celulares sejam cadastrados ou reutilizados como terminais confiáveis do PDV.

## 1.7.1 - 2026-08-02

- Vincula eventos de abertura, tentativa e fechamento ao autor, à empresa e ao caixa corretos.
- Mantém o contrato de auditoria compatível com o histórico detalhado do Controle do Dinheiro no OS.

## 1.7.0 - 2026-07-31

- Reconcilia o estoque de vendas concluídas e bloqueia produtos sem ciclo operacional completo.
- Centraliza contratos de banco e dinheiro, mantendo telas críticas úteis durante falhas parciais de sincronização.
- Compartilha o rate limit entre instâncias e reforça a cobertura de autorização e idempotência.

## 1.6.2 - 2026-07-30

- Exige propriedade e tokens assinados para pedidos, rastreamento e comandas do Delivery.
- Reduz a duração das sessões de clientes, revoga acessos anteriores após recuperação e limpa sessões expiradas.
- Atualiza dependências vulneráveis, adiciona health check do container e amplia testes de autorização cruzada.

## 1.6.1 - 2026-07-30

- Protege cadastro, login e recuperação de conta do Delivery contra enumeração, replay e acesso cruzado.
- Remove gravações legadas da Goomer e garante inicialização segura sem a integração descontinuada.

## 1.6.0 - 2026-07-29

- Exibe sabores, adicionais e observações diretamente nas solicitações do PDV e nos detalhes do movimento.
- Unifica a leitura operacional dos itens entre PDV e Cozinha sem remover regras específicas de produção, como a indicação de batata nos pratos.
- Simplifica os cards e o detalhe do Cozinha, mantendo escolhas e observações junto ao produto correspondente.

## 1.5.9 - 2026-07-29

- Registra toda tentativa de fechamento de caixa, inclusive bloqueios por diferença e recusas de PIN ou permissão.
- Envia ao OS uma notificação com valores informado e esperado, diferença e responsável, preservando a confirmação normal quando o fechamento é válido.

## 1.5.7 - 2026-07-28

- Vincula computadores autorizados do PDV a uma chave criptográfica local, preservando o acesso por PIN mesmo quando o IP externo do restaurante muda.
- Mantém o primeiro vínculo restrito à rede operacional autorizada e preserva as permissões individuais de cada usuário.

## 1.5.5 - 2026-07-26

- Mantem os nomes de categorias e produtos em português como padrão no QR, com traduções próprias somente nos idiomas escolhidos pelo cliente.
- Amplia a área do Catálogo administrativo para a mesma leitura em desktop usada em Categorias.

## 1.5.4 - 2026-07-26

- Reordena o cardápio para destacar Pratos para Dois, Brazilian Dishes, Burgers e Sharing Plates.
- Amplia descrições no QR, remove o título duplicado do modal e dá mais espaço aos adicionais.
- Completa as traduções-base em inglês e espanhol dos novos pratos para dois.
- Expõe a data de build no endpoint de saúde da operação.

## 1.4.99 - 2026-07-26

- Habilita reordenamento de categorias e produtos por toque no cardapio administrativo.
- Mantem a rolagem do celular ao exigir uma pressao curta antes de iniciar o arraste.
