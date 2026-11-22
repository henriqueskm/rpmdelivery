import { test } from "node:test";
import assert from "node:assert/strict";
import { findMobile, foundText, parsePastedOrder } from "../../features/operations/paste-order.ts";

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

test("campos longos são cortados no limite do formulário", () => {
  const { order } = parsePastedOrder(`Observações: ${"x".repeat(900)}`);
  assert.equal(order.notes!.length, 500);
});
