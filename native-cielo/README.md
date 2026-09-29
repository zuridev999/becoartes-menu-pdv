# Becoartes PDV • Cielo LIO ON

Aplicativo **Android nativo**, sem WebView, integrado ao BFF existente do PDV. Versão de desenvolvimento `0.1.0`, package `com.becoartes.lio`, minSdk 24 / targetSdk 29. Não é uma segunda base de mesas/produtos.

## O que foi implementado

- Ativação individual das LIO ON 02322106, 02322105 e 02322104 por código temporário emitido pelo superadmin.
- O funcionário usa o mesmo PIN de quatro dígitos já cadastrado no PDV. O administrador apenas libera quais usuários podem operar as maquininhas. Permissões atuais continuam valendo; desativação do funcionário bloqueia o acesso. Credenciais do aparelho ficam protegidas pelo Android Keystore, sem backup Android.
- Todas as mesas por padrão, filtro de ativas, conta com itens, taxa, total, pago e saldo. Atualização periódica da lista e atualização antes de imprimir/pagar.
- Catálogo com fotos, busca universal, categorias, seleção múltipla, quantidade, observações e grupos de opções obrigatórias. Preços recalculados no servidor, nunca aceitos do aparelho. Envio pelo mesmo `sendToKitchen` do PDV.
- Crédito, débito e Pix por URI Cielo. Dinheiro com confirmação física, valor recebido e troco. Não há foto do dinheiro nesta versão.
- Impressão nativa Cielo da conferência de conta, com taxa de serviço. Não é documento fiscal.
- Pagamento parcial, consulta de cobrança interrompida, prevenção de reenvio automático, identificadores idempotentes, registro da modalidade **confirmada pela Cielo**, auditoria por operador/máquina.
- Finalização explícita depois do saldo zerado: usa `closeBillWithInventorySync` existente, inclusive estoque. Só libera a mesa após sucesso do servidor.
- Painel do superadmin em `/lio-admin.html`, com atalho `LIO` no PDV: códigos, ativação, revogação e conferência de operações pendentes.
- Demonstração offline dentro do aplicativo: dados em memória, faixa DEMONSTRAÇÃO, nenhuma chamada ao PDV/Cielo, nenhuma impressão/cobrança real.

## Compilar

Requisitos: JDK 17, Android SDK platform 36 e build-tools 35.0.0. Compile SDK não muda o target 29.

```sh
cd native-cielo
bash build.sh
```

O script aceita `JAVA_HOME` e `ANDROID_SDK_ROOT`. Os defaults são os caminhos Homebrew desta máquina. Não usa Gradle nem baixa dependências. Gera:

- `build/becoartes-lio-debug.apk`: instalável para desenvolvimento, assinatura v2, **não enviar como release oficial**.
- `build/becoartes-lio-release-unsigned.apk`: alinhado, para assinatura com a chave definitiva da empresa antes da submissão.
- `build/becoartes-lio-release.apk`: assinatura de release criada em 29/09/2026; verificar com `bash sign-release.sh` após cada build.

A chave debug fica somente em `build/` ignorado pelo Git. A chave definitiva fica fora do repositório em `~/Library/Application Support/Becoartes/LIO/becoartes-lio-release.p12`; a senha fica no Chaves do macOS no item `Becoartes LIO release signing` (conta `becoartes-lio`). Preserve uma cópia de recuperação segura antes de trocar de máquina; não substitua essa identidade em futuras atualizações e nunca coloque chave/senha no repositório.

## Backend — ativação controlada (NÃO executada em produção)

Por padrão o recurso está **desligado**. Com `LIO_ENABLED` ausente, o fluxo atual do PDV continua funcionando sem consultar tabelas LIO.

1. Revisar `DEPLOY_RULES.md` do workspace e as mudanças preexistentes no checkout. Não publicar todo o diretório sem revisão.
2. Fazer backup oficial e testar em staging. Executar `scripts/lio-migrate.mjs` explicitamente com a conexão correta. Cria somente tabelas `lio_*` e um índice; não altera/povoa mesas, produtos ou caixa. Nunca roda na inicialização do BFF.
3. Configurar variáveis no servidor (não no APK):

```text
LIO_ENABLED=1
LIO_CIELO_ENV=sandbox
LIO_CIELO_CLIENT_ID=<Dev Console>
LIO_CIELO_ACCESS_TOKEN=<Dev Console>
LIO_CIELO_MERCHANT_ID=<identificador de integração do estabelecimento>
```

`LIO_CIELO_MERCHANT_ID` não deve ser inferido a partir do EC/CNPJ. Somente usar o valor fornecido pela Cielo. `LIO_CIELO_ENV=production` só após teste e aprovação. O segredo existente `BFF_SESSION_SECRET` protege os códigos; nenhum segredo novo está hardcoded.

Exemplo para **banco local isolado**:

```sh
TURSO_DATABASE_URL=file:/caminho/isolado/lio-test.db node scripts/lio-migrate.mjs
```

Banco remoto exige o argumento adicional `--confirm-production-additive-migration`. Não executar sem autorização de release. Se alguém ativar `LIO_ENABLED=1` sem schema, o BFF falha na inicialização em vez de aceitar pagamentos parcialmente configurados.

4. Após publicar BFF/frontend e validar saúde/versão, superadmin entra no PDV → LIO. Define PINs sem compartilhar entre pessoas; gera código para cada terminal. Cada código expira em 10 min e é de uso único.
5. Instalar aplicativo pela distribuição autorizada da Cielo. Digitar código de ativação; depois, código do funcionário. A instalação nas três depende da liberação no Dev Console; **não foi feita**.

## Pagamentos e falhas

O app cria uma intenção no servidor antes de abrir a Cielo e a salva de forma durável no aparelho. A chamada da Cielo usa `reference=intent.id`. Uma resposta perdida nunca gera outra cobrança automática. Em reinício, login → **Conferir pagamento** → consulta no servidor.

O callback da Cielo não é prova suficiente. O BFF consulta a API Cielo por ID/referência e exige pedido PAID, saldo zero, valor exato, uma transação PAYMENT/CONFIRMED, número do terminal autorizado e modalidade reconhecida. Sem confirmação remota, **não dá baixa**. O código usa os campos oficiais `transactions[].payment_product.primary_product_name`; a forma exata retornada ao EC precisa ser validada no piloto físico antes de produção.

Intenção pendente impede alterações daquela mesa nos principais serviços existentes por `ensureTableAccess` e `sendToKitchen`. Não há bloqueio global do bar. Não iniciar implantação com operações em andamento na LIO. A coordenação é voltada ao BFF atual de processo único; múltiplas réplicas e corridas com operações que já estavam executando precisam de teste/conferência antes de qualquer expansão.

Se a Cielo aprovar, mas os itens mudarem, a intenção fica retida para conferência; não cobra outra vez e não apaga pedidos. O dinheiro recebido acima do saldo gera troco, mas apenas o valor da conta é lançado em `table_payments`. Valor recebido e troco permanecem na intenção/auditoria.

Operação recusada/não iniciada não é descartada silenciosamente. Superadmin confere o histórico Cielo e pode liberar **somente intenção pending**, com justificativa auditada em `/lio-admin.html`. Isso não estorna pagamentos. Para operação `verified/recorded`, concluir a conciliação; nunca liberar como se não tivesse sido cobrada. Depois de uma liberação, a consulta no app limpa a pendência cancelada.

## Limites explícitos desta versão

- Mesas tradicionais. Comandas individuais aparecem identificadas e são atendidas no PDV, preservando seu ciclo próprio.
- Não altera desconto, cupom, taxa de serviço, cancelamento/estorno de pagamento aprovado, nem configurações administrativas na maquininha.
- Foto de dinheiro não implementada; não é requisito para receber na primeira versão.
- Sem funcionamento operacional offline: offline é apenas demonstração. Não aceita cobranças offline nem baixa manual de Pix.
- Não contém anúncio, analytics de terceiros, CPF do cliente, dados completos de cartão ou credenciais Cielo fixas no APK.
- Suporte cadastrado: Casa Becoartes LTDA, CNPJ 35.118.706/0001-37, EC 2807087870, adm.becoartes@gmail.com, (11) 97471-7013. Página pública de suporte/política ainda precisa ser definida e publicada pelo responsável pelo cadastro.

## Testar

```sh
node scripts/test-lio.mjs
node scripts/test-lio-bff.mjs
node scripts/test-critical-backend.mjs
node scripts/test-catalog-modifiers.mjs
npm run test:billing-service-fee
npm run typecheck
npm run build
bash native-cielo/build.sh
```

Veja `HANDOFF.md` para os testes concluídos, pendências e os passos que ficam com quem fará o Dev Console.

## Contratos oficiais consultados

- [Pré-requisitos / restrição de WebView](https://docs.cielo.com.br/cielo-smart/docs/pre-requisitos)
- [Pagamento URI](https://docs.cielo.com.br/cielo-smart/docs/pagamento)
- [Exemplos oficiais de integração local](https://github.com/DeveloperCielo/LIO-SDK-Sample-Integracao-Local)
- [Consulta de pedido REST](https://docs.cielo.com.br/cielo-smart/reference/consultar-um-pedido)
- [Entidades e transações](https://docs.cielo.com.br/cielo-smart/reference/entidades)
- [Serviço em primeiro plano](https://docs.cielo.com.br/cielo-smart/docs/servico-em-primeiro-plano)
