# Changelog

## Unreleased

## 1.14.1 - 2026-09-19

- Corrige o espaçamento do campo de CPF ou telefone para impedir a sobreposição da lupa sobre os primeiros números.

## 1.14.0 - 2026-09-19

- Publica a conferência de saída em `comanda.becoartes.com`, protegida por PIN e isolada da sessão do PDV.
- Restringe a consulta a CPF ou telefone, bloqueia pesquisa por nome e mantém fora da tela a fila de novas solicitações.
- Corrige o campo numérico para aceitar no máximo 11 dígitos sem misturar máscaras de telefone e documento.

## 1.13.0 - 2026-09-19

- Reorganiza Venda Balcão e abertura de mesas com cards responsivos, fotos do catálogo e categorias operacionais mais claras.
- Reconstrói a finalização de conta para celular e desktop, simplifica desconto e taxa de serviço, e elimina a confirmação intermediária de pagamento.
- Valida a digitação monetária, bloqueia excesso em cartão ou Pix e calcula troco em dinheiro na Venda Balcão.
- Permite manter mesas físicas específicas no fluxo tradicional quando o modo comanda estiver ativo, sem interromper contas abertas.
- Remove do PDV o aviso de auditoria de estoque e mantém a barra de rolagem operacional sempre visível.
- Registra no histórico técnico de cada pedido QR o IP, o dispositivo/navegador e a visita associada, sem alterar o esquema do banco.

## 1.12.0 - 2026-09-15

- Separa acessos técnicos do Nginx de visitas reais ao QR com um `visit_id` persistente por sessão de 30 minutos.
- Registra, sem dados pessoais, o funil diário de cardápio visível, produto aberto, início do pedido, pedido enviado e comanda aberta.
- Protege a coleta pública pelo token assinado da mesa, evita duplicidade por etapa e restringe o relatório consolidado a usuários com permissão de faturamento.

## 1.11.5 - 2026-09-12

- Corrige o arraste vertical por toque no QR ao limitar o catálogo à altura real do celular e criar uma área interna de rolagem, sem alterar o desenho da tela.

## 1.11.4 - 2026-09-12

- Restaura integralmente o layout de rolagem do QR usado na versão 1.10.5 e mantém somente o isolamento dos alertas de checklist.

## 1.11.3 - 2026-09-12

- Limita explicitamente o painel do cardápio à área abaixo do cabeçalho e mantém o catálogo contido no pai, garantindo arraste vertical real no QR.

## 1.11.2 - 2026-09-12

- Ancora o QR diretamente à viewport para manter a área interna rolável mesmo em navegadores que calculam incorretamente unidades dinâmicas de altura.

## 1.11.1 - 2026-09-12

- Restaura a rolagem vertical do cardápio QR em telas móveis e desktop, limitando a área pública à altura real da viewport.
- Impede que alertas e consultas de checklist sejam montados nos domínios QR, tablet e delivery; permanecem restritos às telas operacionais.

## 1.11.0 - 2026-09-12

- Destaca no PDV o lembrete de coleta do lixo às segundas, quartas e sextas, com prazo explícito de 19h.
- Usa a mensagem e o prazo enviados pelo catálogo canônico do OS e mantém o aviso até a confirmação do checklist.

## 1.10.5 - 2026-09-09

- Oculta temporariamente o botão flutuante da conta enquanto o anúncio interno do QR está visível, mantendo o anúncio longe de controles clicáveis e preservando o acesso à conta pelo cabeçalho.

## 1.10.4 - 2026-09-09

- Move o anúncio do QR para dentro do cardápio, depois dos três primeiros produtos, para que mesa, categorias e itens apareçam antes da publicidade.
- Troca o banner estreito de 320 x 50 pixels por um bloco retangular responsivo, sem adicionar vignette nem ocupar carrinho, pedido ou pagamento.

## 1.10.3 - 2026-09-09

- Impede que o carregador inicial permaneça sobre o QR, PDV, tablet, cozinha e bar após os dados estarem prontos.

## 1.10.2 - 2026-09-09

- Remove dependências de desenvolvimento da imagem final e bloqueia o build quando a auditoria de produção encontra vulnerabilidade alta.

## 1.10.1 - 2026-09-09

- Atualiza o processamento de imagens para a versão corrigida do Sharp e zera a auditoria de vulnerabilidades de produção.

## 1.10.0 - 2026-09-09

- Prepara PDV, cozinha, bar, tablet, QR e delivery para o libSQL definitivo na KVM8.
- Remove materializações e inicializações de escrita dos caminhos de leitura do BFF.
- Mantém as inicializações necessárias em startup e nos fluxos explícitos de mutação.

## 1.9.19 - 2026-09-02

- Mostra no PDV um alerta individual sonoro para o usuario autenticado enquanto o checklist de abertura ligado ao ponto estiver pendente.
- Permite confirmar o aviso e o reapresenta apos cinco minutos ate a validacao, consultando o OS a cada quinze segundos.
- Encaminha a identidade assinada da sessao ao OS para impedir alertas de outro colaborador no mesmo terminal.

## 1.9.18 - 2026-09-02

- Limita o comercial superior do PDV a 320 x 50 pixels também na operação.
- Reserva a altura correta abaixo do anúncio e restaura a rolagem até o fim da tela em celulares.

## 1.9.12 - 2026-08-26

- Restaura a barra de mesa, idioma, atendimento e conta imediatamente abaixo do anúncio no QR.
- Mantém a barra compacta no celular e reserva o restante da tela para o cardápio, sem espaço vazio duplicado.

## 1.9.11 - 2026-08-26

- Remove no celular o espaço reservado pelo cabeçalho do QR que ficava escondido sob o anúncio.
- Mantém o cabeçalho em telas maiores, posicionado abaixo do banner compacto.

## 1.9.10 - 2026-08-26

- Limita o banner superior do QR a 320 x 50 pixels para não bloquear o cardápio em celulares.
- Remove o formato responsivo automático desse bloco para impedir criativos verticais grandes.

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
