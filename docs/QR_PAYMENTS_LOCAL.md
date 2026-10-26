# Pagamento pelo QR — prévia local

Preparação em 26/10/2026, sobre PDV v1.29.2 / bd68b50. Sem deploy.

## Comportamento

- “Minha conta” mostra itens, subtotal, taxa de serviço, total e saldo, com um único botão “Pagar com Pix ou cartão”. O formulário só aparece após o toque, no mesmo modal, e “Voltar à conta” retorna ao resumo sem recarregar a página.
- Pix solicita nome completo, e-mail e CPF. Cartão acrescenta número, validade e código de segurança. Interface, avisos e confirmação traduzidos em português, inglês, espanhol e francês; valores continuam em BRL.
- Pix e cartão à vista usam Orders dentro da página. Pix usa `charges.payment_method.type=PIX` e lê `charges.qr_code.text`, conforme o formato atual do PagBank. O cartão sai do navegador criptografado pelo SDK PagBank. Apple Pay permanece indisponível enquanto certificados e homologação não forem concluídos.
- Total calculado no servidor. O cliente não modifica a taxa; ajuste é feito pela equipe no PDV antes do pagamento.
- Confirmação aceita somente `PAID`, com identidade, moeda, método e centavos correspondentes à cobrança salva. `AUTHORIZED` não dá baixa.
- Uma cobrança pendente por mesa, chave de idempotência e lançamento único por cobrança. Webhooks assinados consultam o pedido no PagBank antes de registrar o recebimento.
- Alterações de itens, saldo já recebido ou resposta divergente vão para revisão e não dão baixa automática.
- Mesa integralmente paga pelo QR pulsa em verde e exibe “Paga pelo cliente”. O clique abre confirmação e “Sim, abrir conferência”; a conferência termina em “Conferir e dar baixa”. O pagamento recebido é reaproveitado no fechamento.
- Comprovante impresso: “Taxa de serviço”, sem percentual.

## Abrir para testar

Execute `npm run build` e `npm run preview:qr-payments`.

- Simulação: http://127.0.0.1:18441/mesa/6
- PDV da simulação: http://127.0.0.1:18441/pdv — PIN fictício 8642.
- Nome fictício, teste@example.com e CPF de teste 52998224725. “Simular aprovação” e “Simular recusa” existem somente no modo simulador com banco local.

`npm run preview:qr-payments -- --real` abre uma segunda prévia em http://127.0.0.1:18442/mesa/7 e /mesa/8. Cada conta tem um item de R$ 0,09 e taxa arredondada de R$ 0,01: total R$ 0,10. Limite máximo fixado em R$ 0,10 por cobrança nesta prévia. O resumo mostra a taxa apenas uma vez; o formulário não repete avisos internos de teste ou a frase sobre serviço incluído.

O iniciador lê em memória a configuração do próprio runtime PDV via SSH, sem salvar ou imprimir token. Banco, mesas e fechamento são fictícios e locais. Ao confirmar o formulário, a cobrança é real e entra na conta PagBank do Becoartes; não entra como venda no banco operacional de produção. Não foi submetido pagamento real automaticamente.

Testar Pix no celular exige copiar o código Pix da tela local. Os links localhost abrem no computador que está executando a prévia.

## Roteiro de aceitação

1. Abrir Minha conta e conferir itens, serviço e total.
2. Tocar “Pagar com Pix ou cartão”. Escolher Pix ou Crédito, preencher dados e confirmar.
3. Esperar confirmação. No teste real, a prévia consulta Orders; não envia webhook para a aplicação de produção.
4. Abrir PDV local, verificar mesa pulsando em verde, confirmar e abrir conferência.
5. Conferir pagamento já lançado e usar “Conferir e dar baixa”. Mesa fica livre; pagamento não é duplicado.
6. Testar recusa, conta alterada e confirmação repetida no simulador.

## Validação e publicação futura

`npm test`, `npm run test:qr-payments`, `node scripts/test-online-paid-conference.mjs`, `npm run build` e lint dos componentes alterados.

Produção mantém v1.29.2 / bd68b50. Publicação depende de aprovação do teste, versão/tag/manifesto e regras de release. O recurso inicia desativado (`QR_PAYMENTS_PROVIDER=disabled`). A ativação usa `pagbank`, credencial do próprio PDV e URL HTTPS do webhook. Débito e Apple Pay não são anunciados.

Referências: https://developer.pagbank.com.br/reference/criar-pagar-pedido-com-cartao e https://developer.pagbank.com.br/reference/criar-pedido .

Erros do provedor registram apenas HTTP, código, campo e categoria do erro nos logs/auditoria; dados do comprador, cartão e credenciais não entram nesses registros. A interface traduz erros de valor não aceito, CPF rejeitado e conta não habilitada. Os testes de R$ 0,10 validam cálculo e payload; a aceitação desse valor pelo gateway depende da resposta real e não é presumida.

Para reiniciar sem perder as tentativas locais: `QR_PREVIEW_RESUME_DB=/caminho/temporario/beco-qr-payment-preview-XXXX/preview.db npm run preview:qr-payments -- --real`. Somente bancos temporários desta prévia são aceitos.
