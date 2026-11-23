import { test } from "node:test";
import assert from "node:assert/strict";
import { autoOrder, distanceKm, houseNumber, matchSuggestion, receiptBlock, streetWords }
  from "../../features/operations/live/auto-printed.ts";
import { parsePrintedOrders } from "../../lib/printing/printer-inbox.ts";

const receivedAt = new Date(2026, 10, 22, 20, 54).toISOString();
const printed = (order: Record<string, string>) => parsePrintedOrders({ orders: [{ id: "a1", receivedAt,
  externalId: "77 · 22/11/2026", app: null, order }] })[0];
const maria = { customer: "Maria Souza", phone: "11912345678", address: "Rua das Flores, 100", reference: "77" };

test("número da casa: depois da vírgula, ou no fim; o número do nome da rua não conta", () => {
  assert.equal(houseNumber("Rua das Flores, 100"), "100");
  assert.equal(houseNumber("Rua das Flores, nº 100 - fundos"), "100");
  assert.equal(houseNumber("Rua 25 de Março, 1000"), "1000");
  assert.equal(houseNumber("Rua das Flores 100"), "100");
  assert.equal(houseNumber("Rua 25 de Março"), null);
  assert.equal(houseNumber("Rua das Flores"), null);
});

test("nome da rua sem o tipo e sem as ligações", () => {
  assert.deepEqual(streetWords("Rua das Flores, 100"), ["flores"]);
  assert.deepEqual(streetWords("Av. Brig. Faria Lima, 2000"), ["brig", "faria", "lima"]);
  assert.deepEqual(streetWords("Rua 25 de Março, 1000"), ["25", "marco"]);
});

test("só aceita a sugestão com a mesma rua e o mesmo número", () => {
  const suggestion = (label: string, kind: "address" | "street" = "address") =>
    ({ id: label, label, secondaryLabel: "Centro, São Paulo - SP", kind });
  assert.equal(matchSuggestion("Rua das Flores, 100", [suggestion("Rua das Flores, 100")])?.id, "Rua das Flores, 100");
  assert.equal(matchSuggestion("R. das Flores, 100", [suggestion("Rua das Flores, 120"), suggestion("Rua das Flores, 100")])?.id,
    "Rua das Flores, 100", "skips another number");
  assert.equal(matchSuggestion("Av. Brig. Faria Lima, 2000", [suggestion("Avenida Brigadeiro Faria Lima, 2000")])?.id,
    "Avenida Brigadeiro Faria Lima, 2000", "abbreviations");
  assert.equal(matchSuggestion("Rua Sao Joao, 5", [suggestion("Rua São João, 5")])?.id, "Rua São João, 5", "accents");
  assert.equal(matchSuggestion("Rua das Flores, 100", [suggestion("Rua das Flores Novas, 100")]), null, "another street");
  assert.equal(matchSuggestion("Rua das Flores, 100", [suggestion("Rua das Flores", "street")]), null, "street without number");
  assert.equal(matchSuggestion("Rua das Flores", [suggestion("Rua das Flores, 100")]), null, "receipt without number");
  assert.equal(matchSuggestion("Rua das Flores, 100", []), null);
});

test("o que o cupom precisa ter para tentar sozinho", () => {
  assert.equal(receiptBlock(printed(maria)), null);
  assert.equal(receiptBlock(printed({ ...maria, customer: "" })), "o cupom não tem o nome do cliente");
  assert.equal(receiptBlock(printed({ ...maria, phone: "1133334444" })), "o cupom não tem um celular do cliente");
  assert.equal(receiptBlock(printed({ customer: "Maria", phone: "11912345678" })), "o cupom não tem endereço");
  assert.equal(receiptBlock(printed({ ...maria, address: "Rua das Flores" })), "o endereço do cupom não tem número");
});

test("pedido salvo sozinho: endereço do mapa, bairro, prazo padrão e origem impressora", () => {
  const found = { address: "Rua das Flores, 100 - Centro, São Paulo", latitude: -23.55, longitude: -46.63,
    provider: "mapbox" as const, providerId: "mb-1", neighborhood: "Centro" };
  const store = { latitude: -23.56, longitude: -46.64 };
  const result = autoOrder(printed({ ...maria, complement: "Apto 3", notes: "sem cebola" }), found, 45, store);
  assert.ok("order" in result);
  assert.deepEqual(result.order, { reference: "77", customer: "Maria Souza", phone: "(11) 91234-5678",
    address: found.address, neighborhood: "Centro", complement: "Apto 3", notes: "sem cebola",
    orderedAt: Date.parse(receivedAt), promisedMinutes: 45,
    geocode: { latitude: -23.55, longitude: -46.63, providerId: "mb-1" },
    origin: { source: "PRINTER", app: null, externalId: "77 · 22/11/2026" } });
  // The receipt's bairro wins over the map's.
  const withBairro = autoOrder(printed({ ...maria, neighborhood: "Vila Nova" }), found, 45, store);
  assert.ok("order" in withBairro && withBairro.order.neighborhood === "Vila Nova");
  assert.deepEqual(autoOrder(printed(maria), { ...found, neighborhood: undefined }, 45, store), { reason: "não achei o bairro" });
  // Same street name in another city: Campinas is about 85 km from São Paulo.
  const far = autoOrder(printed(maria), { ...found, latitude: -22.9, longitude: -47.06 }, 45, store);
  assert.ok("reason" in far && /^o endereço encontrado fica a \d+ km da loja$/.test(far.reason));
  assert.ok("order" in autoOrder(printed(maria), found, 45), "without the store on the map, no distance check");
});

test("distância em km", () => {
  assert.equal(Math.round(distanceKm({ latitude: -23.55, longitude: -46.63 }, { latitude: -22.9, longitude: -47.06 })), 85);
  assert.equal(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0);
});
