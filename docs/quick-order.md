# Pedido rápido

O cadastro de pedidos no painel real (`features/operations/dialogs.tsx`) tem três atalhos.

## 1. WhatsApp primeiro
O formulário abre com o cursor no **WhatsApp**.

## 2. Cliente que já pediu
Quando o celular fica completo, o painel chama `find_customer(restaurant, phone)` (migration `20261128120000`). A consulta segue estas regras:
- **Quem pode:** só membros da loja.
- **O que vale:** só pedidos da própria loja.
- **Que formato:** o número em qualquer formato, normalizado por `private.normalize_br_phone`.

**A resposta** traz o último pedido daquele número e quantos pedidos não cancelados ele fez ali. O último pedido inclui:
- nome;
- endereço, com o ponto no mapa só quando veio da busca;
- bairro;
- complemento.

**"Usar estes dados"** preenche nome, endereço, bairro e complemento e mantém o resto do que foi digitado. Com ponto no mapa, o endereço já entra confirmado. Sem ponto, a busca de endereço abre sozinha.

## 3. Colar pedido
O texto vem do WhatsApp, do app de entrega ou do cupom. `features/operations/paste-order.ts` lê esse texto no navegador, sem enviar nada a lugar nenhum.

**Campos com rótulo:**
- Cliente/Nome
- Telefone/Celular/WhatsApp
- Endereço
- Bairro
- Complemento
- Referência (vai junto do complemento)
- Observações
- Pedido #

**Sem rótulo, ele procura:**
- a primeira linha que começa com Rua/Av./Travessa… vira o endereço;
- um celular brasileiro em qualquer lugar do texto vira o WhatsApp (telefone fixo não conta);
- `#1234` vira o nº do pedido;
- uma linha curta só de letras vira o nome.

**Linhas quebradas:** papel estreito (32 letras por linha numa térmica de 58 mm) ou o programa que imprime parte um valor comprido em várias linhas. O leitor junta de volta ao campo de cima as linhas sem rótulo que continuam o valor:
- o rótulo pode vir sozinho ("Telefone:"), com o valor na linha de baixo;
- até 3 linhas no endereço, 2 no nome, no complemento e na referência, 4 nas observações e 1 no bairro e no telefone;
- uma linha de separação (----), valor (R$), item (2x), total, pagamento, troco, data ou hora encerra o campo, assim como outro rótulo ou um celular;
- no nome, só entram letras, e nunca uma rua;
- no endereço, depois do número, só entra um número ou uma palavra (a cidade), separada por vírgula. Duas palavras depois do número podem ser o bairro sem rótulo ou um nome, e ficam de fora.

Exemplo, do teste com a impressora:

| Linhas | Endereço |
| --- | --- |
| `endereço: rua` / `jovino antonio` / `santana, 329` / `itatiba` | rua jovino antonio santana, 329, itatiba |

O separador do rótulo também pode vir repetido: "Compl.: bloco B" lê "bloco B".

**O que ele não faz:** não adivinha bairro nem número.

**Depois de colar:**
- O endereço colado é buscado na hora, e a loja escolhe na lista para confirmar no mapa.
- O que o texto não trouxe fica como estava digitado.
- A tela diz o que foi preenchido.

## Testes
- `tests/unit/paste-order.test.ts` cobre:
  - cupom com rótulos;
  - mensagem solta;
  - só celular de verdade;
  - texto sem nada;
  - limites dos campos.
- `tests/sql/delivery-core/find-customer-contracts.sql` cobre:
  - último pedido;
  - qualquer formato;
  - só a própria loja;
  - sem ponto quando não veio da busca;
  - recusas e permissões.
- `tests/e2e/operations-live.spec.ts`, os testes "pedido rápido", cobrem:
  - cliente reconhecido, com o pedido salvo com o ponto do mapa;
  - colar com busca automática do endereço.

## Depois (mesma frente)
- **Impressora como reserva:** capturar o cupom que o sistema de pedidos imprime. Exige um programa no PC da loja; ver estudo.
- **Open Delivery:** receber pedidos direto de quem adere ao padrão (99Food, Keeta, sistemas de cardápio). Exige ler a especificação e homologar com um parceiro.
