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
- As verificações antigas continuam nas funções `private.*_core`. A nova versão pública confere a loja e o pagamento (`RPM_ORDER_FIELDS`, detalhe `payment`) antes de gravar.
- **Repetições:**
  - a mesma requisição de `create_order` responde o pedido já salvo e não muda o pagamento;
  - o mesmo código de `import_order` faz o mesmo.
- **Edição:** só enquanto o pedido espera despacho, como antes. Salva o pagamento enviado; sem pagamento enviado, o pedido fica sem.
- **Painel:** `get_operations_board` traz `orderPayments` (`deliveryId`, `method`, `amountDueCents`, `changeForCents`).
- **App:** `get_courier_route` traz `payment` em cada parada. Continua sem o celular do cliente.
- Testes: `tests/sql/delivery-core/payment-contracts.sql`.

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
