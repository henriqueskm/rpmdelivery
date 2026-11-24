# Impressora virtual de teste

Um programa pequeno que finge ser uma impressora térmica de rede. Tudo o que for impresso nela fica guardado no computador. O programa também diz:

- se o cupom chegou como **texto** (dá para ler o pedido) ou como **figura** (não dá);
- o que o "Colar pedido" do painel reconheceria: nome, WhatsApp, endereço, bairro, complemento, nº do pedido e observações.

Serve para descobrir, antes de construir a integração, se o cupom que um sistema de pedidos imprime pode virar um pedido no RPM sem ninguém digitar. Nada sai do computador. A única exceção é o `--repassar`, que manda a impressão também para uma impressora de verdade.

As impressões ficam em `tools/print-capture/impressoes/`. Essa pasta não vai para o Git, porque um cupom real tem nome, telefone e endereço de cliente.

## 1. Ligar a impressora virtual

Num terminal, na pasta do projeto:

```powershell
npm run print:capture
```

Deixe esse terminal aberto. Ele mostra cada impressão que chegar. Para confirmar que está ouvindo, abra outro terminal e mande um cupom de exemplo:

```powershell
npm run print:sample
```

```powershell
npm run print:sample -- figura
```

O primeiro comando manda um cupom em texto, e a impressora virtual mostra os campos reconhecidos. O segundo manda um cupom desenhado como figura, e ela avisa que não há texto para ler.

**Não abra `127.0.0.1:9100` no navegador.** O navegador manda junto os cookies de login dos sites que rodam em `127.0.0.1`. A impressora virtual reconhece isso: responde com uma página de aviso e não guarda nem mostra nada.

## 2. Instalar a impressora "RPM Teste" no Windows (uma vez só)

Este passo muda uma configuração do Windows, então quem faz é você.

1. Abra **Configurações → Bluetooth e dispositivos → Impressoras e scanners**. No Windows 10 é **Configurações → Dispositivos → Impressoras e scanners**.
2. Clique em **Adicionar impressora**. Espere aparecer **"A impressora que eu quero não está na lista"** e clique nele.
3. Escolha **"Adicionar uma impressora local ou de rede usando configurações manuais"** e clique em **Avançar**.
4. Marque **"Criar uma nova porta"**, escolha o tipo **Standard TCP/IP Port** e clique em **Avançar**.
5. Preencha assim e clique em **Avançar**:
   - **Nome do host ou endereço IP:** `127.0.0.1`
   - **Nome da porta:** `RPM Teste 9100`
   - Desmarque **"Consultar a impressora e selecionar automaticamente o driver"**.
6. O Windows tenta achar a impressora e não consegue. Quando pedir o tipo de dispositivo, escolha **Personalizado → Configurações…**, confira **Protocolo: Bruto (Raw)** e **Porta: 9100**, clique em **OK** e depois em **Avançar**.
7. No driver, escolha **Fabricante: Generic** e **Impressoras: Generic / Text Only**. Clique em **Avançar**.
8. Dê o nome **RPM Teste**, não compartilhe, não defina como padrão e conclua. Se o Windows oferecer imprimir uma página de teste, pode imprimir: ela deve aparecer no terminal da impressora virtual.

Para remover depois, use **Impressoras e scanners → RPM Teste → Remover**. A porta pode ficar.

## 3. Testar

**Teste rápido:** abra o Bloco de Notas, escreva um pedido e imprima na "RPM Teste". Por exemplo:

```
Pedido #10
Cliente: Maria Souza
Telefone: (11) 98765-4321
Endereço: Rua das Flores, 120 - Apto 3
Bairro: Centro
```

**Teste que importa:** no sistema de pedidos do restaurante (gestor de pedidos do app de delivery, PDV, sistema de balcão), escolha a impressora **RPM Teste** e imprima um pedido real ou de teste. O terminal mostra uma de três respostas:

- **"O cupom é TEXTO legível"**, seguido dos campos reconhecidos: a integração pela impressora funciona com esse sistema.
- **"O cupom chegou como FIGURA"**: esse sistema desenha o cupom como imagem. Ler isso exigiria OCR (reconhecer letras numa foto), que é bem menos confiável. Procure nas configurações do sistema uma opção de "impressão em modo texto", "impressora não fiscal genérica" ou "ESC/POS".
- **"Chegou um documento PDF/PostScript/PCL"**: a impressora foi instalada com um driver de impressora comum. Refaça o passo 7 com **Generic / Text Only**.

## 4. Mandar o pedido impresso para o painel

Com o programa aberto, cada cupom em texto que tem nome, WhatsApp ou endereço fica pronto para o painel **deste computador**.

1. Abra o painel neste computador, no mesmo navegador de sempre, e entre na conta da loja.
2. No menu da loja (☰, no canto de cima), ligue **"Pedidos da impressora neste computador"**. A linha abaixo deve dizer "Ligado". A opção vale só para este computador e este navegador.
   - Se o painel estiver aberto pelo endereço da internet, o Chrome pode pedir permissão para acessar a rede local na primeira vez. Clique em **Permitir**: é assim que o painel fala com o programa neste computador.
3. Imprima um pedido na "RPM Teste". Em até 3 segundos aparece o aviso **"Pedido chegou pela impressora"**, em Pedidos.
4. Clique em **Conferir e cadastrar**. O formulário de novo pedido abre preenchido com o que foi lido do cupom. Escolha o endereço na lista para confirmar no mapa, complete o que faltar (o bairro, por exemplo) e clique em **Cadastrar pedido**.
5. O pedido entra em Aguardando despacho com o símbolo da impressora. Passando o mouse aparece o código, por exemplo "Veio da impressora · código 10 · 22/11/2026".

**Descartar** tira o aviso sem criar pedido.

**Cadastrar sozinho:** com a impressora ligada, o menu mostra a opção **"Cadastrar sozinho"** (também por computador). Com ela ligada, o pedido vai direto para Aguardando despacho, com o prazo padrão da loja, quando:

- o cupom tem nome, celular e endereço com número;
- o mapa acha a **mesma rua e o mesmo número** do cupom e, quando o cupom traz a cidade ("Centro - Itatiba/SP"), nessa cidade;
- o endereço encontrado fica a até 30 km da loja (se a loja tem endereço no mapa);
- há bairro (o do cupom, ou o que o mapa achou);
- o cupom diz o pagamento: já pago, ou a forma (dinheiro, cartão, Pix) e o valor a cobrar. A janela mostra o que leu na linha "Pagamento".

Faltando qualquer um, o pedido fica no aviso **"Pedido da impressora para conferir"**, com o motivo ("não achei esse endereço no mapa com certeza", por exemplo), e você confere no formulário como antes.

**Cupom impresso de novo:** o mesmo número no mesmo dia é o mesmo pedido. Cadastrar de novo não cria outro; o painel avisa que ele já estava lá. Sem número no cupom, vale o texto inteiro: um cupom idêntico é o mesmo pedido.

**A fila de pedidos fica gravada** no arquivo `fila.json` da pasta das impressões. Fechar o programa ou reiniciar o computador não perde os pedidos que o painel ainda não pegou: ao abrir de novo, os das últimas 24 horas voltam. Cabem 500 pedidos esperando, e a janela avisa a partir de 400. O mesmo número de pedido no mesmo dia só é tratado como segunda via quando o cliente também é o mesmo. O painel só consegue ler esses pedidos se a opção estiver ligada e o programa responde apenas ao painel do RpmDelivery (`localhost:3000` ou o endereço oficial). Outros sites são recusados. Para o painel em outro endereço, use `--origem https://endereco-do-painel`.

### Ver o que o driver da sua impressora térmica manda

O driver "Generic / Text Only" mostra o melhor caso. Para saber o que o driver de verdade da impressora do restaurante (Epson, Elgin, Bematech, Daruma…) manda, repita o passo 2 usando a **mesma porta `RPM Teste 9100`** e, no passo 7, o **driver dessa impressora**. Imprima nela. Drivers térmicos costumam mandar o cupom como figura quando a impressão vem de um navegador ou de um programa comum. Quando o sistema fala ESC/POS direto com a impressora, costumam mandar texto.

### Continuar imprimindo no papel

A impressora virtual guarda uma cópia e repassa cada impressão, **antes de ler o cupom**, para a impressora térmica de verdade. Ela pode ser:

- **de rede**, pelo IP:

  ```powershell
  npm run print:capture -- --repassar 192.168.0.50:9100
  ```

  Troque `192.168.0.50` pelo IP da impressora. Ele costuma sair impresso se você ligar a impressora segurando o botão de avanço do papel.
- **instalada no Windows**, como as térmicas USB, pelo nome que aparece em Impressoras e scanners:

  ```powershell
  npm run print:capture -- --repassar "EPSON TM-T20X"
  ```

  O cupom vai pelo spooler do Windows em modo **RAW**: os bytes vão como chegaram, com negrito, corte de papel e gaveta (`tools/print-capture/windows.mts`).

**Como o repasse se comporta:**
- os cupons saem um de cada vez, na ordem em que chegaram;
- se falhar, o programa tenta de novo depois de 2 s e de 5 s. Se ainda falhar, a janela apita e mostra **"O CUPOM NÃO SAIU NO PAPEL"**, com o motivo;
- o programa recusa repassar para si mesmo, que imprimiria em círculo: a impressora RPM, ou o próprio endereço e porta.

## 5. Levar para o computador da loja (sem Node e sem o projeto)

Para usar numa loja, ou num computador onde não dá para instalar o Node:

```powershell
npm run print:build
```

Isso gera `tools/print-capture/dist/RpmImpressora.zip`, com cerca de 35 MB. Leve o arquivo ao outro computador (pen drive, Google Drive ou e-mail) e descompacte numa pasta fixa, por exemplo `Documentos\RpmImpressora`. Dentro dele vêm:

| Arquivo | Para quê |
| --- | --- |
| `RPM Impressora.cmd` | Abre o programa. Na primeira vez, faz a configuração. |
| `Configurar RPM Impressora.cmd` | Refaz a configuração. |
| `LEIA-ME.txt` | O passo a passo para a loja. |
| `app\node.exe` | O Node oficial (assinado pela OpenJS Foundation), copiado deste computador. |
| `app\rpm-impressora.cjs` | O programa e o leitor de cupom num arquivo só. |

**A configuração**, na própria janela, pergunta:
1. Se pode instalar a impressora **"RPM Impressora"**: driver Generic / Text Only, porta `RPM 9100` → `127.0.0.1:9100`. O Windows pede permissão de administrador. Se já existe uma impressora mandando para o programa, como a "RPM Teste", a pergunta é pulada.
2. **Em qual impressora o cupom continua saindo no papel.** A lista mostra as impressoras do Windows, menos PDF, XPS, fax, OneNote e a própria impressora RPM. Também aceita o IP de uma impressora de rede, ou 0 para nenhuma.
3. O nome do sistema de pedidos (opcional), mostrado no painel.
4. Se o programa abre sozinho com o Windows: um atalho minimizado na pasta Inicializar do usuário.

A configuração fica em `%APPDATA%\RpmImpressora\config.json` e as impressões em `%APPDATA%\RpmImpressora\impressoes`. Depois, na loja:
- o sistema de pedidos passa a imprimir na **RPM Impressora**;
- no painel, ligue **"Pedidos da impressora neste computador"**.

**Limites conhecidos:**
- O programa não tem assinatura digital própria. Ao abrir, o Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo**.
- Computadores de empresa podem bloquear programas baixados ou a instalação de impressora (permissão de administrador).
- A janela precisa ficar aberta, mesmo minimizada. Fechada, o cupom não sai nem no papel.

## Outras opções

| Opção | Para quê |
| --- | --- |
| `--porta 9101` | Ouvir em outra porta. Use se a 9100 estiver ocupada, e ajuste a porta no Windows igual. |
| `--pasta C:\outra\pasta` | Guardar as impressões em outro lugar. |
| `--espera 5000` | Esperar mais tempo sem dados antes de dar a impressão por terminada (o padrão é 3000 ms). |
| `--ler arquivo.bin` | Ler de novo uma impressão já guardada, sem imprimir. |
| `--sistema "Balcão"` | Nome do sistema que imprime, guardado junto do pedido e mostrado ao passar o mouse. |
| `--sem-painel` | Não entregar os pedidos ao painel (só o teste no terminal). |
| `--porta-painel 9181` | Outra porta para o painel. O painel procura na 9180: use só para testes. |
| `--origem https://endereco` | Aceitar o painel aberto em outro endereço, além de `localhost:3000` e do endereço oficial. |
| `--repassar 192.168.0.50` ou `--repassar "Nome no Windows"` | Continuar imprimindo no papel nessa impressora. |
| `--app` | Modo loja, como na pasta RpmImpressora: configuração e impressões em `%APPDATA%\RpmImpressora`, com a configuração na primeira vez. |
| `--configurar` | Junto com `--app`, refaz a configuração. |

Cada impressão gera dois arquivos: o `.bin` (os bytes exatos que chegaram) e o `.txt` (o texto lido). Se algum cupom real não for reconhecido direito, o `.bin` é o que permite ajustar o leitor. Ele tem dados de cliente: não mande para fora sem apagar esses dados.

## Como funciona

- Impressoras térmicas recebem **ESC/POS**: letras misturadas com comandos (negrito, corte do papel, gaveta, figuras, código de barras).
- O leitor (`lib/printing/receipt-text.ts`) tira os comandos e conta as figuras. Depois decodifica as letras na página de código que o sistema escolheu (comando `ESC t`) ou, quando o sistema não escolhe, na página que faz mais sentido em português: CP850, CP860, Windows-1252 ou UTF-8.
- O texto passa pelo mesmo leitor do "Colar pedido" (`features/operations/paste-order.ts`).
- O programa guarda os cupons que parecem pedido, também em `fila.json` (`lib/printing/printer-queue.ts`), e os oferece em `127.0.0.1:9180`, só para o painel. O painel com a opção ligada pergunta a cada 3 segundos (`lib/printing/printer-inbox.ts`, `features/operations/live/use-printer-inbox.ts`).
- O pedido conferido é salvo por `import_order`, com origem `PRINTER` e o código do cupom: número e dia, ou a impressão digital do texto. O banco não deixa o mesmo código entrar duas vezes.
