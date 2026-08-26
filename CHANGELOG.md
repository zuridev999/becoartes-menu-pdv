# Changelog

## Unreleased

## 1.9.9 - 2026-08-26

- Deixa scripts e anúncios externos fora da interceptação do service worker do QR.
- Atualiza o cache offline para distribuir a correção aos aparelhos já instalados.

## 1.9.8 - 2026-08-26

- Mantém o espaço do banner do QR enquanto o Google AdSense processa a solicitação, sem descartá-lo por tempo.
- Identifica cada rota `/mesa/N` com título, descrição e endereço canônico próprios para o rastreador do AdSense.
- Publica `robots.txt` e sitemap com as 50 mesas reais e mantém somente um banner manual no QR.

## 1.9.7 - 2026-08-25

- Mantém o banner manual responsivo no topo do QR code em celulares e computadores.
- Mantém o banner superior do PDV sem faixa inferior nessa tela.

## 1.9.6 - 2026-08-25

- Adiciona banner manual responsivo fixado no topo do PDV.
- Mantém a faixa inferior das telas operacionais fora do PDV.

## 1.9.5 - 2026-08-25

- Preserva o nonce no script principal gerado pelo Vite para carregar o aplicativo junto com o AdSense.

## 1.9.4 - 2026-08-25

- Aplica a CSP com nonce também no BFF Node usado em produção e injeta o nonce real no HTML servido.

## 1.9.3 - 2026-08-25

- Move o carregador oficial do AdSense para o `head` e autoriza sua cadeia com CSP baseada em nonce.
- Publica `ads.txt` válido em todos os domínios operacionais e elimina faixas vazias de anúncios não preenchidos.
- Impede que o banner inferior cubra os botões de conta e checkout no QR e no delivery.

## 1.9.2 - 2026-08-25

- Remove a publicidade própria de todas as telas operacionais e do cardápio.
- Mantém somente os blocos oficiais do Google AdSense.

## 1.9.1 - 2026-08-25

- Ativa os blocos reais do AdSense usando o publisher aprovado do site Becoartes.
- Exibe topo e faixa inferior móvel no QR/delivery, topo no tablet e faixa discreta nas telas operacionais.
- Mantém as campanhas próprias separadas e oculta slots sem preenchimento para não deixar espaços vazios.

## 1.9.0 - 2026-08-24

- Exibe campanhas próprias da Becoartes no PDV, QR, tablet, cozinha, bar, delivery e telas de acesso.
- Mantém a faixa fora dos controles operacionais e permite configurar ou alternar campanhas por ambiente.

## 1.8.3 - 2026-08-22

- Adiciona cupom de identificação reutilizável para registrar a origem de uma mesa sem alterar o valor da conta.
- Mantém cada uso gravado no fechamento e na auditoria da mesa, sem transformar o identificador em cupom resgatado.

## 1.8.2 - 2026-08-15

- Corrige 27 vínculos legados de ficha técnica para a unidade-base real de batata, cachaça, gin, tônica, cheddar, pão e temperos.
- Consolida alertas históricos repetidos sem reprocessar vendas antigas nem alterar o saldo físico atual.
- Mantém pendências de vínculo não relacionadas abertas e auditáveis por mesa.

## 1.8.1 - 2026-08-15

- Diferencia vínculo ausente de conversão de unidade pendente nas notificações de estoque do OS.
- Agrupa ocorrências repetidas por mesa e item, informa a quantidade que não foi baixada e evita alertas duplicados.
- Resolve a notificação quando a reconciliação da mesa termina sem outros eventos pendentes.

## 1.8.0 - 2026-08-13

- Mantem mesas que ja estavam abertas no fluxo de mesa durante a mudanca para o modo comanda.
- Abre novas comandas por QR depois do fechamento da mesa e preserva a mesa fisica de origem em pedidos e solicitacoes.
- Restringe cada cliente a sua propria comanda e remove dados internos das respostas publicas.
- Protege contra pedidos duplicados, encerramento concorrente, tokens antigos e indisponibilidade de comandas.

## 1.7.9 - 2026-08-09

- Volta a mostrar todos os itens e escolhas de cada novo pedido QR em "Novas solicitações".
- Mantém o cartão limitado ao pedido recém-enviado, sem acumular produtos anteriores da mesa.

## 1.7.4 - 2026-08-07

- Integra a base remota atual do PDV com a proteção contra baixa por nome quando há vínculo por ID.
- Converte unidades compatíveis antes da baixa de estoque e bloqueia misturas de dimensões sem conversão.
- Mantém as melhorias de segurança, Delivery, terminais confiáveis e prevenção de baixa duplicada.

## 1.7.3 - 2026-08-03

- Impede que adicionais sem vínculo explícito encontrem fichas técnicas por nome e baixem ingredientes em duplicidade.
- Mantém a baixa por CMV do item principal e preserva adicionais que possuam um ID de estoque ou de ficha vinculado.

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
