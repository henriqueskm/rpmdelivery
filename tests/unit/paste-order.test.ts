import { test } from "node:test";
import assert from "node:assert/strict";
import { findAppContact, findMobile, foundText, isPickup, parsePastedOrder } from "../../features/operations/paste-order.ts";

test("cupom com rótulos: preenche cada campo", () => {
  const { order, found } = parsePastedOrder(`
*Pedido #1234*
Cliente: Maria da Silva
Telefone: (11) 98765-4321
Endereço: Rua das Flores, 120 - Apto 3
Bairro: Jardim Paulista
Referência: em frente à padaria
Observações: sem cebola
Total: R$ 52,90
`);
  assert.deepEqual(order, {
    reference: "1234", customer: "Maria da Silva", phone: "11987654321", address: "Rua das Flores, 120",
    complement: "Apto 3 · em frente à padaria", neighborhood: "Jardim Paulista", notes: "sem cebola",
  });
  assert.deepEqual(found, ["customer", "phone", "address", "neighborhood", "complement", "reference", "notes"]);
  assert.equal(foundText(found), "nome, WhatsApp, endereço, bairro, complemento, nº do pedido e observações");
});

test("mensagem solta do WhatsApp: rua, celular e nome sem rótulo", () => {
  const { order } = parsePastedOrder("Joana Reis\nAv. Brasil, 455 casa 2\n+55 11 9 8888-7777\nmanda troco pra 100");
  assert.equal(order.customer, "Joana Reis");
  assert.equal(order.address, "Av. Brasil, 455 casa 2");
  assert.equal(order.phone, "11988887777");
  assert.equal(order.neighborhood, undefined, "never guesses a bairro");
});

test("só reconhece celular brasileiro de verdade", () => {
  assert.equal(findMobile("ligar 11 3333-4444"), null, "a landline is not a WhatsApp");
  assert.equal(findMobile("CEP 13250-000, total 123456789"), null);
  assert.equal(findMobile("whats 19 99123 4567"), "19991234567");
  assert.equal(findMobile("(011) 98765-4321"), "11987654321", "the long-distance zero is fine");
  assert.equal(findMobile("(10) 98765-4321"), null, "10 is not a DDD");
});

test("texto sem nada reconhecível não preenche nada", () => {
  assert.deepEqual(parsePastedOrder("oi tudo bem? quero 2 pizzas"), { order: {}, found: [] });
  assert.deepEqual(parsePastedOrder("   "), { order: {}, found: [] });
});

test("linhas quebradas pelo papel estreito voltam para o campo (cupom do teste no PC do trabalho)", () => {
  // As the Notepad printed it on a narrow page: every value wrapped onto the next lines.
  const { order } = parsePastedOrder([
    "Pedido #30", " cliente: maria", " teste", " telefone:", " 11916178357",
    " endereço: rua", " jovino antonio", " santana, 329", " itatiba",
  ].join("\n"));
  assert.deepEqual(order, {
    reference: "30", customer: "maria teste", phone: "11916178357",
    address: "rua jovino antonio santana, 329, itatiba",
  });
});

test("cupom de 32 colunas: endereço, observação e complemento em duas linhas", () => {
  const { order } = parsePastedOrder(`
PEDIDO #812
--------------------------------
Cliente: Ana Beatriz Fontes
Endereço: Avenida Doutor Antonio
Pires Pimentel, 1200
Bairro: Jardim das Nações
Compl.: bloco B apto 34, portao
lateral
Obs: tocar o interfone e esperar
na calcada
--------------------------------
1x Pizza grande        R$ 59,90
Total                  R$ 66,90
`);
  assert.equal(order.address, "Avenida Doutor Antonio Pires Pimentel, 1200");
  assert.equal(order.neighborhood, "Jardim das Nações");
  assert.equal(order.complement, "bloco B apto 34, portao lateral");
  assert.equal(order.notes, "tocar o interfone e esperar na calcada");
  assert.equal(order.customer, "Ana Beatriz Fontes");
});

test("o que vem depois do campo e não é continuação fica de fora", () => {
  // After the house number, two words may be the bairro or a name: never glued to the street.
  const loose = parsePastedOrder("Endereço: Rua A, 10\nVila Mariana\nJoana Reis");
  assert.equal(loose.order.address, "Rua A, 10");
  assert.equal(loose.order.neighborhood, undefined, "never guesses a bairro");
  // A phone, money or a separator ends the field.
  const name = parsePastedOrder("Cliente: Maria\n(11) 98765-4321\nRua das Flores, 120");
  assert.equal(name.order.customer, "Maria");
  assert.equal(name.order.phone, "11987654321");
  assert.equal(name.order.address, "Rua das Flores, 120", "an unlabeled street after the name is still the address");
  const notes = parsePastedOrder("Obs: sem cebola\nTotal: R$ 30,00\n------\n2x Coca");
  assert.equal(notes.order.notes, "sem cebola");
  // A label alone takes the next line; a label alone before another label stays empty.
  assert.equal(parsePastedOrder("Endereço:\nRua Nova, 5").order.address, "Rua Nova, 5");
  assert.equal(parsePastedOrder("Telefone:\nCliente: Bia").order.phone, undefined);
  assert.equal(parsePastedOrder("Telefone:\nCliente: Bia").order.customer, "Bia");
});

test("cupom do iFood: cidade do bairro, CEP fora do endereço e Ref na referência", () => {
  // As the iFood example came out on the work PC, wrapped by Notepad (fictional data).
  const { order, found } = parsePastedOrder([
    "PEDIDO #4829", "--------------------", "Data/Hora:", "23/11/2026 - 16:10", "Previsão Entrega:", "16:50 - 17:00",
    "Tipo: ENTREGA", "PARCEIRA (iFood)", "--------------------",
    "CLIENTE: Lucas", "Mendes", "Tel: (11) 99999-0000", "(ID: 4412)", "Histórico: 12º", "pedido na loja",
    "--------------------", "ENDEREÇO DE ENTREGA:", "Rua das Flores, 123", "- Apto 42, Bloco B", "Bairro: Centro -",
    "Itatiba/SP", "CEP: 13250-000", "Ref: Próximo à praça", "central", "====================", "ITENS DO PEDIDO",
  ].join("\r\n"));
  assert.deepEqual(order, {
    reference: "4829", customer: "Lucas Mendes", phone: "11999990000",
    address: "Rua das Flores, 123, Itatiba", neighborhood: "Centro", city: "Itatiba",
    complement: "Apto 42, Bloco B · Próximo à praça central",
  });
  assert.equal(foundText(found), "nome, WhatsApp, endereço, bairro, cidade, complemento e nº do pedido");
});

test("modelo de cupom do iFood: 'Entrega: Delivery' não é endereço, e o que é do item fica na cozinha", () => {
  // Shape of an iFood receipt model the user brought (fictional data).
  const { order } = parsePastedOrder([
    "PEDIDO #4821                       14/05 20:15", "LOCALIZADOR: 8842 9104", "----------",
    "CLIENTE: João da Silva", "TELEFONE: 0800 718 2283 ID: 12345678", "(Pediu 12 vezes na loja)", "----------",
    "ENTREGA: Delivery (Parceiro iFood)", "ENDERECO: Rua das Flores, 123 - Apto 42", "BAIRRO: Centro - Itatiba/SP",
    "COMPLEMENTO: Bloco B - Interfone 42", "REF: Próximo à praça central", "PREVISAO DE ENTREGA: 20:55 - 21:05",
    "----------", "ITENS DO PEDIDO", "1x X-Bacon Artesanal                   R$ 34,90",
    "   + Ponto da carne: Ao ponto", "   * OBS: Tirar o tomate, por favor.", "----------",
    "Codigo de Entrega (Cliente): 4821 (4 ult. dig. tel)",
  ].join("\n"));
  assert.equal(order.phone, undefined, "the 0800 number is not the customer's mobile");
  assert.deepEqual(order, {
    reference: "4821", customer: "João da Silva", address: "Rua das Flores, 123, Itatiba", neighborhood: "Centro",
    city: "Itatiba", complement: "Apto 42 · Bloco B - Interfone 42 · Próximo à praça central",
    contact: "0800 718 2283 · ID 12345678",
  });
  // A note of the whole order, at the margin, still counts.
  assert.equal(parsePastedOrder("Cliente: Ana\nOBS: tocar o interfone").order.notes, "tocar o interfone");
});

test("contato 0800 do app e pedido de retirada na loja", () => {
  assert.equal(findAppContact("TELEFONE: 0800 718 2283 ID: 12345678"), "0800 718 2283 · ID 12345678");
  assert.equal(findAppContact("Tel: 0800-718-2283 código 9921"), "0800 718 2283 · código 9921");
  assert.equal(findAppContact("0800 718 2283"), "0800 718 2283");
  assert.equal(findAppContact("(11) 98765-4321"), null);
  // A real mobile wins: the contact is only for a hidden one.
  assert.equal(parsePastedOrder("Cliente: Ana\nTelefone: (11) 98765-4321\nSuporte 0800 718 2283").order.contact, undefined);
  assert.ok(isPickup("*** MODALIDADE: RETIRADA NA LOJA ***"));
  assert.ok(isPickup("PREVISAO DE RETIRADA: 20:45 - 20:55"));
  assert.ok(isPickup("Tipo: Retirada"));
  assert.ok(isPickup("Cliente vai retirar no balcão"));
  assert.equal(isPickup("ENTREGA: Delivery\nENDERECO: Rua A, 10\nPREVISAO DE ENTREGA: 20:55"), false);
  assert.equal(isPickup("Codigo de Coleta (Entregador): 9921"), false);
});

test("onde a cidade aparece no cupom", () => {
  const city = (text: string) => parsePastedOrder(text).order;
  assert.deepEqual(city("Endereço: Rua A, 10 - Itatiba/SP"), { address: "Rua A, 10, Itatiba", city: "Itatiba" });
  assert.deepEqual(city("Endereço: Rua A, 10\nBairro: Vila Nova, São Paulo - SP"),
    { address: "Rua A, 10, São Paulo", neighborhood: "Vila Nova", city: "São Paulo" });
  assert.deepEqual(city("Endereço: Rua A, 10\nCidade: Embu-Guaçu/SP"), { address: "Rua A, 10, Embu-Guaçu", city: "Embu-Guaçu" });
  assert.deepEqual(city("Endereço: Rua A, 10\nCidade: Itatiba"), { address: "Rua A, 10, Itatiba", city: "Itatiba" });
  assert.deepEqual(city("Rua A, 10\nItatiba - SP"), { address: "Rua A, 10, Itatiba", city: "Itatiba" }, "a line of its own");
  assert.deepEqual(city("Endereço: Rua A, 10, Itatiba\nCidade: Itatiba/SP"), { address: "Rua A, 10, Itatiba", city: "Itatiba" },
    "not twice");
  // A CEP ends the address: it is not a house number to glue to the street.
  assert.equal(city("Endereço: Rua A, 10\n13250-000").address, "Rua A, 10");
  assert.equal(city("Endereço: Rua A, 10 - Bloco B").city, undefined, "a block is not a state");
});

test("campos longos são cortados no limite do formulário", () => {
  const { order } = parsePastedOrder(`Observações: ${"x".repeat(900)}`);
  assert.equal(order.notes!.length, 500);
});
