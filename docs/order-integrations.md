# Pedidos que chegam de fora (migration 20261130120000)

Esta etapa prepara a entrada de pedidos por outros caminhos além do formulário do painel:

- a **impressora** (capturar o cupom que o sistema do restaurante imprime);
- o **Open Delivery** (99Food, Keeta e outros apps que seguem o padrão).

O banco está pronto para os dois. A impressora já funciona de ponta a ponta com a impressora virtual: o cupom vira um aviso no painel, e a loja confere e cadastra. O Open Delivery ainda não está ligado.

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
### Do cupom ao painel

- O programa guarda os cupons em texto que têm nome, WhatsApp ou endereço. Ele os oferece em `127.0.0.1:9180`, só para este computador.
- **Fila segura no horário de pico** (`lib/printing/printer-queue.ts`):
  - a fila fica também no arquivo `fila.json` da pasta das impressões, gravada a cada mudança. Fechar a janela ou reiniciar o computador não perde os pedidos que o painel ainda não pegou: ao abrir, os das últimas 24 horas voltam;
  - cabem 500 pedidos esperando. A partir de 400, a janela do programa avisa que o painel não está pegando os pedidos. Só depois de 500 o mais antigo sai da fila, e a janela diz qual, para conferir no papel.
- No painel, a opção **"Pedidos da impressora neste computador"** fica no menu da loja. Vem desligada e vale por computador (`localStorage`). Ligada, o painel pergunta ao programa a cada 3 segundos, ou a cada 10 enquanto ele estiver fechado.
- Cada cupom vira o aviso **"Pedido chegou pela impressora"**. **Conferir e cadastrar** abre o formulário de novo pedido preenchido. A loja confirma o endereço no mapa e salva por `import_order`, com origem `PRINTER`. **Descartar** tira o aviso.
- **Cadastrar sozinho** (opção por computador, abaixo da impressora; `features/operations/live/auto-printed.ts` e `use-auto-printed.ts`):
  - cada cupom é tentado uma vez, um de cada vez, sem atrapalhar uma ação da loja em andamento;
  - só cadastra sozinho quando o cupom tem nome, celular e endereço com número, o mapa acha a mesma rua e o mesmo número (abreviações e acentos à parte, nos dois sentidos: "Rua das Flores" não é "Rua das Flores Novas"), na cidade do cupom quando ele traz uma, o ponto fica a até 30 km da loja e há bairro;
  - o pedido entra com o endereço e o ponto do mapa, o prazo padrão da loja e o horário da impressão;
  - o resto fica no aviso "Pedido da impressora para conferir", com o motivo, também mostrado no formulário.
- **Código do pedido impresso** (`external_id`): o número do cupom com o dia ("5127 · 22/11/2026"), porque muitos sistemas recomeçam a numeração todo dia. Sem número, a impressão digital do texto ("cupom 0123456789ab").
- **Mesmo número, outro cliente:** dois sistemas na mesma impressora podem imprimir o mesmo número no mesmo dia (o 7 do iFood e o 7 do site). O programa lembra, por dois dias, o celular e o nome de cada código que deu:
  - celulares diferentes, ou nomes que não cabem um no outro, fazem outro pedido, com o código "7 · 23/11/2026 · 2";
  - "Lucas" cabe em "Lucas Mendes", porque uma linha quebrada pode faltar;
  - sem celular nem nome para comparar, é segunda via.
- **Cupom reimpresso:**
  - o programa troca a cópia que ainda está esperando, para não aparecer em dobro;
  - se o pedido já foi cadastrado, `import_order` responde o que já existe e o painel avisa "Esse pedido já estava no painel".
- **Segurança:** o programa só atende pedidos que:
  - vêm no próprio endereço (`127.0.0.1` ou `localhost` e a porta), o que recusa "DNS rebinding";
  - trazem o cabeçalho `x-rpm-painel`, que obriga o navegador a perguntar antes;
  - vêm das páginas do painel (`localhost:3000`, `127.0.0.1:3000`, o endereço oficial ou `--origem`).

  Nada sai do computador: o pedido só vai para o banco quando a loja clica em cadastrar, pela sessão do painel.

## Próximas etapas

1. Testar com o sistema de pedidos de um restaurante de verdade. O Gestor de Pedidos do iFood imprime em ESC/POS texto, o caso bom.
2. Telefone mascarado: cupons de app (iFood, por exemplo) costumam trazer um 0800 com código em vez do celular do cliente. Hoje o formulário exige um celular; vai precisar de uma regra própria.
3. Pasta para o restaurante: feita. `npm run print:build` gera `RpmImpressora.zip`, que leva o Node oficial e o programa num arquivo só. Na primeira vez, o programa instala a impressora RPM e pergunta em qual impressora o cupom continua saindo no papel: USB do Windows em modo RAW, ou de rede pelo IP. O README tem os detalhes. Faltam:
   - uma assinatura digital, para o Windows não avisar ao abrir;
   - testar numa loja com a térmica de verdade.
4. Open Delivery: precisa de credenciais de desenvolvedor nos apps (99Food/Keeta) e de uma função no servidor para receber o webhook.
