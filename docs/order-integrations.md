# Pedidos que chegam de fora (migration 20261130120000)

Esta etapa prepara a entrada de pedidos por outros caminhos além do formulário do painel:

- a **impressora** (capturar o cupom que o sistema do restaurante imprime);
- o **Open Delivery** (99Food, Keeta e outros apps que seguem o padrão).

Ela ainda não liga nenhum dos dois. Deixa o banco pronto e traz uma impressora virtual para testar se a impressão serve.

## Banco

- `orders.source`: de onde veio o pedido.
  - `PANEL` é o padrão: todo pedido digitado no painel, incluindo os antigos.
  - `PRINTER`: veio da impressora.
  - `OPEN_DELIVERY`: veio de um app de delivery.
- `orders.source_app`: o nome do app ou sistema como a loja conhece ("99Food", "Balcão"). Opcional, até 40 letras.
- `orders.external_id`: o código do pedido no outro sistema. Tem de 1 a 80 caracteres, sem quebra de linha. Pedido do painel nunca tem código; pedido importado sempre tem.
- Índice único em (loja, origem, app, código): o mesmo pedido não entra duas vezes.

### `import_order`

`import_order(p_restaurant_id, p_source, p_external_id, p_customer_name, p_customer_phone, p_delivery_address, p_source_app?, …)`

- Recebe os mesmos campos opcionais de `create_order` (complemento, bairro, nº, observações, localização, horário do pedido, prazo).
- Faz as mesmas validações e dá a mesma resposta: `{ orderId, deliveryId, created }`.
- **Membros da loja apenas**, como `create_order`. Por enquanto quem chama é o painel ou uma ferramenta com a sessão de um membro. O webhook do Open Delivery vai precisar de outro caminho de autenticação, numa etapa própria.
- **Mesmo código de novo** (cupom reimpresso, webhook entregue duas vezes): responde o pedido que já existe, com `created: false`, e não muda nada nele.
- **Duas importações ao mesmo tempo:** o id da requisição é derivado do código externo (`md5(loja|origem|app|código)`). As duas caem na mesma chave de idempotência de `create_order`, e só um pedido é criado.
- **O mesmo código vindo de outro app, de outra origem ou de outra loja** é outro pedido.
- **Limite conhecido:** o telefone continua obrigatório, como em `create_order`. Apps que escondem o número (0800 com ramal) vão precisar de uma regra própria antes do Open Delivery.

### Quadro e painel

- `get_operations_board` ganhou `orderSources`, só com os pedidos importados: `{ deliveryId, source, app, externalId }`.
- O painel mostra uma etiqueta ao lado do nº do pedido. Pedido da impressora ganha só o símbolo da impressora. Pedido de app ganha o nome do app ("99Food") ou, sem nome, "App de delivery".
- Passando o mouse, e para leitor de tela, aparece de onde veio e o código: "Veio da impressora (Balcão) · código 5127".
- Pedido digitado no painel não ganha etiqueta.

## Impressora virtual

O programa fica em `tools/print-capture/`; o passo a passo está no [README](../tools/print-capture/README.md).

- Rode `npm run print:capture`, instale no Windows uma impressora "Generic / Text Only" apontando para `127.0.0.1:9100` e imprima.
- O programa guarda o cupom e diz se ele chegou como texto ou como figura. Também mostra o que o "Colar pedido" reconheceria.
- O leitor (`lib/printing/receipt-text.ts`) entende ESC/POS: tira comandos, figuras, códigos de barras, QR e gaveta. Decodifica as letras em CP850, CP860, CP437, Windows-1252 ou UTF-8. Também reconhece PDF, PostScript e PCL, que indicam driver errado.
- Ainda não cria pedido sozinho. Se o teste com o sistema do restaurante der texto legível, a próxima etapa liga o programa ao `import_order`, com origem `PRINTER`.

## Próximas etapas

1. Testar a impressora virtual com o sistema de pedidos de um restaurante de verdade.
2. Se der texto: o programa cria o pedido no painel (`import_order`), com a loja confirmando o endereço no mapa.
3. Open Delivery: precisa de credenciais de desenvolvedor nos apps (99Food/Keeta) e de uma função no servidor para receber o webhook.
