# Cobrança na entrega

O motoboy precisa saber, em cada entrega, se o pedido já está pago ou quanto e como cobrar. Uma rota com cartão ou Pix pede a maquininha antes de sair da loja.

Migration: `supabase/migrations/20261204120000_order_payment.sql`.

## Formas de pagamento

| Forma | No banco | O que o motoboy vê na porta |
| --- | --- | --- |
| Já pago (no app, online, no balcão) | `PAID` | **Já pago · não cobrar** |
| Dinheiro | `CASH` + valor, e "troco para" opcional | **Cobrar R$ 52,90 em dinheiro** · Troco para R$ 100,00: devolva R$ 47,10 |
| Cartão | `CARD` + valor | **Cobrar R$ 45,90 no cartão** · Na maquininha |
| Pix na entrega | `PIX` + valor | **Cobrar R$ 30,00 no Pix** · Pelo QR da maquininha ou pela chave Pix da loja |

Pedidos salvos antes desta mudança, ou trazidos sem a informação, ficam **sem pagamento** (`null`). O app mostra "Pagamento não informado: confirme com a loja se está pago antes de entregar".

## Banco

- Colunas em `orders`: `payment_method`, `amount_due_cents` (só quando o motoboy cobra) e `change_for_cents` (a nota do cliente, só em dinheiro e maior que o valor).
- `create_order`, `import_order` e `update_order` ganham `p_payment_method`, `p_amount_due_cents` e `p_change_for_cents`, todos com padrão `null`. Um painel sem esta versão continua funcionando.
- As três funções foram reescritas com as mesmas verificações de antes, mais o pagamento (`RPM_ORDER_FIELDS`, detalhe `payment`). O cadastro fica em `private.create_order_core`, usado pelo painel e pela importação.
- **Repetições:**
  - a mesma requisição de `create_order` responde o pedido já salvo e não muda o pagamento;
  - o mesmo código de `import_order` faz o mesmo.
- **Edição:** só enquanto o pedido espera despacho, como antes. Salva o pagamento enviado; sem pagamento enviado, o pedido fica sem.
- **Painel:** `get_operations_board` traz `orderPayments` (`deliveryId`, `method`, `amountDueCents`, `changeForCents`).
- **App:** `get_courier_route` traz `payment` em cada parada. Continua sem o celular do cliente.
- Testes: `tests/sql/delivery-core/payment-contracts.sql`.

## O 0800 do iFood (mesma migration)

O iFood esconde o celular do cliente. O cupom imprime o mesmo 0800 para todos os clientes, com o ID do pedido: "0800 718 2283 ID: 12345678". Esse número não pode virar o celular do cliente, por dois motivos:
- juntaria todos os clientes do iFood em "Já pediu aqui";
- mandaria o WhatsApp para o 0800.

Como funciona:
- **Coluna `orders.customer_contact`:** guarda o contato do app ("0800 718 2283 · ID 12345678"). `customer_phone` passa a aceitar vazio, mas todo pedido precisa ter um dos dois (`orders_customer_reach_check`).
- **Só pedidos trazidos de outro sistema** (`import_order`, com `p_customer_contact`) podem vir sem celular. Pedido digitado no painel (`create_order`) continua exigindo o celular. Um 0800 enviado como celular é recusado.
- **Na edição**, o contato fica, e a loja pode acrescentar um celular depois.
- **WhatsApp:** os avisos "saiu para entrega" e "você é o próximo" só entram na fila para pedidos com celular. O próprio iFood avisa o cliente dele, e a rota inicia normalmente.
- **O app do motoboy** não recebe nem o celular nem o contato.
- **O painel** recebe `customerContacts` no quadro. No formulário do pedido impresso, aparece "Contato do app: …", e o WhatsApp fica opcional.
- **O leitor** reconhece o 0800 na linha do telefone, ou solto no texto, com ID, código, localizador ou ramal.

## Retirada na loja

Cupom de retirada ("MODALIDADE: RETIRADA NA LOJA", "Retirar no balcão", "Tipo: Retirada", "Previsão de retirada") não precisa de motoboy:
- o programa da impressora não manda o pedido para o painel, e a janela avisa "Retirada na loja: não vai para o painel";
- o cupom sai no papel normalmente;
- no "Colar pedido", o texto de retirada é recusado com o motivo.

## Painel

- **Novo pedido e Editar pedido:** o bloco **Pagamento** é obrigatório com dados reais.
  - Opções: Já pago, Dinheiro, Cartão e Pix na entrega.
  - Fora "Já pago", pede o **valor a cobrar**.
  - Em dinheiro, aceita **troco para**, que precisa ser maior que o valor.
  - No demonstrativo, o bloco é opcional.
- **Colar pedido e cupom da impressora** (`readPayment` em `features/operations/payment.ts`) leem o pagamento do texto:
  - "pago online", "pedido pago pelo app", "não cobrar": já pago;
  - "dinheiro", "cartão", "crédito", "débito", "vale-refeição" ou "Pix" numa linha de pagamento: a forma;
  - o último "Total" é o valor. "Cobrar do cliente: R$ X" vale mais que o total;
  - "Troco para R$ 100" ou "troco pra 100" é a nota do cliente;
  - "Troco: R$ 47,10" é o troco em si, e a nota é o valor mais o troco;
  - "Valor pago: R$ 100,00" num pedido em dinheiro é a nota do cliente, não "já pago".
- **Cadastrar sozinho:** só salva sozinho o cupom que diz o pagamento completo. Senão, o pedido fica para conferir com o motivo:
  - "o cupom não diz se está pago ou como o cliente paga";
  - "o cupom não diz quanto cobrar".
- **Lista de pedidos:** cada pedido mostra uma etiqueta: "Pago", ou "Cobrar R$ 45,90 · cartão".

## App do motoboy

- **Rota em preparação:** o quadro **Leve com você** aparece antes da liberação, para o motoboy já se preparar. Ele lista:
  - a maquininha (entregas no cartão ou Pix);
  - o troco somado das entregas em dinheiro;
  - as entregas sem pagamento informado.
- **Retirada liberada com cartão ou Pix:** o motoboy marca **"Peguei a maquininha"** antes de aparecer o "Deslize para iniciar a rota".
- **Aviso de retirada liberada** (notificação): "Pegue os pedidos no balcão e a maquininha. Leve R$ 47,10 de troco. Deslize para iniciar a rota."
- **Na entrega:** um quadro grande, acima das observações, diz o que cobrar e como. A lista de entregas mostra o mesmo, em uma linha.

## Fora desta etapa

- Acerto de caixa por motoboy no fim do dia (quanto cada um recebeu em dinheiro, cartão e Pix).
- O motoboy confirmar que cobrou ao deslizar "Entregue".
- Mudar a forma de pagamento com o pedido já na rua: hoje a loja liga para o motoboy.
